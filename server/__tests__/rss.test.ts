import { describe, it, expect, vi, beforeEach } from "vitest";
import { RssService } from "../rss.js";
import { storage } from "../storage.js";
import { rawgClient } from "../rawg.js";

const mocks = vi.hoisted(() => ({
  parseString: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock("rss-parser", () => {
  return {
    default: class {
      parseString = mocks.parseString;
    },
  };
});

vi.mock("../ssrf.js", () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock("../storage.js");
vi.mock("../rawg.js");

describe("RssService", () => {
  let rssService: RssService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default to safe fetch for tests
    mocks.safeFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("<xml></xml>"),
    });

    rssService = new RssService();
  });

  it("should refresh feeds and store new items", async () => {
    const mockFeed = {
      id: "feed-1",
      name: "Test Feed",
      url: "http://test.com/rss",
      enabled: true,
      type: "custom",
      mapping: null,
    };

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([
      mockFeed,
    ] as unknown as import("../../shared/schema").RssFeed[]);
    vi.mocked(storage.getRssFeedItemByGuid).mockResolvedValue(undefined); // Item doesn't exist

    mocks.parseString.mockResolvedValue({
      items: [
        {
          title: "My Game v1.0 - Repack",
          link: "http://test.com/game",
          pubDate: "2023-01-01T00:00:00.000Z",
          guid: "guid-1",
        },
      ],
    });

    vi.mocked(rawgClient.searchGames).mockResolvedValue([
      {
        id: 123,
        name: "My Game",
        image: "//cdn.rawg.io/media/games/123/cover.jpg",
      } as unknown as import("../rawg").RawgGame,
    ]);

    // Mock addRssFeedItem to return an item with ID so background process can use it
    vi.mocked(storage.addRssFeedItem).mockResolvedValue({
      id: "item-1",
      title: "My Game v1.0 - Repack",
    } as unknown as import("../../shared/schema").RssFeedItem);

    // Mock getRssFeedItem for background process
    vi.mocked(storage.getRssFeedItem).mockResolvedValue({
      id: "item-1",
      title: "My Game v1.0 - Repack",
      rawgGameId: null,
    } as unknown as import("../../shared/schema").RssFeedItem);

    await rssService.refreshFeeds();

    expect(storage.getAllRssFeeds).toHaveBeenCalled();
    expect(mocks.safeFetch).toHaveBeenCalledWith(mockFeed.url);
    expect(mocks.parseString).toHaveBeenCalledWith("<xml></xml>");

    // 1. Check immediate insertion (should have null matches)
    expect(storage.addRssFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My Game v1.0 - Repack",
        guid: "guid-1",
        rawgGameId: null,
        rawgGameName: null,
      })
    );

    // 2. Wait for background processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 3. Verify background matching behaviors
    expect(rawgClient.searchGames).toHaveBeenCalledWith("My Game", 1);

    expect(storage.updateRssFeedItem).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        rawgGameId: 123,
        rawgGameName: "My Game",
      })
    );

    expect(storage.updateRssFeed).toHaveBeenCalledWith(
      mockFeed.id,
      expect.objectContaining({ status: "ok" })
    );
  });

  it("should handle parsing errors gracefully", async () => {
    const mockFeed = {
      id: "feed-1",
      name: "Test Feed",
      url: "http://test.com/rss",
      enabled: true,
    };

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([
      mockFeed,
    ] as unknown as import("../../shared/schema").RssFeed[]);
    mocks.parseString.mockRejectedValue(new Error("Parsing failed"));

    await rssService.refreshFeeds();

    expect(storage.updateRssFeed).toHaveBeenCalledWith(
      mockFeed.id,
      expect.objectContaining({
        status: "error",
        errorMessage: "Parsing failed",
      })
    );
  });

  it("should handle SSRF/unsafe URL errors gracefully", async () => {
    const mockFeed = {
      id: "feed-unsafe",
      name: "Unsafe Feed",
      url: "http://169.254.169.254/latest/meta-data",
      enabled: true,
    };

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([
      mockFeed,
    ] as unknown as import("../../shared/schema").RssFeed[]);

    // Mock safeFetch to reject
    mocks.safeFetch.mockRejectedValue(new Error("Invalid or unsafe URL"));

    await rssService.refreshFeeds();

    expect(mocks.parseString).not.toHaveBeenCalled();
    expect(storage.updateRssFeed).toHaveBeenCalledWith(
      mockFeed.id,
      expect.objectContaining({
        status: "error",
        errorMessage: expect.stringMatching(/Invalid or unsafe URL/),
      })
    );
  });

  it("should respect custom mappings", async () => {
    const mockFeed = {
      id: "feed-custom",
      name: "Custom Feed",
      url: "http://custom.com/rss",
      enabled: true,
      mapping: { titleField: "customTitle", linkField: "customLink" },
    };

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([
      mockFeed,
    ] as unknown as import("../../shared/schema").RssFeed[]);

    mocks.parseString.mockResolvedValue({
      items: [
        {
          customTitle: "Custom Game Title",
          customLink: "http://custom.com/game",
          guid: "guid-custom",
        },
      ],
    });

    await rssService.refreshFeeds();

    expect(storage.addRssFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Custom Game Title",
        link: "http://custom.com/game",
      })
    );
  });

  it("should use cache for RAWG lookups", async () => {
    const mockFeed = {
      id: "feed-1",
      url: "url",
      enabled: true,
    } as import("../../shared/schema").RssFeed;
    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([mockFeed]);

    mocks.parseString.mockResolvedValue({
      items: [
        { title: "Game A v1", link: "l1", guid: "g1" },
        { title: "Game A v2", link: "l2", guid: "g2" },
      ],
    });

    vi.mocked(rawgClient.searchGames).mockResolvedValue([
      { id: 1, name: "Game A" } as unknown as import("../rawg").RawgGame,
    ]);

    // Mock returns
    vi.mocked(storage.addRssFeedItem).mockImplementation(
      async (item) =>
        ({
          ...item,
          id: Math.random().toString(),
        }) as unknown as import("../../shared/schema").RssFeedItem
    );
    vi.mocked(storage.getRssFeedItem).mockImplementation(
      async (id) =>
        ({ title: "Game A", id }) as unknown as import("../../shared/schema").RssFeedItem
    );

    await rssService.refreshFeeds();

    // Wait for background processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should be called once per unique game name extraction
    expect(rawgClient.searchGames).toHaveBeenCalledTimes(1);
    expect(storage.addRssFeedItem).toHaveBeenCalledTimes(2);
  });
});
