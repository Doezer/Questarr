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
import { scrubLogLines } from "../shared/log-scrub.js";
import { SUPPORT_WORKER_URL } from "../shared/support-config.js";
import type { InsertNotification } from "../shared/schema.js";

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
  for (const [id, report] of pendingReports) {
    if (report.createdAt < cutoff) pendingReports.delete(id);
  }
}

/** Used by GET /api/telemetry/pending/:reportId */
export function getPendingReport(reportId: string): PendingErrorReport | undefined {
  return pendingReports.get(reportId);
}

/** Used by POST /api/telemetry/pending/:reportId/send after a successful (or exhausted) attempt */
export function deletePendingReport(reportId: string): void {
  pendingReports.delete(reportId);
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

/** Sends the confirmed pending report (user clicked "Send" in SendErrorReportDialog). */
export async function sendPendingReport(reportId: string): Promise<WorkerSendResult> {
  const report = getPendingReport(reportId);
  if (!report) {
    return { ok: false, message: "This report is no longer available." };
  }

  const banner =
    "=== QUESTARR AUTOMATED TELEMETRY REPORT (user-confirmed) ===\n" +
    'Sent after the user clicked "Send" on an error-detected notification.';
  const result = await sendToSupportWorker(report.logs, "telemetry-prompted", banner);
  if (result.ok) deletePendingReport(reportId);
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

    const errorMessage = err instanceof Error ? err.message : String(err);
    const { logs, lineCount } = await buildScrubbedLogBundle();
    const timestamp = new Date().toISOString();

    const users = await storage.getAllUsers();
    for (const user of users) {
      try {
        const settings = await storage.getUserSettings(user.id);
        const prefs = resolvePrefs(settings);
        if (!prefs.errorDetected.inApp) continue;

        let notification: InsertNotification;

        if (settings?.telemetryEnabled) {
          const banner =
            "=== QUESTARR AUTOMATED TELEMETRY REPORT (auto-sent, no user confirmation) ===\n" +
            `Trigger: ${context.source}${context.path ? ` (${context.method} ${context.path})` : ""}\n` +
            `Error: ${errorMessage}`;
          const result = await sendToSupportWorker(logs, "telemetry-auto", banner);

          notification = result.ok
            ? {
                userId: user.id,
                type: "info",
                title: "Automated error report sent",
                message: `Questarr detected an error and automatically sent a diagnostic report. Support code: ${result.code}.`,
              }
            : {
                userId: user.id,
                type: "warning",
                title: "Automated error report failed",
                message: `Questarr detected an error but could not send the automatic diagnostic report (${result.message}).`,
              };
        } else {
          const reportId = randomUUID();
          pendingReports.set(reportId, {
            logs,
            lineCount,
            appVersion: APP_VERSION,
            platform: "server",
            timestamp,
            createdAt: now,
          });

          notification = {
            userId: user.id,
            type: "warning",
            title: "An error occurred",
            message:
              "Questarr encountered an unexpected error. Click to review and optionally send a diagnostic report to help fix it.",
            link: `error-report:${reportId}`,
          };
        }

        const created = await storage.addNotification(notification);
        notifyUser("notification", created);
        if (prefs.errorDetected.apprise) appriseClient.send(created);
      } catch (userError) {
        telemetryLogger.error(
          { error: userError, userId: user.id },
          "Failed to process error telemetry for user"
        );
      }
    }
  } catch (reportingError) {
    telemetryLogger.error({ error: reportingError }, "Failed to process automatic error report");
  }
}
