/**
 * PII scrubbing for log content, shared between the client (manual "Send Logs" flow)
 * and the server (automatic error-telemetry flow).
 *
 * Patterns cover what shows up in Questarr's log fields:
 *  - Email addresses   (e.g. auth logs, Steam import errors)
 *  - IPv4/IPv6         (e.g. express access logs, socket connections)
 *  - UUIDs             (e.g. socket IDs formatted as UUIDs, download hashes)
 *  - JWT tokens        (defensive — tokens should never be logged)
 *  - OS home-dir paths (e.g. /home/alice/… or C:\Users\alice\…)
 *  - Secret-shaped text (indexer/downloader API keys, tokens, passwords, Bearer
 *    headers, webhook URLs — see `redactSecretText` below)
 *
 * Server-side, structured log fields are already redacted at write time by
 * `server/security.ts`'s pino formatter (`redactSecrets`), so `server.log`
 * should never contain a raw secret in the first place. `redactSecretText` is
 * defined here (rather than only in `server/security.ts`) so this module's
 * `scrubPii`/`scrubLogLines` — used by both the client's manual "Send Logs"
 * flow and the server's automatic error-telemetry flow — apply the exact same
 * secret redaction as a second layer before log content ever leaves the
 * instance, in case a secret slips into a log line some other way (e.g. a raw
 * response body or an un-redacted string field).
 */

// ── Secret-shaped text ────────────────────────────────────────────────────────

/**
 * Redact common secret-shaped substrings (api_key=..., Bearer <token>, etc.)
 * out of a plain string before it reaches a log sink or leaves the instance.
 */
export function redactSecretText(value: string): string {
  return (
    value
      .replace(
        /\b(apikey|api[_-]?key|token|password|secret)["']?\s*[:=]\s*["']?([^"',\s&]+)["']?/gi,
        "$1=[redacted]"
      )
      // The /i flag already folds case, so an explicit A-Z range here would
      // duplicate a-z -- SonarCloud flags that as a redundant character class.
      .replace(/(Bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[redacted]")
      .replace(
        /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'<>]+/gi,
        "[redacted-discord-webhook]"
      )
  );
}

// ── PII patterns ──────────────────────────────────────────────────────────────

/** IPv4 candidates are validated after matching to keep the regex maintainable */
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** IPv6 candidates are validated after matching to avoid an overly complex regex */
const IPV6_RE = /(?<![A-Fa-f0-9:])[A-Fa-f0-9:]{2,}(?![A-Fa-f0-9:])/g;

/** RFC-4122 UUID */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** JWT (three base64url segments starting with eyJ…) */
const JWT_RE = /eyJ[A-Za-z0-9+/=_-]+\.eyJ[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+/g;

/**
 * Unix home dir:   /home/alice/… or /Users/alice/…
 * Windows home dir: C:\Users\alice\… (backslash or forward slash)
 */
const HOME_PATH_RE = /(?:\/(?:home|Users)|[A-Za-z]:[\\/][Uu]sers)[\\/]([^\\/\s"',:}]{1,64})/g;
const WINDOWS_USERS_SEGMENT = String.raw`\Users`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Replace PII in a single log string (raw NDJSON line or plain text).
 * Each regex is applied independently so replacements don't interfere.
 */
export function scrubPii(text: string): string {
  return redactSecretText(
    scrubEmailAddresses(text)
      .replace(JWT_RE, "[jwt]") // before email — JWTs contain dots
      .replace(IPV6_RE, (match) => (isIpv6(match) ? "[ip]" : match))
      .replace(IPV4_RE, (match) => (isIpv4(match) ? "[ip]" : match))
      .replace(UUID_RE, "[uuid]")
      .replace(HOME_PATH_RE, (_match, _username: string) => {
        const prefix = _match.startsWith("/")
          ? "/home"
          : _match.substring(0, 2) + WINDOWS_USERS_SEGMENT;
        const sep = _match.includes("\\") ? "\\" : "/";
        return `${prefix}${sep}[user]`;
      })
  );
}

function scrubEmailAddresses(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const atIndex = text.indexOf("@", cursor);
    if (atIndex === -1) {
      result += text.slice(cursor);
      break;
    }

    let start = atIndex - 1;
    while (start >= cursor && isEmailLocalChar(text[start])) {
      start--;
    }

    let end = atIndex + 1;
    while (end < text.length && isEmailDomainChar(text[end])) {
      end++;
    }

    const candidate = text.slice(start + 1, end);
    if (isLikelyEmail(candidate)) {
      result += text.slice(cursor, start + 1);
      result += "[email]";
      cursor = end;
      continue;
    }

    result += text.slice(cursor, atIndex + 1);
    cursor = atIndex + 1;
  }

  return result;
}

function isEmailLocalChar(char: string): boolean {
  return /[A-Za-z0-9._%+-]/.test(char);
}

function isEmailDomainChar(char: string): boolean {
  return /[A-Za-z0-9.-]/.test(char);
}

function isLikelyEmail(candidate: string): boolean {
  const atIndex = candidate.indexOf("@");
  if (atIndex <= 0 || atIndex !== candidate.lastIndexOf("@")) return false;

  const domain = candidate.slice(atIndex + 1);
  if (!domain || domain.startsWith(".") || domain.endsWith(".")) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;

  return labels.every(
    (label) =>
      label.length > 0 &&
      !label.startsWith("-") &&
      !label.endsWith("-") &&
      /^[A-Za-z0-9-]+$/.test(label)
  );
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
  if (compressedGroups.length === 1 && groups.length !== 8) return false;

  return groups.every((group) => group === "" || /^[0-9a-fA-F]{1,4}$/.test(group));
}
