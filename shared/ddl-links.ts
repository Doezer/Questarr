/** Most links one direct-download job may hold (a big repack is rarely over 100 parts). */
export const DDL_MAX_LINKS = 500;

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
// Punctuation that ends a sentence or closes a bracket around a pasted link, not part of it.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/;

/**
 * Pulls every http(s) link out of pasted text (one per line, a forum post, BBCode, HTML...),
 * removes trailing punctuation and duplicates, and keeps the order of first appearance.
 */
export function extractHosterLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    // BBCode ([url]...[/url]) leaves the closing tag glued to the link.
    const candidate = match[0]
      .replace(/\[\/?[a-z]+\]?.*$/i, "")
      .replace(TRAILING_PUNCTUATION, "")
      .replace(/&amp;/g, "&");
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const key = url.href;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(candidate);
  }
  return links;
}

/** A sanitized local file name for an unrestricted link (no path separators, never empty). */
export function safeDdlFileName(name: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}
