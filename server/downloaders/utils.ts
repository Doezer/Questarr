import { downloadersLogger } from "../logger.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";
import { isDownloaderDebugLoggingEnabled } from "./debug-logging.js";
import type { DownloadFile } from "@shared/schema.js";

export const DOWNLOAD_CLIENT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// Prowlarr (and some Newznab/Torznab indexers) wrap external download URLs in a proxy
// URL whose `link` query parameter is a standard base64 value that can contain `+`.
// ASP.NET Core (Prowlarr's backend) decodes `+` as space in query strings, corrupting
// the base64 and producing "Invalid link" errors. Re-encode `+` as `%2B` in the `link`
// parameter only — other parameters may legitimately use `+` to represent a space
// (e.g. `file=my+game.torrent`), and converting those would break the 400-retry path.
export function fixNzbUrlEncoding(rawUrl: string): string {
  const qIdx = rawUrl.indexOf("?");
  if (qIdx === -1) return rawUrl;
  const base = rawUrl.slice(0, qIdx + 1);
  const fixedQuery = rawUrl
    .slice(qIdx + 1)
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return part;
      if (part.slice(0, eq) !== "link") return part;
      return part.slice(0, eq + 1) + part.slice(eq + 1).replace(/\+/g, "%2B");
    })
    .join("&");
  return base + fixedQuery;
}

/**
 * Extract torrent info hash from a magnet URI.
 * Standardizes to lowercase as per BitTorrent specification (case-insensitive hex encoding).
 *
 * @param url - The magnet URI or torrent URL
 * @returns The info hash in lowercase, or null if not found
 */
export function extractHashFromUrl(url: string): string | null {
  // Extract hash from magnet link - supports both hex (40 chars) and base32 (32 chars) formats
  const magnetMatch = url.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (magnetMatch) {
    return magnetMatch[1].toLowerCase();
  }
  return null;
}

/**
 * Fetches a URL while manually following redirects to detect magnet link redirects.
 * Standard fetch follows HTTP redirects automatically but silently fails when the chain
 * includes a protocol change (HTTP → magnet:), losing the magnet URI.
 * This helper intercepts each redirect and returns the magnet link if detected.
 */
export async function fetchWithMagnetDetection(
  url: string,
  maxRedirects = 5
): Promise<{ response?: Response; magnetLink?: string }> {
  // Fix Prowlarr/indexer URL encoding: `+` in base64 `link` query params must be
  // re-encoded as `%2B` so ASP.NET Core (Prowlarr backend) decodes them correctly.
  let currentUrl = fixNzbUrlEncoding(url);
  let redirects = 0;

  const fetchUrl = async (targetUrl: string) => {
    if (!(await isSafeUrl(targetUrl))) {
      throw new Error(`Unsafe URL blocked: ${targetUrl}`);
    }
    return safeFetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": DOWNLOAD_CLIENT_USER_AGENT,
        Accept: "application/x-bittorrent, */*",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  };

  while (redirects < maxRedirects) {
    let response = await fetchUrl(currentUrl);

    // Simple retry for 400 Bad Request with '+' in URL (some indexers encode spaces as '+')
    if (!response.ok && response.status === 400 && currentUrl.includes("+")) {
      try {
        const urlObj = new URL(currentUrl);
        const originalSearch = urlObj.search;
        const fixedSearch = originalSearch.replace(/\+/g, "%20");
        if (fixedSearch !== originalSearch) {
          urlObj.search = fixedSearch;
          const fixedUrl = urlObj.toString();
          downloadersLogger.warn(
            { original: currentUrl, fixed: fixedUrl },
            "Retrying download with %20 instead of + in query string"
          );
          response = await fetchUrl(fixedUrl);
        }
      } catch (parseError) {
        downloadersLogger.warn(
          { url: currentUrl, error: parseError },
          "Failed to parse URL when attempting '+' to '%20' retry"
        );
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { response };
      }

      downloadersLogger.debug(
        { currentUrl, location, status: response.status },
        "Download URL returned redirect"
      );

      if (location.startsWith("magnet:")) {
        downloadersLogger.info("Download URL redirected to a magnet link");
        return { magnetLink: location };
      }

      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch (error) {
        downloadersLogger.warn({ location, error }, "Failed to parse redirect URL");
        return { response };
      }

      redirects++;
      continue;
    }

    return { response };
  }

  throw new Error(`Too many redirects (max ${maxRedirects})`);
}

/**
 * Resolves the path segment (relative to a download's downloadDir) that
 * actually holds its content on disk.
 *
 * Torrent clients only create a subfolder named after the torrent for
 * multi-file torrents. A single-file torrent (with "original" content
 * layout) is saved directly in downloadDir under its own filename, which
 * can differ from the torrent's display name — using the torrent name in
 * that case points at a subfolder that never existed.
 */
export function resolveDownloadRelativePath(details: {
  name: string;
  files?: DownloadFile[];
}): string {
  if (details.files?.length === 1 && details.files[0].name) {
    return details.files[0].name;
  }
  return details.name;
}

// Query params that commonly carry a secret (API keys, session tokens, passwords),
// masked before a URL is written to the debug log.
const SENSITIVE_URL_PARAMS = new Set([
  "apikey",
  "api_key",
  "token",
  "password",
  "passwd",
  "pass",
  "auth",
  "secret",
  "sid",
  "_sid",
]);

