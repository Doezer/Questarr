/**
 * Parses a JSON string into an object for use as key-value settings.
 *
 * @param value - The JSON string to parse
 * @returns The parsed object, or an empty object for missing, invalid, or non-object JSON values
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
