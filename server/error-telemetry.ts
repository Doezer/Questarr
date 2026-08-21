/**
 * Automatic error-telemetry pipeline.
 *
 * Detects unhandled server errors (uncaught exceptions, unhandled promise
 * rejections, and 5xx responses from the global Express error handler) and,
 * per-user, either:
 *  - sends a diagnostic report to the same support-log Worker used by the
 *    manual "Send Logs" flow (`client/src/lib/send-logs.ts`), when the user has
 *    opted into automatic telemetry (`userSettings.telemetryEnabled`), or
 *  - creates an actionable in-app notification asking for consent first,
 *    which the client resolves via GET/POST /api/telemetry/pending/:reportId
 *    (see server/routes.ts) and `SendErrorReportDialog`.
 *
 * A global cooldown prevents notification/telemetry spam during a crash loop.
 * The automatic-telemetry report (when enabled) is sent at most once per
 * detected error — never once per opted-in user — and its result is shared
 * across every opted-in user's notification.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { storage } from "./storage.js";
import { readLastLogLines } from "./log-file.js";
import { notifyUser } from "./socket.js";
import { appriseClient } from "./apprise.js";
import { resolvePrefs } from "./notification-prefs.js";
import { safeFetch } from "./ssrf.js";
import { telemetryLogger } from "./logger.js";
import { scrubPii, scrubLogLines } from "../shared/log-scrub.js";
import { SUPPORT_WORKER_URL } from "../shared/support-config.js";
import type { InsertNotification, NotificationPreferences, User } from "../shared/schema.js";

const ERROR_REPORT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const LOG_CONTEXT_LINES = 150;
const PENDING_REPORT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const WORKER_TIMEOUT_MS = 10_000;

const { version: APP_VERSION } = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
) as { version: string };

export interface ErrorContext {
  path?: string;
  method?: string;
  source: "uncaughtException" | "unhandledRejection" | "expressErrorHandler";
}

export interface PendingErrorReport {
  userId: string;
  logs: string;
  lineCount: number;
  appVersion: string;
  platform: string;
  timestamp: string;
  createdAt: number;
}

let lastReportedAt = 0;
const pendingReports = new Map<string, PendingErrorReport>();

function purgeExpiredReports(): void {
  const cutoff = Date.now() - PENDING_REPORT_TTL_MS;
  for (const [id, report] of Array.from(pendingReports.entries())) {
    if (report.createdAt < cutoff) pendingReports.delete(id);
  }
}

/**
 * Used by GET /api/telemetry/pending/:reportId. Only returns the report when
 * it exists, hasn't expired, and belongs to the requesting user — an
 * authenticated user must not be able to read another user's report by
 * guessing/observing its id.
 */
export function getPendingReport(reportId: string, userId: string): PendingErrorReport | undefined {
  const report = pendingReports.get(reportId);
  if (!report || report.userId !== userId) return undefined;
  if (Date.now() - report.createdAt > PENDING_REPORT_TTL_MS) {
    pendingReports.delete(reportId);
    return undefined;
  }
  return report;
}

type WorkerSendResult =
  { ok: true; code: string; issueNumber: number } | { ok: false; message: string };

async function sendToSupportWorker(
  logs: string,
  reportType: "telemetry-auto" | "telemetry-prompted",
  banner: string
): Promise<WorkerSendResult> {
  if (SUPPORT_WORKER_URL.includes("REPLACE_ME")) {
    return { ok: false, message: "Log upload is not configured for this build." };
  }

  try {
    const response = await safeFetch(SUPPORT_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logs: `${banner}\n\n${logs}`,
        appVersion: APP_VERSION,
        platform: "server",
        timestamp: new Date().toISOString(),
        reportType,
      }),
      timeoutMs: WORKER_TIMEOUT_MS,
    });

    if (!response.ok) {
      return { ok: false, message: `Telemetry worker returned HTTP ${response.status}` };
    }

    const data = (await response.json()) as { code: string; issueNumber: number };
    return { ok: true, code: data.code, issueNumber: data.issueNumber };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Network error while sending telemetry report",
    };
  }
}

/**
 * Sends the confirmed pending report (user clicked "Send" in SendErrorReportDialog).
 * The report is reserved (removed from the map) before the outbound request so two
 * concurrent submissions can't both send it; it's restored only if delivery fails,
 * so the user can retry.
 */
export async function sendPendingReport(
  reportId: string,
  userId: string
): Promise<WorkerSendResult> {
  const report = getPendingReport(reportId, userId);
  if (!report) {
    return { ok: false, message: "This report is no longer available." };
  }
  pendingReports.delete(reportId);

  const banner =
    '=== QUESTARR AUTOMATED TELEMETRY REPORT (user-confirmed) ===\nSent after the user clicked "Send" on an error-detected notification.';
  const result = await sendToSupportWorker(report.logs, "telemetry-prompted", banner);
  if (!result.ok) {
    pendingReports.set(reportId, report);
  }
  return result;
}

