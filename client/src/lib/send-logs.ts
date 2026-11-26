/**
 * Log submission utilities for the client's manual "Send Logs" flow (the
 * "Send Logs" button on the Logs page).
 *
 * PII scrubbing lives in `@shared/log-scrub` so it can also be used by the
 * server's automatic error-telemetry flow (see `server/error-telemetry.ts`)
 * without duplicating the regexes in two places.
 */

import { SUPPORT_WORKER_URL, GITHUB_ISSUES_URL } from "./support-config";
import { apiFetch } from "./queryClient";
import { scrubPii, scrubLogLines } from "@shared/log-scrub";
import { summarizeErrors } from "@shared/log-summary";
import {
  buildReportEnvelope,
  cleanNote,
  findDuplicateReport,
  rememberReport,
  reportSignature,
  type SentRecord,
} from "@shared/support-report";

export { scrubPii, scrubLogLines } from "@shared/log-scrub";

// ── Worker communication ──────────────────────────────────────────────────────

export interface SendLogsPayload {
  logs: string;
  appVersion: string;
  platform: string;
  timestamp: string;
  /**
   * Distinguishes a manual user-initiated submission (omitted, the default)
   * from a telemetry report triggered by automatic error detection
   * (`server/error-telemetry.ts`). The worker doesn't act on this field yet —
   * it's forwarded so a future worker update can use it (e.g. for labeling).
   */
  reportType?: "telemetry-auto" | "telemetry-prompted";
  /** Triage metadata (title signature, labels, dedup signature). The worker may ignore it. */
  title?: string;
  labels?: string[];
  signature?: string;
  /** Scrubbed free text from "What were you doing?". Also repeated at the top of `logs`. */
  note?: string;
}

export interface SendLogsSuccess {
  ok: true;
  code: string;
  issueNumber: number;
}

export interface SendLogsFailure {
  ok: false;
  status: number;
  message: string;
}

export type SendLogsResult = SendLogsSuccess | SendLogsFailure;

export async function sendLogs(payload: SendLogsPayload): Promise<SendLogsResult> {
  if (SUPPORT_WORKER_URL.includes("REPLACE_ME")) {
    return {
      ok: false,
      status: 0,
      message: "Log upload is not configured for this build.",
    };
  }

  try {
    const response = await fetch(SUPPORT_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = (await response.json()) as { code: string; issueNumber: number };
      return { ok: true, code: data.code, issueNumber: data.issueNumber };
    }

    const errorMessages: Record<number, string> = {
      413: "Log payload is too large (> 500 KB). Try clearing old logs first.",
      429: "Rate limit reached (5 submissions per hour). Try again later.",
      502: "Log server could not reach GitHub. Try again in a moment.",
    };

    let message = errorMessages[response.status] ?? `Unexpected error (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore — use the default message
    }

    return { ok: false, status: response.status, message };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Network error — check your connection.",
    };
  }
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Fetches the server's secret-free configuration summary and error digest
 * (`GET /api/diagnostics`). Returns an empty string on any failure so a log
 * submission is never blocked by the extra context.
 */
const DIAGNOSTICS_TIMEOUT_MS = 5000;

export async function fetchDiagnosticsReport(): Promise<string> {
  try {
    const response = await apiFetch("/api/diagnostics", {
      signal: AbortSignal.timeout(DIAGNOSTICS_TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { report?: unknown };
    return typeof data.report === "string" ? scrubPii(data.report) : "";
  } catch {
    return "";
  }
}

/** Places the diagnostics block (when available) ahead of the scrubbed logs. */
export function withDiagnostics(diagnostics: string, logs: string): string {
  return diagnostics ? `${diagnostics}\n\n${logs}` : logs;
}

// ── Report preparation and duplicate suppression ──────────────────────────────

const SENT_REPORTS_KEY = "questarr.sentSupportReports";

export function loadSentReports(): SentRecord[] {
  try {
    const raw = localStorage.getItem(SENT_REPORTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is SentRecord =>
            Boolean(entry) &&
            typeof entry.signature === "string" &&
            typeof entry.sentAt === "number"
        )
      : [];
  } catch {
    return [];
  }
}

/** Remembers a successful submission so an identical one is flagged for an hour. */
export function recordSentReport(signature: string, code: string, now: number): void {
  try {
    localStorage.setItem(
      SENT_REPORTS_KEY,
      JSON.stringify(rememberReport({ signature, sentAt: now, code }, loadSentReports()))
    );
  } catch {
    // Storage can be unavailable (private window): duplicate detection is best effort.
  }
}

/** The submission of the same problem in the last hour, if any. */
export function findRecentDuplicate(logLines: string[], now: number): SentRecord | undefined {
  const signature = reportSignature(summarizeErrors(logLines, Infinity), logLines);
  return findDuplicateReport(signature, loadSentReports(), now);
}

export interface PreparedReport {
  logs: string;
  title: string;
  labels: string[];
  signature: string;
  note: string;
}

/**
 * Builds the text and triage metadata for a manual submission: a summary of the
 * warnings and errors plus the user's note on top, then the diagnostics block,
 * then the scrubbed logs.
 */
export function prepareReport(options: {
  logLines: string[];
  diagnostics: string;
  note: string;
  appVersion: string;
  platform: string;
}): PreparedReport {
  const envelope = buildReportEnvelope({
    trigger: "manual",
    appVersion: options.appVersion,
    platform: options.platform,
    groups: summarizeErrors(options.logLines, Infinity),
    tail: options.logLines,
    note: options.note,
  });
  const body = withDiagnostics(options.diagnostics, scrubLogLines(options.logLines));
  return {
    logs: `${envelope.header}\n\n${body}`,
    title: envelope.title,
    labels: envelope.labels,
    signature: envelope.signature,
    note: cleanNote(options.note),
  };
}

// ── GitHub issue URL builder ──────────────────────────────────────────────────

/** Owner/repo of the private log repository, used to build a cross-repo issue reference. */
const LOG_REPO = "Doezer/Questarr-logs";

/**
 * Builds a URL to open a new issue in the public Questarr repo.
 * The body is pre-filled with the support log number and a direct cross-repo
 * reference to the corresponding issue in the private log repository, so the
 * maintainer (or an assistant with access to both repos) can jump straight
 * from the public issue to the matching log entry.
 */
export function buildGitHubIssueUrl(code: string, appVersion: string, issueNumber: number): string {
  const title = encodeURIComponent(`[Support] Issue with Questarr v${appVersion}`);
  const body = encodeURIComponent(
    `**Support log #:** \`${code}\` (${LOG_REPO}#${issueNumber})\n` +
      `**App version:** ${appVersion}\n\n` +
      `<!-- Describe what happened and the steps to reproduce it. -->\n`
  );
  return `${GITHUB_ISSUES_URL}?title=${title}&body=${body}`;
}

// ── Platform detection ────────────────────────────────────────────────────────

export function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X|macOS/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}
