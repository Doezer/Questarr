import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { xrelClient, XrelSceneRelease, XrelP2pRelease } from "../xrel.js";
import { safeFetch } from "../ssrf.js";

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn((url, options) => fetch(url, options)) as Mock,
  isSafeUrl: vi.fn().mockResolvedValue(true),
}));

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe("xREL Client", () => {
  let currentTime = 1600000000000;

  beforeEach(() => {
    vi.useFakeTimers();
    // Advance time significantly between tests to avoid hitting the internal rate limiter
    // of xrel.ts (which waits 2.5s if called too soon).
    currentTime += 10000;
    vi.setSystemTime(currentTime);
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("searchReleases", () => {
    it("should fetch and parse scene releases correctly", async () => {
      const mockResponse = {
        results: [
          {
            id: "123",
            dirname: "Game.Name-GROUP",
            link_href: "/release/123.html",
            time: 1600000000,
            group_name: "GROUP",
            size: { number: 1024, unit: "MB" },
            ext_info: {
              type: "master_game",
              id: "game1",
              title: "Game Name",
              link_href: "/game/game1.html",
            },
          } as XrelSceneRelease,
          {
            id: "124",
            dirname: "Movie.Name-GROUP",
            link_href: "/release/124.html",
            time: 1600000000,
            group_name: "GROUP",
            ext_info: {
              type: "movie",
              id: "movie1",
              title: "Movie Name",
              link_href: "/movie/movie1.html",
            },
          } as XrelSceneRelease,
        ],
        p2p_results: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const results = await xrelClient.searchReleases("Game Name");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("https://xrel-api.nfos.to/v2/search/releases.json"),
        expect.objectContaining({
          headers: expect.objectContaining({ "User-Agent": "Questarr/1.1.0" }),
        })
      );

      // Should filter out non-game releases
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "123",
        dirname: "Game.Name-GROUP",
        link_href: "/release/123.html",
        time: 1600000000,
        group_name: "GROUP",
        sizeMb: 1024,
        sizeUnit: "MB",
        ext_info: mockResponse.results[0].ext_info,
        source: "scene",
      });
    });

    it("captures the nuke reason when a scene release has been nuked", async () => {
      const mockResponse = {
        results: [
          {
            id: "125",
            dirname: "Nuked.Game.Name-GROUP",
            link_href: "/release/125.html",
            time: 1600000000,
            group_name: "GROUP",
            nuke_reason: "bad crack, use PROPER",
            ext_info: {
              type: "master_game",
              id: "game2",
              title: "Nuked Game Name",
              link_href: "/game/game2.html",
            },
          } as XrelSceneRelease,
        ],
        p2p_results: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const results = await xrelClient.searchReleases("Nuked Game Name");

      expect(results).toHaveLength(1);
      expect(results[0].nukeReason).toBe("bad crack, use PROPER");
    });

    it("leaves nukeReason unset for a scene release that was not nuked", async () => {
      const mockResponse = {
        results: [
          {
            id: "126",
            dirname: "Clean.Game.Name-GROUP",
            link_href: "/release/126.html",
            time: 1600000000,
            group_name: "GROUP",
            ext_info: {
              type: "master_game",
              id: "game3",
              title: "Clean Game Name",
              link_href: "/game/game3.html",
            },
          } as XrelSceneRelease,
        ],
        p2p_results: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const results = await xrelClient.searchReleases("Clean Game Name");

      expect(results).toHaveLength(1);
      expect(results[0].nukeReason).toBeUndefined();
    });

    it("falls back to a generic nuke reason when flags.nuke_rls is set but nuke_reason is absent", async () => {
      // xREL can flag a release as nuked without ever populating nuke_reason
      // -- the badge must still show up rather than silently disappearing.
      const mockResponse = {
        results: [
          {
            id: "127",
            dirname: "Flag.Only.Nuke-GROUP",
            link_href: "/release/127.html",
            time: 1600000000,
            group_name: "GROUP",
            flags: { nuke_rls: true },
            ext_info: {
              type: "master_game",
              id: "game4",
              title: "Flag Only Nuke",
              link_href: "/game/game4.html",
            },
          } as XrelSceneRelease,
        ],
        p2p_results: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const results = await xrelClient.searchReleases("Flag Only Nuke");

      expect(results).toHaveLength(1);
      expect(results[0].nukeReason).toBe("Nuked (no reason provided)");
    });

    it("should fetch and parse p2p releases correctly when requested", async () => {
      const mockResponse = {
        results: [],
        p2p_results: [
          {
            id: "p2p1",
            dirname: "Game.Name.P2P-GROUP",
            link_href: "/p2p/p2p1.html",
            pub_time: 1600000000,
            size_mb: 2048,
            group: { id: "g1", name: "P2PGROUP" },
            ext_info: {
              type: "master_game",
              id: "game1",
              title: "Game Name",
              link_href: "/game/game1.html",
            },
          } as XrelP2pRelease,
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const results = await xrelClient.searchReleases("Game Name", { p2p: true });

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("p2p=1"), expect.anything());

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "p2p1",
        source: "p2p",
        group_name: "P2PGROUP",
        sizeMb: 2048,
        sizeUnit: "MB",
      });
    });

    it("should handle API errors gracefully", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(xrelClient.searchReleases("fail")).rejects.toThrow(
        "xREL API error: 500 Internal Server Error"
      );
    });

    it("should handle rate limiting errors", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      await expect(xrelClient.searchReleases("rate")).rejects.toThrow(
        "xREL API rate limit exceeded"
      );
    });

    it("should respect rate limit intervals", async () => {
      // Mock successful responses
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      // First call - should succeed immediately (we advanced time in beforeEach)
      await xrelClient.searchReleases("query1");

      // Second call - should wait because interval hasn't passed
      const p2 = xrelClient.searchReleases("query2");

      // It should be pending now. We advance time to trigger the timeout.
      await vi.advanceTimersByTimeAsync(3000);

      // Now it should resolve
      await p2;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("passes a 24s timeout through to safeFetch", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await xrelClient.searchReleases("timeout wiring");

      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v2/search/releases.json"),
        expect.objectContaining({ timeoutMs: 24000 })
      );
    });

    it("aborts/rejects once the request hangs past the 24s timeout instead of stalling the search", async () => {
      // Simulate a hung downstream request: only settle once the caller's own
      // timeoutMs elapses (standing in for safeFetch's real AbortSignal.timeout
      // wiring, which this test file mocks out at the module level).
      vi.mocked(safeFetch).mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            const timeoutMs = (options as { timeoutMs?: number } | undefined)?.timeoutMs;
            if (typeof timeoutMs === "number") {
              setTimeout(() => reject(new Error("The operation timed out")), timeoutMs);
            }
            // Otherwise: never resolves -- a genuine hang, proving a missing
            // timeout would stall this call (and the search hot path) forever.
          })
      );

      const pending = xrelClient.searchReleases("hung request");
      const assertion = expect(pending).rejects.toThrow(/timed out/i);

      // Not yet timed out just before the 24s mark.
      await vi.advanceTimersByTimeAsync(23999);
      // Crosses the 24s timeout.
      await vi.advanceTimersByTimeAsync(1);

      await assertion;
    });
  });

  describe("getLatestReleases", () => {
    it("should return latest game releases", async () => {
      const mockResponse = {
        list: [
          {
            id: "1",
            dirname: "New.Game-SCENE",
            ext_info: { type: "master_game", title: "New Game" },
            time: 12345,
          },
          {
            id: "2",
            dirname: "New.Movie-SCENE",
            ext_info: { type: "movie", title: "New Movie" },
            time: 12346,
          },
        ],
        pagination: { current_page: 1, per_page: 50, total_pages: 10 },
        total_count: 500,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await xrelClient.getLatestReleases();

      expect(result.list).toHaveLength(1);
      expect(result.list[0].id).toBe("1");
      expect(result.total_count).toBe(500);
    });

    it("falls back to a generic nuke reason when flags.nuke_rls is set but nuke_reason is absent", async () => {
      const mockResponse = {
        list: [
          {
            id: "3",
            dirname: "Flag.Only.Nuke-SCENE",
            ext_info: { type: "master_game", title: "Flag Only Nuke" },
            time: 12347,
            flags: { nuke_rls: true },
          },
        ],
        pagination: { current_page: 1, per_page: 50, total_pages: 1 },
        total_count: 1,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await xrelClient.getLatestReleases();

      expect(result.list).toHaveLength(1);
      expect(result.list[0].nukeReason).toBe("Nuked (no reason provided)");
    });
  });

  describe("titleMatches", () => {
    it("should match identical titles", () => {
      expect(xrelClient.titleMatches("Game Name", "Game Name")).toBe(true);
    });

    it("should match case-insensitive", () => {
      expect(xrelClient.titleMatches("game name", "GAME NAME")).toBe(true);
    });

    it("should match loose inclusion", () => {
      expect(xrelClient.titleMatches("Super Game", "Super Game - GOTY Edition")).toBe(true);
      expect(xrelClient.titleMatches("Super Game - GOTY Edition", "Super Game")).toBe(true);
    });

    it("should not match unrelated titles", () => {
      expect(xrelClient.titleMatches("Game A", "Game B")).toBe(false);
    });

    it("should normalize whitespace", () => {
      expect(xrelClient.titleMatches("Game   Name", "Game Name")).toBe(true);
    });
  });
});
