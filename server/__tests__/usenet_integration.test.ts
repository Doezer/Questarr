import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../storage.js";
import { newznabClient } from "../newznab.js";
import { torznabClient } from "../torznab.js";
import type { Indexer, Downloader } from "@shared/schema";

// Mock dependencies
vi.mock("../storage.js");
vi.mock("../newznab.js");
vi.mock("../torznab.js");
vi.mock("../downloaders.js");
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn(),
}));

describe("Usenet Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Aggregated Search", () => {
    it("should call both Torznab and Newznab clients and merge results", async () => {
      // Mock enabled indexers
      const mockIndexers: Indexer[] = [
        {
          id: "indexer-1",
          name: "Torznab Indexer",
          url: "http://torznab.com",
          apiKey: "key1",
          protocol: "torznab",
          enabled: true,
          priority: 1,
          categories: [],
          rssEnabled: true,
          autoSearchEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "indexer-2",
          name: "Newznab Indexer",
          url: "http://newznab.com",
          apiKey: "key2",
          protocol: "newznab",
          enabled: true,
          priority: 2,
          categories: [],
          rssEnabled: true,
          autoSearchEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(storage.getEnabledIndexers).mockResolvedValue(mockIndexers);

      // Mock search results
      const torznabResults = {
        items: [
          {
            title: "Game 1 (Release)",
            link: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
            pubDate: "2023-01-01",
            seeders: 10,
          },
        ],
        total: 1,
        offset: 0,
      };

      const newznabResults = {
        items: [
          {
            title: "Game 2 (NZB)",
            link: "http://nzb.com/123",
            pubDate: "2023-01-02",
            size: 1000,
            indexerId: "indexer-2",
            indexerName: "Newznab Indexer",
            category: [],
            guid: "123",
          },
        ],
        total: 1,
        offset: 0,
      };

      vi.mocked(torznabClient.searchMultipleIndexers).mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        results: torznabResults as any,
        errors: [],
      });

      vi.mocked(newznabClient.searchMultipleIndexers).mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        results: newznabResults as any,
        errors: [],
      });

      // Simulate route handler logic
      const enabledIndexers = await storage.getEnabledIndexers();
      const torznabIndexers = enabledIndexers.filter((i) => i.protocol !== "newznab");
      const newznabIndexers = enabledIndexers.filter((i) => i.protocol === "newznab");

      expect(torznabIndexers).toHaveLength(1);
      expect(newznabIndexers).toHaveLength(1);

      const searchParams = {
        query: "test game",
        limit: 50,
        offset: 0,
      };

      const results = await Promise.all([
        torznabClient
          .searchMultipleIndexers(torznabIndexers, searchParams)
          .then((res) => ({ type: "torznab" as const, ...res })),
        newznabClient
          .searchMultipleIndexers(newznabIndexers, searchParams)
          .then((res) => ({ type: "newznab" as const, ...res })),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const combinedItems: any[] = [];
      for (const result of results) {
        combinedItems.push(...result.results.items);
      }

      expect(combinedItems).toHaveLength(2);
      expect(combinedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Game 1 (Release)" }),
          expect.objectContaining({ title: "Game 2 (NZB)" }),
        ])
      );
    });
  });

  describe("DownloaderManager Fallback Filtering", () => {
    it("should only attempt Usenet downloaders for usenet type", async () => {
      const downloaders: Downloader[] = [
        {
          id: "dl-release",
          name: "Transmission",
          type: "transmission",
          url: "http://localhost:9091",
          enabled: true,
          priority: 1,
          port: 9091,
          useSsl: false,
          urlPath: null,
          username: null,
          password: null,
          downloadPath: null,
          category: "games",
          label: null,
          addStopped: false,
          removeCompleted: false,
          postImportCategory: null,
          settings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "dl-usenet",
          name: "SABnzbd",
          type: "sabnzbd",
          url: "http://localhost:8080",
          enabled: true,
          priority: 2,
          port: 8080,
          useSsl: false,
          urlPath: null,
          username: "key",
          password: null,
          downloadPath: null,
          category: "games",
          label: null,
          addStopped: false,
          removeCompleted: false,
          postImportCategory: null,
          settings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const request = {
        url: "http://example.com/file.nzb",
        title: "Test NZB",
        downloadType: "usenet" as const,
      };

      const { DownloaderManager: ActualDownloaderManager } =
        await vi.importActual<typeof import("../downloaders.js")>("../downloaders.js");

      const addDownloadSpy = vi
        .spyOn(ActualDownloaderManager, "addDownload")
        .mockImplementation(async (dl: { type: string }) => {
          if (dl.type === "sabnzbd") return { success: true, id: "1", message: "OK" };
          return { success: false, message: "Fail" };
        });

      const result = await ActualDownloaderManager.addDownloadWithFallback(downloaders, request);

      expect(result.success).toBe(true);
      expect(result.attemptedDownloaders).toEqual(["SABnzbd"]);
      expect(addDownloadSpy).toHaveBeenCalledTimes(1);
    });

    it("should only attempt downloaders for download type", async () => {
      const downloaders: Downloader[] = [
        {
          id: "dl-release",
          name: "Transmission",
          type: "transmission",
          url: "http://localhost:9091",
          enabled: true,
          priority: 1,
          port: 9091,
          useSsl: false,
          urlPath: null,
          username: null,
          password: null,
          downloadPath: null,
          category: "games",
          label: null,
          addStopped: false,
          removeCompleted: false,
          postImportCategory: null,
          settings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "dl-usenet",
          name: "SABnzbd",
          type: "sabnzbd",
          url: "http://localhost:8080",
          enabled: true,
          priority: 2,
          port: 8080,
          useSsl: false,
          urlPath: null,
          username: "key",
          password: null,
          downloadPath: null,
          category: "games",
          label: null,
          addStopped: false,
          removeCompleted: false,
          postImportCategory: null,
          settings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const request = {
        url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
        title: "Test Download",
        downloadType: "torrent" as const,
      };

      const { DownloaderManager: ActualDownloaderManager } =
        await vi.importActual<any>("../downloaders.js"); // eslint-disable-line @typescript-eslint/no-explicit-any
      const addDownloadSpy = vi
        .spyOn(ActualDownloaderManager, "addDownload")
        .mockResolvedValue({ success: true, id: "1", message: "OK" });

      const result = await ActualDownloaderManager.addDownloadWithFallback(downloaders, request);

      expect(result.success).toBe(true);
      expect(result.attemptedDownloaders).toEqual(["Transmission"]);
      expect(addDownloadSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Search Item Mapping", () => {
    it("should correctly identify Usenet items in search results", async () => {
      const { searchAllIndexers } = await import("../search.js");

      const mockIndexer: Indexer = {
        id: "idx-1",
        name: "Test Newznab",
        url: "http://newznab.com",
        apiKey: "key",
        protocol: "newznab",
        enabled: true,
        priority: 1,
        categories: [],
        rssEnabled: true,
        autoSearchEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(storage.getEnabledIndexers).mockResolvedValue([mockIndexer]);
      vi.mocked(newznabClient.searchMultipleIndexers).mockResolvedValue({
        results: {
          items: [
            {
              title: "Test Game",
              link: "http://link.com",
              publishDate: new Date().toISOString(),
              size: 1024,
              indexerId: "idx-1",
              indexerName: "Test Newznab",
              category: ["Games"],
              guid: "guid-1",
              grabs: 10,
              age: 5,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          ],
          total: 1,
          offset: 0,
        },
        errors: [],
      });

      const results = await searchAllIndexers({ query: "test" });

      expect(results.items[0].downloadType).toBe("usenet");
      expect(results.items[0].grabs).toBe(10);
      expect(results.items[0].age).toBe(5);
    });
  });
});
