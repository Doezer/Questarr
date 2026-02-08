import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "@shared/schema";

// Mock modules
vi.mock("../db.js", () => ({
  pool: {},
  db: {},
}));

// Mock ssrf check to allow all URLs in tests
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn((url, options) => fetch(url, options)),
}));

// Import TorznabClient after mocking
const { TorznabClient } = await import("../torznab.js");

describe("GET /api/indexers/search - Aggregated multi-indexer search", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let torznabClient: InstanceType<typeof TorznabClient>;

  const mockTorznabXmlResponse = (
    items: Array<{ title: string; link: string; seeders?: number; size?: number }>
  ) => {
    const itemsXml = items
      .map(
        (item) => `
      <item>
        <title>${item.title}</title>
        <link>${item.link}</link>
        <torznab:attr name="seeders" value="${item.seeders ?? 10}"/>
        <torznab:attr name="size" value="${item.size ?? 1000000000}"/>
      </item>
    `
      )
      .join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
        <channel>
          <title>Test Indexer</title>
          ${itemsXml}
        </channel>
      </rss>`;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    torznabClient = new TorznabClient();
  });

  it("should aggregate results from multiple enabled indexers", async () => {
    const testIndexer1: Indexer = {
      id: "indexer-1",
      name: "Test Indexer 1",
      url: "http://indexer1.example.com/api",
      apiKey: "apikey1",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const testIndexer2: Indexer = {
      id: "indexer-2",
      name: "Test Indexer 2",
      url: "http://indexer2.example.com/api",
      apiKey: "apikey2",
      enabled: true,
      priority: 2,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock responses for both indexers
    const response1 = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        mockTorznabXmlResponse([
          { title: "Game A v1.0", link: "http://example.com/game-a", seeders: 50 },
          { title: "Game B Repack", link: "http://example.com/game-b", seeders: 30 },
        ]),
    };

    const response2 = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        mockTorznabXmlResponse([
          { title: "Game C Deluxe", link: "http://example.com/game-c", seeders: 100 },
        ]),
    };

    fetchMock.mockResolvedValueOnce(response1).mockResolvedValueOnce(response2);

    // Simulate what the endpoint does
    const enabledIndexers = [testIndexer1, testIndexer2];
    const searchParams = {
      query: "Game",
      limit: 50,
      offset: 0,
    };

    const { results, errors } = await torznabClient.searchMultipleIndexers(
      enabledIndexers,
      searchParams
    );

    // Verify aggregated results
    expect(results.items).toHaveLength(3);
    expect(errors).toHaveLength(0);

    // Results should be sorted by seeders (descending)
    expect(results.items[0].title).toBe("Game C Deluxe"); // 100 seeders
    expect(results.items[1].title).toBe("Game A v1.0"); // 50 seeders
    expect(results.items[2].title).toBe("Game B Repack"); // 30 seeders
  });

  it("should return items and errors when some indexers fail", async () => {
    const workingIndexer: Indexer = {
      id: "indexer-working",
      name: "Working Indexer",
      url: "http://working.example.com/api",
      apiKey: "apikey-working",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const failingIndexer: Indexer = {
      id: "indexer-failing",
      name: "Failing Indexer",
      url: "http://failing.example.com/api",
      apiKey: "apikey-failing",
      enabled: true,
      priority: 2,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock successful response for working indexer
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        mockTorznabXmlResponse([
          {
            title: "Game From Working Indexer",
            link: "http://example.com/game-working",
            seeders: 25,
          },
        ]),
    };

    // Mock error response for failing indexer
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Internal Server Error",
    };

    fetchMock.mockResolvedValueOnce(successResponse).mockResolvedValueOnce(errorResponse);

    // Simulate what the endpoint does
    const enabledIndexers = [workingIndexer, failingIndexer];
    const searchParams = {
      query: "Game",
      limit: 50,
      offset: 0,
    };

    const { results, errors } = await torznabClient.searchMultipleIndexers(
      enabledIndexers,
      searchParams
    );

    // Verify we have results from working indexer
    expect(results.items).toHaveLength(1);
    expect(results.items[0].title).toBe("Game From Working Indexer");

    // Verify we have error from failing indexer
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Failing Indexer");
    expect(errors[0]).toContain("HTTP 500");
  });

  it("should return empty items with errors when all indexers fail", async () => {
    const failingIndexer1: Indexer = {
      id: "indexer-fail-1",
      name: "Failing Indexer 1",
      url: "http://fail1.example.com/api",
      apiKey: "apikey-fail1",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const failingIndexer2: Indexer = {
      id: "indexer-fail-2",
      name: "Failing Indexer 2",
      url: "http://fail2.example.com/api",
      apiKey: "apikey-fail2",
      enabled: true,
      priority: 2,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock error responses for both indexers
    const errorResponse = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "Service Unavailable",
    };

    fetchMock.mockResolvedValueOnce(errorResponse).mockResolvedValueOnce(errorResponse);

    // Simulate what the endpoint does
    const enabledIndexers = [failingIndexer1, failingIndexer2];
    const searchParams = {
      query: "Game",
      limit: 50,
      offset: 0,
    };

    const { results, errors } = await torznabClient.searchMultipleIndexers(
      enabledIndexers,
      searchParams
    );

    // Verify no results
    expect(results.items).toHaveLength(0);
    expect(results.total).toBe(0);

    // Verify both errors are captured
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Failing Indexer 1");
    expect(errors[1]).toContain("Failing Indexer 2");
  });

  it("should throw error when no enabled indexers are available", async () => {
    const searchParams = {
      query: "Game",
      limit: 50,
      offset: 0,
    };

    await expect(torznabClient.searchMultipleIndexers([], searchParams)).rejects.toThrow(
      "No enabled indexers available"
    );
  });

  it("should filter out disabled indexers", async () => {
    const enabledIndexer: Indexer = {
      id: "indexer-enabled",
      name: "Enabled Indexer",
      url: "http://enabled.example.com/api",
      apiKey: "apikey-enabled",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const disabledIndexer: Indexer = {
      id: "indexer-disabled",
      name: "Disabled Indexer",
      url: "http://disabled.example.com/api",
      apiKey: "apikey-disabled",
      enabled: false,
      priority: 2,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock response only for enabled indexer
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        mockTorznabXmlResponse([
          { title: "Game Only From Enabled", link: "http://example.com/game", seeders: 15 },
        ]),
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    // Simulate what the endpoint does - both indexers passed but only enabled should be used
    const indexers = [enabledIndexer, disabledIndexer];
    const searchParams = {
      query: "Game",
      limit: 50,
      offset: 0,
    };

    const { results, errors } = await torznabClient.searchMultipleIndexers(indexers, searchParams);

    // Verify only enabled indexer was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.items).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  describe("Comments URL handling", () => {
    it("should pass through comments when provided by indexer", async () => {
      const testIndexer: Indexer = {
        id: "indexer-with-comments",
        name: "Test Indexer",
        url: "http://example.com/api",
        apiKey: "apikey-test",
        enabled: true,
        priority: 1,
        categories: ["4000"],
        rssEnabled: true,
        autoSearchEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const xmlWithComments = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
          <channel>
            <title>Test Indexer</title>
            <item>
              <title>Game Title</title>
              <link>magnet:?xt=urn:btih:abc123</link>
              <guid>12345</guid>
              <comments>http://example.com/details/12345</comments>
              <torznab:attr name="seeders" value="10"/>
            </item>
          </channel>
        </rss>`;

      const response = {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => xmlWithComments,
      };

      fetchMock.mockResolvedValueOnce(response);

      const { results } = await torznabClient.searchMultipleIndexers([testIndexer], {
        query: "Game",
        limit: 50,
        offset: 0,
      });

      expect(results.items).toHaveLength(1);
      expect(results.items[0].comments).toBe("http://example.com/details/12345");
    });

    it("should include indexerUrl in results for fallback URL construction", async () => {
      const testIndexer: Indexer = {
        id: "indexer-url-test",
        name: "Test Indexer",
        url: "http://example.com/api",
        apiKey: "apikey-test",
        enabled: true,
        priority: 1,
        categories: ["4000"],
        rssEnabled: true,
        autoSearchEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const xmlWithoutComments = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
          <channel>
            <title>Test Indexer</title>
            <item>
              <title>Game Title</title>
              <link>magnet:?xt=urn:btih:abc123</link>
              <guid>12345</guid>
              <torznab:attr name="seeders" value="10"/>
            </item>
          </channel>
        </rss>`;

      const response = {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => xmlWithoutComments,
      };

      fetchMock.mockResolvedValueOnce(response);

      const { results } = await torznabClient.searchMultipleIndexers([testIndexer], {
        query: "Game",
        limit: 50,
        offset: 0,
      });

      expect(results.items).toHaveLength(1);
      // Check that indexerUrl is passed through for search.ts to use for fallback
      expect(results.items[0].indexerUrl).toBe("http://example.com/api");
      expect(results.items[0].guid?.toString()).toBe("12345");
    });
  });
});
