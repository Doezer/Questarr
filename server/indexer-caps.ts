// Shared helpers for Newznab/Torznab caps (category) discovery. Both
// protocols expose an equivalent `t=caps` endpoint with the same query-param
// contract and the same reasonable fallback behavior, so the URL-candidate
// building and defaults live here once instead of being hand-copied (and
// drifting -- see CAPS_DISCOVERY_TIMEOUT_MS's history) between
// server/newznab.ts and server/torznab.ts. The retry loop itself
// (server/newznab.ts's and server/torznab.ts's getCategories) stays
// per-protocol: it differs in real ways (SSRF check vs. enabled check,
// request headers, error-text extraction, logger) that aren't worth forcing
// through one shared code path.

import { type Indexer } from "@shared/schema";

export interface IndexerCapsCategory {
  id: string;
  name: string;
}

// Conservative built-in fallback used when caps discovery can't reach an
// indexer at all: the standard Newznab/Torznab category scheme's Console
// and PC/Games parents, so search category filtering still has something
// sane to offer instead of leaving the indexer with none.
export const DEFAULT_GAME_CATEGORY_IDS = ["1000", "4000", "4050"] as const;
export const DEFAULT_GAME_CATEGORIES: readonly IndexerCapsCategory[] = Object.freeze([
  { id: "1000", name: "Console" },
  { id: "4000", name: "PC" },
  { id: "4050", name: "PC > Games" },
]);

// Overall time budget for a getCategories caps-discovery loop, shared
// across every URL candidate it tries rather than reset per candidate.
// Previously 10s in newznab.ts and 30s in torznab.ts (an unintentional
// divergence for the same operation); reconciled to one value in between --
// generous enough for a slower self-hosted indexer, without letting a
// search-adjacent code path hang too long before falling back to defaults.
export const CAPS_DISCOVERY_TIMEOUT_MS = 15000;

/**
 * Build a list of reasonable candidate caps URLs to try in order. Indexers
 * vary in whether their stored base URL already includes the /api path
 * segment, so try both the normalized (`buildApiUrl`) form and the raw
 * stored URL as-is before giving up.
 */
export function buildCapsUrlCandidates(
  indexer: Pick<Indexer, "url" | "apiKey">,
  buildApiUrl: (indexerUrl: string) => URL
): URL[] {
  const candidates: URL[] = [];
  const seen = new Set<string>();

  const add = (url: URL) => {
    url.searchParams.set("t", "caps");
    url.searchParams.set("apikey", indexer.apiKey);
    const key = url.toString();
    if (!seen.has(key)) {
      candidates.push(url);
      seen.add(key);
    }
  };

  try {
    add(buildApiUrl(indexer.url));
  } catch {
    /* invalid URL -- skip this candidate */
  }
  try {
    add(new URL(indexer.url));
  } catch {
    /* invalid URL -- skip this candidate */
  }

  return candidates;
}
