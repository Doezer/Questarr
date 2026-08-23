// Small, dependency-free security helpers shared across the server. Keep
// additions here narrowly scoped -- this is not a place for a general
// utility grab-bag.

const SECRET_KEY_PATTERN =
  /(api[_-]?key|apikey|authorization|bearer|client[_-]?secret|cookie|csrf|jwt|password|secret|token|webhook)/i;

/**
 * Redact common secret-shaped substrings (api_key=..., Bearer <token>, etc.)
 * out of a plain string before it reaches a log sink.
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
