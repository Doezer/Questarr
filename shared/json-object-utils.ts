/**
 * Parses a JSON string into a plain object, rejecting anything that isn't one
 * (null, arrays, primitives, or invalid JSON) by falling back to `{}`.
 *
 * Used for free-form per-type settings blobs (e.g. a downloader's `settings`
 * column) where callers read/write individual keys and must never operate on
 * a non-object value.
 */
export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
