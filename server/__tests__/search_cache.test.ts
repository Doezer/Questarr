import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "@shared/schema";

vi.mock("../db.js", () => ({ dialect: "sqlite", pool: {}, db: {} }));
vi.mock("../storage.js", () => ({ storage: { getEnabledIndexers: vi.fn() } }));
vi.mock("../torznab.js", () => ({ torznabClient: { searchMultipleIndexers: vi.fn() } }));
vi.mock("../newznab.js", () => ({ newznabClient: { searchMultipleIndexers: vi.fn() } }));
vi.mock("../typesafe.js", () => ({
  typesafeClient: { isConfigured: vi.fn().mockResolvedValue(false), analyzeRelease: vi.fn() },
}));

const { searchAllIndexers } = await import("../search.js");
const {
  buildSearchCacheKey,
  clearSearchCache,
  getCachedSearch,
  setCachedSearch,
  SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_MAX_ENTRIES,
} = await import("../search-cache.js");
const { storage } = await import("../storage.js");
const { torznabClient } = await import("../torznab.js");

const indexer = (overrides: Partial<Indexer> = {}) =>
  ({
    id: "t1",
    name: "T",
    url: "http://t.example.com",
    apiKey: "k",
    protocol: "torznab",
    enabled: true,
    priority: 1,
    categories: ["4000"],
    updatedAt: new Date(1000),
    ...overrides,
  }) as Indexer;

const answer = (errors: string[] = []) => ({
  results: {
    items: [
      {
        title: "Game v1",
        link: "http://x/1",
        pubDate: "2026-01-01",
        indexerId: "t1",
        indexerName: "T",
        guid: "g1",
      },
    ],
    total: 1,
    offset: 0,
  },
  errors,
});

describe("search cache", () => {
  beforeEach(() => {
    clearSearchCache();
    vi.clearAllMocks();
    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([indexer()]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue(answer() as never);
  });

  it("serves an identical cached search without calling the indexers again", async () => {
    await searchAllIndexers({ query: "Game", cache: true });
    const second = await searchAllIndexers({ query: " game ", cache: true });
    expect(torznabClient.searchMultipleIndexers).toHaveBeenCalledTimes(1);
    expect(second.items).toHaveLength(1);
  });

  it("does not cache unless asked", async () => {
    await searchAllIndexers({ query: "Game" });
    await searchAllIndexers({ query: "Game" });
    expect(torznabClient.searchMultipleIndexers).toHaveBeenCalledTimes(2);
  });

  it("does not cache answers with indexer errors", async () => {
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue(
      answer(["T: timeout"]) as never
    );
    await searchAllIndexers({ query: "Game", cache: true });
    await searchAllIndexers({ query: "Game", cache: true });
    expect(torznabClient.searchMultipleIndexers).toHaveBeenCalledTimes(2);
  });

  it("misses when an indexer was edited", async () => {
    await searchAllIndexers({ query: "Game", cache: true });
    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([
      indexer({ updatedAt: new Date(2000) }),
    ]);
    await searchAllIndexers({ query: "Game", cache: true });
    expect(torznabClient.searchMultipleIndexers).toHaveBeenCalledTimes(2);
  });

  it("returns copies, so callers cannot alter the cached answer", async () => {
    const first = await searchAllIndexers({ query: "Game", cache: true });
    first.items[0]!.title = "changed";
    const second = await searchAllIndexers({ query: "Game", cache: true });
    expect(second.items[0]!.title).toBe("Game v1");
  });

  it("separates pages and categories", () => {
    const base = { query: "g", indexers: [indexer()] };
    expect(buildSearchCacheKey({ ...base, offset: 0 })).not.toBe(
      buildSearchCacheKey({ ...base, offset: 50 })
    );
    expect(buildSearchCacheKey({ ...base, category: ["1"] })).not.toBe(
      buildSearchCacheKey({ ...base, category: ["2"] })
    );
  });

  it("expires entries and evicts the oldest past the limit", () => {
    const value = { items: [], total: 0, offset: 0, errors: [] };
    setCachedSearch("a", value, 0);
    expect(getCachedSearch("a", SEARCH_CACHE_TTL_MS - 1)).toBeDefined();
    expect(getCachedSearch("a", SEARCH_CACHE_TTL_MS + 1)).toBeUndefined();
    for (let i = 0; i <= SEARCH_CACHE_MAX_ENTRIES; i++) setCachedSearch(`k${i}`, value, 0);
    expect(getCachedSearch("k0", 1)).toBeUndefined();
    expect(getCachedSearch(`k${SEARCH_CACHE_MAX_ENTRIES}`, 1)).toBeDefined();
  });
});
