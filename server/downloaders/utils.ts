import { downloadersLogger } from "../logger.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";

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
