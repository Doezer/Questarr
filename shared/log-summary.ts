/**
 * Error digest shared by the support-log flows: the server's diagnostics block,
 * the automatic error telemetry and the client's manual "Send Logs" dialog.
 *
 * Pure text processing with no server imports, so the browser bundle can use it.
 */
import { scrubPii } from "./log-scrub.js";

const MAX_ERROR_GROUPS = 15;
const MAX_ERROR_TEXT = 200;

export interface ErrorGroup {
  count: number;
  module: string;
  message: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

/**
 * Strips what `scrubPii` leaves behind in free text: URL hosts, DNS names after
 * resolver errors, and absolute filesystem paths (it only handles home dirs).
 */
export function scrubFreeText(text: string): string {
  return (
    scrubPii(text)
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/"'<>]+/gi, "$1[host]")
      .replace(/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET)\s+\S+/g, "$1 [host]")
      .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b(?::\d+)?/gi, "[host]")
      // A path glued to a redacted host (`[host]/a/b`, `[host]:/volume1/x`) goes with it.
      .replace(/\[host\](?::\d*)?\/[^\s"']*/g, "[host]")
      // `scrubPii` leaves `/home/[user]` and `[ip]` markers behind: take the rest of the path too.
      .replace(/\/home\/\[user\](?:\/[^\s"']*)?/g, "[path]")
      .replace(/(\[ip(?::[a-z]+)?\])(?::\d*)?\/[^\s"']*/g, "$1")
      .replace(/(?<![\w.:)\]])\/[\w.-]+(?:\/[\w.-]*)*/g, "[path]")
      .replace(/\b[A-Za-z]:\\[^\s"']+/g, "[path]")
  );
}

function clip(text: string): string {
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text;
}

/** Name, code and message of a logged error (a string or the serialized `{ name, message, code }`). */
function describeLoggedError(field: unknown): string {
  if (typeof field === "string") return field;
  if (!field || typeof field !== "object") return "";
  const { name, code, message } = field as Record<string, unknown>;
  const parts = [typeof name === "string" ? name : "", typeof code === "string" ? code : ""];
  const text = typeof message === "string" ? message : "";
  const label = parts.filter(Boolean).join(" ");
  return [label, text].filter(Boolean).join(": ");
}

/**
 * Groups warn/error/fatal NDJSON lines by module and message so a long log
 * collapses into "21x HTTP 401 ..." rather than 21 near-identical lines.
 */
export function summarizeErrors(lines: string[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      entry = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry.level !== "number" || entry.level < 40) continue;

    const module = typeof entry.module === "string" ? entry.module : "unknown";
    const errorMessage = describeLoggedError(entry.error ?? entry.err);
    const msg = typeof entry.msg === "string" ? entry.msg : "";
    const message = clip(scrubFreeText([msg, errorMessage].filter(Boolean).join(": ")));
    const time = typeof entry.time === "string" ? entry.time : null;

    const key = `${module}|${message}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = time ?? existing.lastSeen;
    } else {
      groups.set(key, { count: 1, module, message, firstSeen: time, lastSeen: time });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_ERROR_GROUPS);
}
