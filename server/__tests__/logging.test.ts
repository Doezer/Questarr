import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "@shared/schema";

// Mock logger
const debugMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();

vi.mock("../logger.js", () => ({
  torznabLogger: {
    debug: debugMock,
    info: infoMock,
    error: errorMock,
  },
  routesLogger: {
    debug: debugMock,
    info: infoMock,
    error: errorMock,
  },
  logger: {
    child: () => ({
      debug: debugMock,
      info: infoMock,
      error: errorMock,
    }),
  }
}));

// Mock DB
vi.mock("../db.js", () => ({
  pool: {},
  db: {},
}));

// Import clients after mocking
const { TorznabClient } = await import("../torznab.js");

describe("Search Logging", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let torznabClient: InstanceType<typeof TorznabClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    torznabClient = new TorznabClient();
  });

  const mockXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
      <channel>
        <title>Test Indexer</title>
        <item>
          <title>Test Game</title>
          <link>http://example.com/test.torrent</link>
          <torznab:attr name="category" value="4000" />
        </item>
      </channel>
    </rss>`;

  it("should log search request and category parsing in TorznabClient", async () => {
    const testIndexer: Indexer = {
      id: "indexer-1",
      name: "Test Indexer",
      url: "http://indexer1.example.com/api",
      apiKey: "apikey1",
      enabled: true,
      priority: 1,
      categories: ["4000"],
      rssEnabled: true,
      autoSearchEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      protocol: "torznab"
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => mockXmlResponse,
    });

    await torznabClient.searchGames(testIndexer, { query: "test" });

    // Verify info log for search URL
    expect(infoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indexer: "Test Indexer",
        url: expect.stringContaining("http://indexer1.example.com/api"),
      }),
      "searching torznab indexer"
    );

    // Verify debug log for response
    expect(debugMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indexer: "Test Indexer",
        responseLength: expect.any(Number),
      }),
      "received torznab response"
    );

    // Verify debug log for parsed categories
    expect(debugMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Test Game",
        category: "4000",
      }),
      "parsed torznab item category"
    );
  });
});