async function buildScrubbedLogBundle(): Promise<{ logs: string; lineCount: number }> {
  try {
    const logPath = path.resolve(process.cwd(), "server.log");
    const lines = await readLastLogLines(logPath, LOG_CONTEXT_LINES);
    return { logs: scrubLogLines(lines), lineCount: lines.length };
  } catch (err) {
    telemetryLogger.warn({ error: err }, "Failed to read server.log for error telemetry");
    return { logs: "", lineCount: 0 };
  }
}

function buildAutoSendBanner(errorMessage: string, context: ErrorContext): string {
  const location = context.path ? ` (${context.method} ${context.path})` : "";
  const trigger = `${context.source}${location}`;
  return (
    "=== QUESTARR AUTOMATED TELEMETRY REPORT (auto-sent, no user confirmation) ===\n" +
    `Trigger: ${trigger}\n` +
    `Error: ${errorMessage}`
  );
}

interface UserTelemetryContext {
  user: User;
  prefs: NotificationPreferences;
  telemetryEnabled: boolean;
}

async function loadUserTelemetryContexts(users: User[]): Promise<UserTelemetryContext[]> {
  const contexts: UserTelemetryContext[] = [];
  for (const user of users) {
    const settings = await storage.getUserSettings(user.id);
    contexts.push({
      user,
      prefs: resolvePrefs(settings),
      telemetryEnabled: settings?.telemetryEnabled === true,
    });
  }
  return contexts;
}

/**
 * Builds (and, for a user, persists) the notification for one user's telemetry
 * context, reusing a single shared auto-send result across every opted-in user
 * so the Worker only receives one submission per detected error. Telemetry
 * auto-send runs independently of the "Error Detected" in-app preference —
 * that preference only gates whether a notification is created, not whether
 * an opted-in report is sent.
 */
function buildNotificationFor(
  ctx: UserTelemetryContext,
  autoSendResult: WorkerSendResult | null,
  pending: { logs: string; lineCount: number; timestamp: string } | null
): InsertNotification | null {
  const { user, prefs, telemetryEnabled } = ctx;

  if (telemetryEnabled) {
    if (!autoSendResult || !prefs.errorDetected.inApp) return null;
    return autoSendResult.ok
      ? {
          userId: user.id,
          type: "info",
          title: "Automated error report sent",
          message: `Questarr detected an error and automatically sent a diagnostic report. Support code: ${autoSendResult.code}.`,
        }
      : {
          userId: user.id,
          type: "warning",
          title: "Automated error report failed",
          message: `Questarr detected an error but could not send the automatic diagnostic report (${autoSendResult.message}).`,
        };
  }

  if (!prefs.errorDetected.inApp || !pending) return null;

  const reportId = randomUUID();
  pendingReports.set(reportId, {
    userId: user.id,
    logs: pending.logs,
    lineCount: pending.lineCount,
    appVersion: APP_VERSION,
    platform: "server",
    timestamp: pending.timestamp,
    createdAt: Date.now(),
  });

  return {
    userId: user.id,
    type: "warning",
    title: "An error occurred",
    message:
      "Questarr encountered an unexpected error. Click to review and optionally send a diagnostic report to help fix it.",
    link: `error-report:${reportId}`,
  };
}

async function dispatchNotification(
  ctx: UserTelemetryContext,
  notification: InsertNotification
): Promise<void> {
  const created = await storage.addNotification(notification);
  notifyUser("notification", created);
  if (ctx.prefs.errorDetected.apprise) appriseClient.send(created);
}

/**
 * Entry point called on every unhandled server error. Rate-limited by a single
 * global cooldown (not per-error-signature) to keep this simple and avoid
 * spamming users during a crash loop or a burst of related errors.
 */
export async function reportServerError(err: unknown, context: ErrorContext): Promise<void> {
  const now = Date.now();
  if (now - lastReportedAt < ERROR_REPORT_COOLDOWN_MS) {
    return;
  }
  lastReportedAt = now;

  try {
    purgeExpiredReports();

    const errorMessage = scrubPii(err instanceof Error ? err.message : String(err));
    const { logs, lineCount } = await buildScrubbedLogBundle();
    const timestamp = new Date().toISOString();

    const users = await storage.getAllUsers();
    const contexts = await loadUserTelemetryContexts(users);

    const anyoneOptedIn = contexts.some((ctx) => ctx.telemetryEnabled);
    const autoSendResult = anyoneOptedIn
      ? await sendToSupportWorker(
          logs,
          "telemetry-auto",
          buildAutoSendBanner(errorMessage, context)
        )
      : null;
    const pending = { logs, lineCount, timestamp };

    for (const ctx of contexts) {
      try {
        const notification = buildNotificationFor(ctx, autoSendResult, pending);
        if (notification) await dispatchNotification(ctx, notification);
      } catch (userError) {
        telemetryLogger.error(
          { error: userError, userId: ctx.user.id },
          "Failed to process error telemetry for user"
        );
      }
    }
  } catch (reportingError) {
    telemetryLogger.error({ error: reportingError }, "Failed to process automatic error report");
  }
}
