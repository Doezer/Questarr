/**
 * Triage metadata for support-log submissions (manual "Send Logs" and the
 * automatic error telemetry): a title signature, labels, a deduplicated
 * warn/error summary and a stable signature used to drop repeat submissions.
 *
 * Everything here is derived from text that has already been scrubbed, and the
 * helpers are pure so the browser and the server share one implementation.
 */
import { scrubFreeText, type ErrorGroup } from "./log-summary.js";

export type ReportTrigger = "manual" | "auto" | "prompted";

export interface ReportMeta {
  trigger: ReportTrigger;
  appVersion: string;
  platform: string;
  /** Warn/error groups from `summarizeErrors`, most frequent first. */
  groups: ErrorGroup[];
  /** Raw log lines, used for the signature when there are no warnings or errors. */
  tail?: string[];
  /** Optional "What were you doing?" text from the user. */
  note?: string;
  /** Optional correlation info for an automatic report (`GET /api/x`, request id). */
  context?: string;
}

export interface ReportEnvelope {
  title: string;
  labels: string[];
  signature: string;
  /** Text placed at the very top of the stored log. */
  header: string;
}

const MAX_TITLE = 120;
const MAX_NOTE = 1000;
const MAX_LABEL = 50;
const MAX_SUMMARY_GROUPS = 10;

/** Small, stable, dependency-free hash (FNV-1a, 32 bit) rendered as hex. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Identifies "the same problem": the module and message of each warn/error
 * group, ignoring counts and timestamps, so a retry a minute later (more
 * occurrences, newer times) still hashes the same.
 */
export function reportSignature(groups: ErrorGroup[], tail: string[] = []): string {
  if (groups.length === 0) {
    // Nothing failed: fall back to the log tail, minus the volatile timestamps.
    const stable = tail.slice(-20).map((line) => line.replace(/"time":"[^"]*"/, ""));
    return hashText(stable.join("\n"));
  }
  // Every group counts: a display cap here would let a count change swap which problems are hashed.
  const keys = groups
    .map((group) => `${group.module}|${group.message}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hashText(keys.join("\n"));
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function labelSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clipText(slug, MAX_LABEL);
}

export function buildReportTitle(meta: ReportMeta): string {
  const prefix = meta.trigger === "manual" ? "Support log" : "Error report";
  const first = meta.groups[0];
  const subject = first ? `${first.module}: ${first.message}` : "no warnings or errors in logs";
  return clipText(`${prefix} v${meta.appVersion} - ${subject}`, MAX_TITLE);
}

export function buildReportLabels(meta: ReportMeta): string[] {
  const labels = [`trigger:${meta.trigger}`, `version:${labelSlug(meta.appVersion)}`];
  if (meta.platform) labels.push(`platform:${labelSlug(meta.platform)}`);
  const first = meta.groups[0];
  if (first) labels.push(`module:${labelSlug(first.module)}`);
  return labels.filter((label) => !label.endsWith(":"));
}

/** Deduplicated warn/error digest, one line per distinct problem. */
export function formatErrorSummary(groups: ErrorGroup[]): string {
  const lines = groups.slice(0, MAX_SUMMARY_GROUPS).map((group) => {
    const range =
      group.firstSeen && group.lastSeen && group.firstSeen !== group.lastSeen
        ? ` (${group.firstSeen} -> ${group.lastSeen})`
        : group.lastSeen
          ? ` (${group.lastSeen})`
          : "";
    return `${group.count}x [${group.module}] ${group.message}${range}`;
  });
  return lines.length > 0 ? lines.join("\n") : "No warnings or errors in the attached logs.";
}

/** Scrubs and clips the user's free text; empty input yields an empty string. */
export function cleanNote(note: string | undefined): string {
  const trimmed = (note ?? "").trim();
  if (!trimmed) return "";
  return clipText(scrubFreeText(trimmed).replace(/\s+/g, " "), MAX_NOTE);
}

export function buildReportEnvelope(meta: ReportMeta): ReportEnvelope {
  const title = buildReportTitle(meta);
  const labels = buildReportLabels(meta);
  const signature = reportSignature(meta.groups, meta.tail);
  const note = cleanNote(meta.note);
  const lines = [
    "=== QUESTARR SUPPORT REPORT ===",
    `Title: ${title}`,
    `Labels: ${labels.join(", ")}`,
    `Signature: ${signature}`,
  ];
  if (meta.context) lines.push(`Context: ${scrubFreeText(meta.context)}`);
  if (note) lines.push(`What the user was doing: ${note}`);
  lines.push("=== ERROR SUMMARY (warnings and errors, deduplicated) ===");
  lines.push(formatErrorSummary(meta.groups));
  lines.push("=== END SUMMARY ===");
  return { title, labels, signature, header: lines.join("\n") };
}

// ── Duplicate suppression ────────────────────────────────────────────────────

export const DEDUP_COOLDOWN_MS = 60 * 60 * 1000;

export interface SentRecord {
  signature: string;
  sentAt: number;
  /** Support code the worker returned, to show instead of re-sending. */
  code?: string;
}

/** The earlier submission of the same signature inside the cooldown window, if any. */
export function findDuplicateReport(
  signature: string,
  recent: SentRecord[],
  now: number,
  cooldownMs: number = DEDUP_COOLDOWN_MS
): SentRecord | undefined {
  return recent.find((entry) => entry.signature === signature && now - entry.sentAt < cooldownMs);
}

export function rememberReport(
  record: SentRecord,
  recent: SentRecord[],
  cooldownMs: number = DEDUP_COOLDOWN_MS
): SentRecord[] {
  return [...recent.filter((entry) => record.sentAt - entry.sentAt < cooldownMs), record];
}
