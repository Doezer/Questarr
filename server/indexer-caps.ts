// Shared helpers for Newznab/Torznab caps (category) discovery. Both
// protocols expose an equivalent `t=caps` endpoint with the same query-param
// contract and the same reasonable retry/fallback behavior, so this logic
// lives here once instead of being hand-copied (and drifting -- see
// CAPS_DISCOVERY_TIMEOUT_MS's history) between server/newznab.ts and
// server/torznab.ts. The two protocol-specific bits (the pre-flight
// allowed-to-fetch check, and XML -> category parsing) are passed in by the
// caller rather than folded in here.

import { type Indexer } from "@shared/schema";
import { safeFetch } from "./ssrf.js";

export interface CapsDiscoveryLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

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

/**
 * Get available categories from an indexer. Tries a couple of reasonable
 * caps URL variants (see buildCapsUrlCandidates) before giving up, and
 * falls back to DEFAULT_GAME_CATEGORIES rather than hard-failing the whole
 * indexer when caps discovery can't be reached at all.
 *
 * `assertAllowed` runs first and should throw to reject the indexer outright
 * (SSRF check, disabled check, ...) -- unlike a fetch failure below, that's
 * not worth retrying other URL candidates for.
 */
export async function discoverCapsCategories<T>(options: {
  indexer: Indexer;
  buildApiUrl: (indexerUrl: string) => URL;
  assertAllowed: () => Promise<void> | void;
  fetchHeaders?: Record<string, string>;
  parseCaps: (xmlText: string) => T[];
  fallback: readonly T[];
  logger: CapsDiscoveryLogger;
  protocolName: string;
}): Promise<T[]> {
  await options.assertAllowed();

  // One overall deadline shared across every caps URL candidate, not a
  // fresh timeout per candidate -- otherwise two unreachable candidates
  // (buildCapsUrlCandidates can return up to two) each hang for the full
  // per-request timeout before falling back, roughly doubling worst-case
  // caps-discovery latency.
  const deadline = Date.now() + CAPS_DISCOVERY_TIMEOUT_MS;

  let lastError: unknown;
  for (const url of buildCapsUrlCandidates(options.indexer, options.buildApiUrl)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError ??= new Error("Caps discovery deadline exceeded");
      break;
    }
    try {
      const response = await safeFetch(url.toString(), {
        headers: options.fetchHeaders,
        signal: AbortSignal.timeout(remainingMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details available");
        lastError = new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        continue;
      }

      const xmlText = await response.text();
      const categories = options.parseCaps(xmlText);
      if (categories.length > 0) {
        return categories;
      }
      // Parsed successfully but no categories were listed -- not worth
      // retrying other URL variants for, but also not a hard failure.
      lastError = new Error("Caps response contained no categories");
    } catch (error) {
      lastError = error;
    }
  }

  options.logger.warn(
    { indexer: options.indexer.name, error: lastError },
    `${options.protocolName} caps discovery failed for all URL variants; falling back to default game categories`
  );
  return [...options.fallback];
}
