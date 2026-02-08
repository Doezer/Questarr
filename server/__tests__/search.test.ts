import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "@shared/schema";

// Mock dependencies
vi.mock("../db.js", () => ({
  pool: {},
  db: {},
}));

vi.mock("../storage.js", () => ({
  storage: {
    getEnabledIndexers: vi.fn(),
  },
}));

vi.mock("../torznab.js", () => ({
  torznabClient: {
    searchMultipleIndexers: vi.fn(),
  },
}));

vi.mock("../newznab.js", () => ({
  newznabClient: {
    searchMultipleIndexers: vi.fn(),
  },
}));

const { searchAllIndexers } = await import("../search.js");
const { storage } = await import("../storage.js");
const { torznabClient } = await import("../torznab.js");
const { newznabClient } = await import("../newznab.js");

describe("Search Module - searchAllIndexers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty results when no indexers are configured", async () => {
    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([]);

    const result = await searchAllIndexers({ query: "test game" });

    expect(result).toEqual({
      items: [],
      total: 0,
      offset: 0,
      errors: ["No indexers configured"],
    });
  });

  it("should search torznab indexers and return formatted results", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [
          {
            title: "Test Game",
            link: "http://example.com/download",
            pubDate: "2024-01-01T00:00:00Z",
            size: 1000000,
            seeders: 10,
            leechers: 2,
            category: "4000",
            guid: "guid-123",
            indexerId: "torznab-1",
            indexerName: "Torznab Indexer",
            indexerUrl: "http://torznab.example.com",
            comments: "http://torznab.example.com/details/guid-123",
          },
        ],
        total: 1,
      },
      errors: [],
    });

    const result = await searchAllIndexers({ query: "test game" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Test Game",
      downloadType: "torrent",
      seeders: 10,
      leechers: 2,
    });
    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("should search newznab indexers and return formatted results", async () => {
    const newznabIndexer: Indexer = {
      id: "newznab-1",
      name: "Newznab Indexer",
      url: "http://newznab.example.com",
      apiKey: "key2",
      protocol: "newznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([newznabIndexer]);
    vi.mocked(newznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [
          {
            title: "Test Usenet Game",
            link: "http://usenet.example.com/nzb",
            publishDate: "2024-01-02T00:00:00Z",
            size: 2000000,
            grabs: 5,
            age: 2.5,
            category: ["4000"],
            guid: "guid-456",
            indexerId: "newznab-1",
            indexerName: "Newznab Indexer",
            poster: "user@example.com",
            group: "alt.binaries.games",
          },
        ],
        total: 1,
      },
      errors: [],
    });

    const result = await searchAllIndexers({ query: "test game" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Test Usenet Game",
      downloadType: "usenet",
      grabs: 5,
      age: 2.5,
      poster: "user@example.com",
      group: "alt.binaries.games",
    });
    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("should combine results from both torznab and newznab indexers", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const newznabIndexer: Indexer = {
      id: "newznab-1",
      name: "Newznab Indexer",
      url: "http://newznab.example.com",
      apiKey: "key2",
      protocol: "newznab",
      enabled: true,
      priority: 2,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer, newznabIndexer]);

    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [
          {
            title: "Torrent Game",
            link: "http://torrent.example.com/download",
            pubDate: "2024-01-01T00:00:00Z",
            size: 1000000,
            seeders: 10,
            category: "4000",
            guid: "guid-torrent",
            indexerId: "torznab-1",
            indexerName: "Torznab Indexer",
          },
        ],
        total: 1,
      },
      errors: [],
    });

    vi.mocked(newznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [
          {
            title: "Usenet Game",
            link: "http://usenet.example.com/nzb",
            publishDate: "2024-01-02T00:00:00Z",
            size: 2000000,
            grabs: 5,
            category: ["4000"],
            guid: "guid-usenet",
            indexerId: "newznab-1",
            indexerName: "Newznab Indexer",
          },
        ],
        total: 1,
      },
      errors: [],
    });

    const result = await searchAllIndexers({ query: "test game" });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].downloadType).toBe("usenet"); // Newer date, sorted first
    expect(result.items[1].downloadType).toBe("torrent");
    expect(result.total).toBe(2);
  });

  it("should sort results by date (newest first)", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [
          {
            title: "Old Game",
            link: "http://example.com/old",
            pubDate: "2024-01-01T00:00:00Z",
            guid: "guid-old",
            indexerId: "torznab-1",
            indexerName: "Torznab Indexer",
            category: "4000",
          },
          {
            title: "New Game",
            link: "http://example.com/new",
            pubDate: "2024-01-10T00:00:00Z",
            guid: "guid-new",
            indexerId: "torznab-1",
            indexerName: "Torznab Indexer",
            category: "4000",
          },
        ],
        total: 2,
      },
      errors: [],
    });

    const result = await searchAllIndexers({ query: "game" });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("New Game");
    expect(result.items[1].title).toBe("Old Game");
  });

  it("should aggregate errors from indexers", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [],
        total: 0,
      },
      errors: ["Connection timeout", "Rate limit exceeded"],
    });

    const result = await searchAllIndexers({ query: "test" });

    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain("Connection timeout");
    expect(result.errors).toContain("Rate limit exceeded");
  });

  it("should construct comments URL when not provided by indexer", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [
          {
            title: "Test Game",
            link: "http://example.com/download",
            pubDate: "2024-01-01T00:00:00Z",
            guid: "http://example.com/details/12345",
            indexerId: "torznab-1",
            indexerName: "Torznab Indexer",
            indexerUrl: "http://torznab.example.com",
            category: "4000",
            // No comments field provided
          },
        ],
        total: 1,
      },
      errors: [],
    });

    const result = await searchAllIndexers({ query: "test" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].comments).toBe("http://torznab.example.com/details/12345");
  });

  it("should handle limit and offset parameters", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [],
        total: 0,
      },
      errors: [],
    });

    await searchAllIndexers({ query: "test", limit: 25, offset: 10 });

    expect(torznabClient.searchMultipleIndexers).toHaveBeenCalledWith(
      [torznabIndexer],
      expect.objectContaining({
        limit: 25,
        offset: 10,
      })
    );
  });

  it("should use default limit of 50 when not specified", async () => {
    const torznabIndexer: Indexer = {
      id: "torznab-1",
      name: "Torznab Indexer",
      url: "http://torznab.example.com",
      apiKey: "key1",
      protocol: "torznab",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(storage.getEnabledIndexers).mockResolvedValue([torznabIndexer]);
    vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
      results: {
        items: [],
        total: 0,
      },
      errors: [],
    });

    await searchAllIndexers({ query: "test" });

    expect(torznabClient.searchMultipleIndexers).toHaveBeenCalledWith(
      [torznabIndexer],
      expect.objectContaining({
        limit: 50,
        offset: 0,
      })
    );
  });
});
