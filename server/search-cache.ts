/**
 * Short-lived in-memory cache for manual indexer searches. Opening the search dialog of the same
 * game twice, paging back, or two people looking for the same title within a few minutes should
 * not hit every indexer again (indexers rate-limit and bill per query).
 *
 * Only error-free answers are stored, the key changes whenever an indexer is edited, and callers
 * get a copy so that scoring or enrichment can never alter what is cached.
 */
import type { AggregatedSearchResults } from "./search.js";

export const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
export const SEARCH_CACHE_MAX_ENTRIES = 100;

interface Entry {
  expiresAt: number;
  value: AggregatedSearchResults;
}

const entries = new Map<string, Entry>();

export interface SearchCacheKeyInput {
  query: string;
  category?: string[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  indexers: Array<{
    id: string;
    url: string;
    protocol?: string | null;
    updatedAt?: Date | number | null;
    categories?: string[] | null;
    timeoutSeconds?: number | null;
  }>;
}

export function buildSearchCacheKey(input: SearchCacheKeyInput): string {
  const indexers = input.indexers
    .map((i) =>
      [
        i.id,
        i.url,
        i.protocol ?? "",
        i.updatedAt ? new Date(i.updatedAt).getTime() : 0,
        (i.categories ?? []).join(","),
        i.timeoutSeconds ?? "",
      ].join("|")
    )
    .sort((a, b) => a.localeCompare(b));
  return JSON.stringify([
    input.query.trim().toLowerCase(),
    [...(input.category ?? [])].sort((a, b) => a.localeCompare(b)),
    input.limit ?? 50,
    input.offset ?? 0,
    indexers,
  ]);
}

export function getCachedSearch(
  key: string,
  now = Date.now()
): AggregatedSearchResults | undefined {
  const hit = entries.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    entries.delete(key);
    return undefined;
  }
  // refresh recency so the oldest-used entry is the one evicted
  entries.delete(key);
  entries.set(key, hit);
  return structuredClone(hit.value);
}

export function setCachedSearch(
  key: string,
  value: AggregatedSearchResults,
  now = Date.now()
): void {
  if (value.errors.length > 0) return;
  entries.set(key, { expiresAt: now + SEARCH_CACHE_TTL_MS, value: structuredClone(value) });
  while (entries.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function clearSearchCache(): void {
  entries.clear();
}
