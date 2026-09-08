import { parseJsonObject } from "./json-object-utils.js";

/**
 * Reads the configured default archive-unpack password from a downloader's settings.
 *
 * @param settings - A JSON-encoded settings object
 * @returns The non-empty configured password, or `undefined` when no valid password is configured
 */
export function getArchivePasswordSetting(settings: string | null | undefined): string | undefined {
  const { archivePassword } = parseJsonObject(settings);
  return typeof archivePassword === "string" ? archivePassword || undefined : undefined;
}

/**
 * Resolves the archive password for a download and enforces HTTPS when a password is available.
 *
 * @param requestPassword - The password specified for the individual request
 * @param settings - JSON-encoded downloader settings containing the default password
 * @param baseUrl - The downloader base URL used to determine connection security
 * @param downloaderTypeLabel - The downloader name included in an insecure-connection error
 * @returns The resolved password, or an error message when sending it over HTTP is refused
 */
export function resolveArchivePassword(
  requestPassword: string | undefined,
  settings: string | null | undefined,
  baseUrl: string,
  downloaderTypeLabel: string
): { password?: string; error?: string } {
  const password = requestPassword || getArchivePasswordSetting(settings);
  if (password && !baseUrl.startsWith("https://")) {
    return {
      error:
        `Refusing to send the archive password over an insecure connection. ` +
        `Enable SSL for this ${downloaderTypeLabel} downloader, or remove the archive password.`,
    };
  }
  return { password };
}