/** Masks known secret-bearing query parameters in a URL before logging it. */
export function redactSensitiveUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_URL_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, "***");
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// Cap how much of a response body gets read (in bytes) for the debug log so a
// large download-client response (or an unexpectedly binary one) can't blow
// up the log file or memory - the cloned stream is read only up to this limit
// and then cancelled, so the rest of the body is never buffered.
const MAX_DEBUG_BODY_LENGTH = 10_000;

// Response headers that can carry a reusable credential (e.g. a session
// cookie or token), redacted before a response is written to the debug log.
// Transmission returns its session ID in this header (see transmission.ts),
// which callers then replay on every later request.
const SENSITIVE_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "authorization",
  "x-transmission-session-id",
]);

/** Masks known credential-bearing response headers before logging them. */
function redactSensitiveHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key] = SENSITIVE_RESPONSE_HEADERS.has(key.toLowerCase()) ? "***" : value;
  }
  return result;
}

// JSON field names that commonly carry a reusable credential in a downloader's
// response body (e.g. Synology's login response includes a `sid` that's
// persisted and replayed as `_sid` on later requests - see synology.ts).
// Matched against `"name": "value"` pairs in the raw response text rather
// than via a full JSON.parse, so redaction still applies to a body that was
// truncated mid-object.
const SENSITIVE_BODY_FIELD_PATTERN =
  /("(?:sid|_sid|token|api_?key|password|passwd|secret|auth)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

/** Masks known credential-bearing JSON fields in a response body before logging it. */
function redactSensitiveBody(bodyText: string): string {
  return bodyText.replace(SENSITIVE_BODY_FIELD_PATTERN, '$1"***"');
}

/**
 * Reads a cloned response body, keeping only the first `MAX_DEBUG_BODY_LENGTH`
 * bytes in memory. Stops pulling from the stream as soon as the cap is hit -
 * rather than draining it to completion - so a response that never ends (or
 * is just very large) can't block the request or grow memory unbounded.
 * `cancel()` is fired without awaiting it: cancelling one branch of a
 * `response.clone()`'d stream can hang indefinitely on some fetch
 * implementations if you wait on it, but an unawaited cancel is safe and
 * still lets the original branch keep flowing to the caller.
 */
async function readTruncatedBody(
  response: Response
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    return { text: await response.text(), truncated: false };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  let truncated = false;

  try {
    while (bytesRead < MAX_DEBUG_BODY_LENGTH) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = MAX_DEBUG_BODY_LENGTH - bytesRead;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.slice(0, remaining), { stream: true });
        bytesRead += remaining;
        truncated = true;
      } else {
        text += decoder.decode(value, { stream: true });
        bytesRead += value.byteLength;
      }
    }

    if (bytesRead >= MAX_DEBUG_BODY_LENGTH) {
      // The stream may still have more data we're choosing not to read -
      // don't wait on cancellation, just stop pulling.
      truncated = true;
      void reader.cancel().catch(() => {});
    }
  } finally {
    reader.releaseLock();
  }

  text += decoder.decode();
  return { text, truncated };
}

/**
 * Logs the response of a downloader API call at `debug` level, gated behind
 * the "downloaders.debugLogging" setting. No-op (and no extra work, including
 * cloning the response) when the setting is off.
 *
 * Clones the response before reading it, so callers can still consume the
 * original response body (`.text()`/`.json()`) as usual afterwards. The body
 * is read up to a fixed byte cap and the rest of the stream is cancelled
 * rather than buffered, so a large or unbounded response can't blow up
 * memory or the log file.
 */
export async function logDownloaderDebugResponse(
  client: string,
  method: string,
  url: string,
  response: Response
): Promise<void> {
  if (!isDownloaderDebugLoggingEnabled()) return;

  try {
    const { text: bodyText, truncated } = await readTruncatedBody(response.clone());
    downloadersLogger.debug(
      {
        client,
        method,
        url: redactSensitiveUrl(url),
        responseStatus: response.status,
        responseHeaders: redactSensitiveHeaders(response.headers),
        responseBody: truncated
          ? `${redactSensitiveBody(bodyText)}... [truncated]`
          : redactSensitiveBody(bodyText),
      },
      "Downloader debug: full response"
    );
  } catch (error) {
    downloadersLogger.warn(
      { error, client, url: redactSensitiveUrl(url) },
      "Failed to log downloader debug response"
    );
  }
}

/**
 * Joins a download's directory with its resolved relative path, without
 * duplicating a segment that's already present.
 *
 * Usenet clients (NZBGet, SABnzbd) don't expose per-file details, so
 * resolveDownloadRelativePath() always falls back to the release name — but
 * for those clients `downloadDir` already IS the final content directory
 * (its own name is the release name), unlike torrent clients where it's a
 * genuine parent. Naively appending the relative path in that case produces
 * a nonexistent nested path like ".../Release Name/Release Name".
 */
export function buildRemoteImportPath(downloadDir: string, relativePath: string): string {
  const normalizedDir = downloadDir.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "");
  const lastSegment = normalizedDir.split(/[\\/]/).pop()?.toLowerCase();
  if (lastSegment && lastSegment === normalizedRelative.toLowerCase()) {
    return normalizedDir;
  }
  return `${normalizedDir}/${normalizedRelative}`;
}
