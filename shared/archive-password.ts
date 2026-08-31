import { parseJsonObject } from "./json-object-utils.js";

/**
 * Reads the default archive-unpack password configured for a downloader out of
 * its free-form `settings` JSON blob (the `archivePassword` key).
 */
export function getArchivePasswordSetting(settings: string | null | undefined): string | undefined {
  const { archivePassword } = parseJsonObject(settings);
  return typeof archivePassword === "string" ? archivePassword || undefined : undefined;
}

/**
 * Resolves the archive-unpack password a Usenet downloader (SABnzbd, NZBGet)
 * should send for a download: the per-request override if given, otherwise
 * the downloader's configured default. Refuses to hand back a password at all
 * when it would travel over a plain-HTTP connection, since both clients send
 * it in the clear (a query string or an XML-RPC request body) rather than
 * over an authenticated/encrypted channel.
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
