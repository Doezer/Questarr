// Small, dependency-free security helpers shared across the server. Keep
// additions here narrowly scoped -- this is not a place for a general
// utility grab-bag.

// The text-level secret redaction (`redactSecretText`) lives in
// `shared/log-scrub.ts` so the client's manual "Send Logs" flow and the
// server's automatic error-telemetry flow -- neither of which import from
// `server/` -- apply the exact same redaction as this pino formatter. Re-exported
// here so existing server-side callers/imports are unaffected.
import { redactSecretText } from "../shared/log-scrub.js";
export { redactSecretText } from "../shared/log-scrub.js";

const SECRET_KEY_PATTERN =
  /(api[_-]?key|apikey|authorization|bearer|client[_-]?secret|cookie|csrf|jwt|password|secret|token|webhook)/i;

/**
 * Recursively redact values whose key looks secret-shaped (api_key, token,
 * password, secret, authorization, ...), and run redactSecretText over every
 * remaining string. Used as a pino `formatters.log` hook so structured log
 * fields never leak credentials, even if a caller accidentally logs a raw
 * config/downloader/indexer object.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Redacted: depth limit]";
  if (value == null) return value;
  if (typeof value === "string") return redactSecretText(value);
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactSecretText(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(entry, depth + 1);
  }
  return redacted;
}
