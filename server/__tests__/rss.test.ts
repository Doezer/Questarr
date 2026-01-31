import { describe, it, expect, vi, beforeEach } from "vitest";
import { RssService } from "../rss.js";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";

const mocks = vi.hoisted(() => ({
  parseURL: vi.fn(),
}));

vi.mock("rss-parser", () => {
  return {
    default: class {
      parseURL = mocks.parseURL;
    },
  };
});

vi.mock("../storage.js");
vi.mock("../igdb.js");

describe("RssService", () => {
  let rssService: RssService;

  beforeEach(() => {
    vi.clearAllMocks();
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

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([mockFeed] as unknown as import("../../shared/schema").RssFeed[]);
    vi.mocked(storage.getRssFeedItemByGuid).mockResolvedValue(undefined); // Item doesn't exist

    mocks.parseURL.mockResolvedValue({
      items: [
        {
          title: "My Game v1.0 - Repack",
          link: "http://test.com/game",
          pubDate: "2023-01-01T00:00:00.000Z",
          guid: "guid-1",
        },
      ],
    });

    vi.mocked(igdbClient.searchGames).mockResolvedValue([
      {
        id: 123,
        name: "My Game",
        cover: { id: 1, url: "//images.igdb.com/igdb/image/upload/t_thumb/123.jpg" },
      } as unknown as import("../igdb").IGDBGame,
    ]);

    await rssService.refreshFeeds();

    expect(storage.getAllRssFeeds).toHaveBeenCalled();
    expect(mocks.parseURL).toHaveBeenCalledWith(mockFeed.url);
    expect(igdbClient.searchGames).toHaveBeenCalledWith("My Game", 1);
    expect(storage.addRssFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My Game v1.0 - Repack",
        guid: "guid-1",
        igdbGameId: 123,
        igdbGameName: "My Game",
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

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([mockFeed] as unknown as import("../../shared/schema").RssFeed[]);
    mocks.parseURL.mockRejectedValue(new Error("Parsing failed"));

    await rssService.refreshFeeds();

    expect(storage.updateRssFeed).toHaveBeenCalledWith(
      mockFeed.id,
      expect.objectContaining({
        status: "error",
        errorMessage: "Parsing failed",
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

    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([mockFeed] as unknown as import("../../shared/schema").RssFeed[]);

    mocks.parseURL.mockResolvedValue({
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

  it("should use cache for IGDB lookups", async () => {
    const mockFeed = { id: "feed-1", url: "url", enabled: true } as import("../../shared/schema").RssFeed;
    vi.mocked(storage.getAllRssFeeds).mockResolvedValue([mockFeed]);

    // Return same game twice
    mocks.parseURL.mockResolvedValue({
      items: [
        { title: "Game A v1", link: "l1", guid: "g1" },
        { title: "Game A v2", link: "l2", guid: "g2" },
      ],
    });

    vi.mocked(igdbClient.searchGames).mockResolvedValue([
      { id: 1, name: "Game A" } as unknown as import("../igdb").IGDBGame
    ]);

    await rssService.refreshFeeds();

    // Should be called once per unique game name extraction (assuming extraction works same for both)
    expect(igdbClient.searchGames).toHaveBeenCalledTimes(1);
    expect(storage.addRssFeedItem).toHaveBeenCalledTimes(2);
  });
});
