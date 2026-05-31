/**
 * Log submission utilities.
 *
 * PII scrubbing covers patterns found in Questarr's server log fields:
 *  - Email addresses   (e.g. auth logs, Steam import errors)
 *  - IPv4/IPv6         (e.g. express access logs, socket connections)
 *  - UUIDs             (e.g. socket IDs formatted as UUIDs, download hashes)
 *  - JWT tokens        (defensive — tokens should never be logged)
 *  - OS home-dir paths (e.g. /home/alice/… or C:\Users\alice\…)
 */

import { SUPPORT_WORKER_URL, GITHUB_ISSUES_URL } from "./support-config";

// ── PII patterns ──────────────────────────────────────────────────────────────

/** RFC-5321 local part + domain — catches most real email addresses */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** IPv4 candidates are validated after matching to keep the regex maintainable */
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** IPv6 candidates are validated after matching to avoid an overly complex regex */
const IPV6_RE = /\b[A-Fa-f0-9:]{2,}\b/g;

/** RFC-4122 UUID */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** JWT (three base64url segments starting with eyJ…) */
const JWT_RE = /eyJ[A-Za-z0-9+/=_-]+\.eyJ[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+/g;

/**
 * Unix home dir:   /home/alice/… or /Users/alice/…
 * Windows home dir: C:\Users\alice\… (backslash or forward slash)
 */
const HOME_PATH_RE = /(?:\/(?:home|Users)|[A-Za-z]:\\[Uu]sers)[\\/]([^\\/\s"',:}]{1,64})/g;
const WINDOWS_USERS_SEGMENT = String.raw`\Users`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Replace PII in a single log string (raw NDJSON line or plain text).
 * Each regex is applied independently so replacements don't interfere.
 */
export function scrubPii(text: string): string {
  return text
    .replace(JWT_RE, "[jwt]") // before email — JWTs contain dots
    .replace(EMAIL_RE, "[email]")
    .replace(IPV6_RE, (match) => (isIpv6(match) ? "[ip]" : match))
    .replace(IPV4_RE, (match) => (isIpv4(match) ? "[ip]" : match))
    .replace(UUID_RE, "[uuid]")
    .replace(HOME_PATH_RE, (_match, _username: string) => {
      const prefix = _match.startsWith("/")
        ? "/home"
        : _match.substring(0, 2) + WINDOWS_USERS_SEGMENT;
      const sep = _match.includes("\\") ? "\\" : "/";
      return `${prefix}${sep}[user]`;
    });
}

/**
 * Scrub all lines and join them back into a newline-delimited string.
 */
export function scrubLogLines(lines: string[]): string {
  return lines.map(scrubPii).join("\n");
}

function isIpv4(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const parsed = Number(octet);
      return parsed >= 0 && parsed <= 255;
    })
  );
}

function isIpv6(value: string): boolean {
  if (!value.includes(":")) return false;

  const compressedGroups = value.split("::");
  if (compressedGroups.length > 2) return false;

  const groups = value.split(":");
  if (groups.length < 3 || groups.length > 8) return false;

  return groups.every((group) => group === "" || /^[0-9a-fA-F]{1,4}$/.test(group));
}

// ── Worker communication ──────────────────────────────────────────────────────

export interface SendLogsPayload {
  logs: string;
  appVersion: string;
  platform: string;
  timestamp: string;
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

  let response: Response;
  try {
    response = await fetch(SUPPORT_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Network error — check your connection.",
    };
  }

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
}

// ── GitHub issue URL builder ──────────────────────────────────────────────────

/**
 * Builds a URL to open a new issue in the public Questarr repo.
 * The body is pre-filled with the support log number so the maintainer
 * can look it up in the private log repository.
 */
export function buildGitHubIssueUrl(code: string, appVersion: string): string {
  const title = encodeURIComponent(`[Support] Issue with Questarr v${appVersion}`);
  const body = encodeURIComponent(
    `**Support log #:** \`${code}\`\n` +
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
