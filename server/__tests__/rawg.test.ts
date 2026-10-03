import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable so tests can toggle key availability without re-mocking. The vi.mock
// factory output is cached per file, so a getter keeps the config object
// stable while the key itself stays test-controllable.
let mockRawgKey = "env-key";

// Mock the config module before importing rawg (env key fallback)
vi.mock("../config.js", () => ({
  config: {
    rawg: {
      get apiKey() {
        return mockRawgKey;
      },
    },
    server: {
      port: 5000,
      host: "localhost",
      nodeEnv: "test",
      isDevelopment: false,
      isProduction: false,
      isTest: true,
    },
  },
}));

// Mock the storage module to prevent DB calls
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

// rawg.ts fetches through the SSRF-safe wrapper rather than global fetch;
// mock it the same way other provider-client tests do.
vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function pagination(results: unknown[]) {
  return { count: results.length, next: null, previous: null, results };
}

describe("RawgClient", { timeout: 20000 }, () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let storageMock: { getSystemConfig: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockRawgKey = "env-key";
    vi.clearAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
    fetchMock.mockReset();
    const { storage } = await import("../storage.js");
    storageMock = storage as unknown as typeof storageMock;
    storageMock.getSystemConfig.mockReset().mockResolvedValue(undefined);
  });

  describe("key resolution", () => {
    it("prefers the user-saved system-config key over the env key", async () => {
      storageMock.getSystemConfig.mockResolvedValue("db-key");
      const { rawgClient } = await import("../rawg.js");
      expect(await rawgClient.getApiKey()).toBe("db-key");
    });

    it("falls back to the RAWG_API_KEY env key", async () => {
      const { rawgClient } = await import("../rawg.js");
      expect(await rawgClient.getApiKey()).toBe("env-key");
    });

    it("reports configured when only the env key exists", async () => {
      const { rawgClient } = await import("../rawg.js");
      expect(await rawgClient.getApiKey()).toBe("env-key");
      expect(await rawgClient.isConfigured()).toBe(true);
    });

    it("returns [] from searchGames without any network call when unconfigured", async () => {
      // Simulate a fully unconfigured instance (no env key, no saved key).
      mockRawgKey = "";
      storageMock.getSystemConfig.mockResolvedValue(undefined);
      const { rawgClient } = await import("../rawg.js");
      expect(await rawgClient.isConfigured()).toBe(false);
      expect(await rawgClient.searchGames("hollow knight")).toEqual([]);
      expect(await rawgClient.getPopularGames()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("request plumbing", () => {
    it("sends the Key header and the search query params", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(pagination([])));
      const { rawgClient } = await import("../rawg.js");

      await rawgClient.searchGames("hollow knight", 20, { platform: "pc" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      const u = new URL(url as string);
      expect(u.origin + u.pathname).toBe("https://api.rawg.io/api/games");
      expect(u.searchParams.get("search")).toBe("hollow knight");
      expect(u.searchParams.get("page_size")).toBe("20");
      const headers = (options as { headers: Record<string, string> }).headers;
      expect(headers.Key).toBe("env-key");
    });

    it("throws RawgApiError with status on 401", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: "invalid key" }, false, 401));
      const { rawgClient, RawgApiError } = await import("../rawg.js");

      await expect(rawgClient.searchGames("test")).rejects.toMatchObject({
        name: "RawgApiError",
        status: 401,
      });
      expect(RawgApiError).toBeDefined();
    });

    it("surfaces 429 as a rate-limit error", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: "slow down" }, false, 429));
      const { rawgClient, RawgApiError } = await import("../rawg.js");

      const error = await rawgClient.getPopularGames().catch((e) => e);
      expect(error).toBeInstanceOf(RawgApiError);
      expect((error as RawgApiError).status).toBe(429);
    });

    it("testApiKey reports success for a working key", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(pagination([{ id: 1, name: "x" }])));
      const { rawgClient } = await import("../rawg.js");
      const result = await rawgClient.testApiKey("some-key");
      expect(result).toEqual({ success: true });
      const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
      expect(headers.Key).toBe("some-key");
    });

    it("testApiKey reports a rejected key", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: "invalid" }, false, 401));
      const { rawgClient } = await import("../rawg.js");
      const result = await rawgClient.testApiKey("bad-key");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/rejected/i);
    });
  });

  describe("formatGame", () => {
    const game = {
      id: 3109,
      slug: "hollow-knight",
      name: "Hollow Knight",
      released: "2017-02-24",
      tba: false,
      image: "https://media.rawg.io/media/games/ab2a35-b.jpg",
      background_image: "https://media.rawg.io/media/screenshots/bg.jpg",
      description: "Descend into an intricate kingdom.<br/>Full of <b>mystery</b> &amp; peril.",
      metacritic: 87,
      website: "https://hollowknight.com",
      esrb_rating: { id: 12, slug: "teen", name: "T" },
      platforms: [
        { id: 4, name: "PC" },
        { id: 1, name: "Nintendo Switch" },
      ],
      genres: [{ id: 7, name: "Metroidvania" }],
      developers: [{ id: 5, name: "Team Cherry" }],
      publishers: [{ id: 9, name: "Team Cherry" }],
      tags: [
        { id: 2, name: "atmospheric" },
        { id: 3, name: "2d" },
        { id: 4, name: " " },
      ],
      additions: [
        {
          id: 100,
          name: "Hallownest Edition",
          image: "https://media.rawg.io/media/games/ed.jpg",
          released: "2019-08-20",
        },
      ],
    };

    it("maps the RAWG game onto the shared discovery shape", async () => {
      const { rawgClient } = await import("../rawg.js");
      const formatted = rawgClient.formatGame(game as never, [
        "https://media.rawg.io/media/screenshots/s1.jpg",
      ]);

      expect(formatted.id).toBe("rawg-3109");
      expect(formatted.source).toBe("rawg");
      expect(formatted.rawgId).toBe(3109);
      expect(formatted.rawgSlug).toBe("hollow-knight");
      expect(formatted.title).toBe("Hollow Knight");
      expect(formatted.summary).toBe("Descend into an intricate kingdom. Full of mystery & peril.");
      expect(formatted.coverUrl).toBe("https://media.rawg.io/media/games/ab2a35-b.jpg");
      expect(formatted.releaseDate).toBe("2017-02-24");
      expect(formatted.aggregatedRating).toBe(87);
      expect(formatted.platforms).toEqual(["PC", "Nintendo Switch"]);
      expect(formatted.genres).toEqual(["Metroidvania"]);
      // tags fill the themes slot; blank names are dropped
      expect(formatted.themes).toEqual(["atmospheric", "2d"]);
      expect(formatted.developers).toEqual(["Team Cherry"]);
      expect(formatted.publishers).toEqual(["Team Cherry"]);
      expect(formatted.screenshots).toEqual(["https://media.rawg.io/media/screenshots/s1.jpg"]);
      expect(formatted.websites).toEqual([{ category: 1, url: "https://hollowknight.com" }]);
      expect(formatted.isReleased).toBe(true);
      expect(formatted.releaseYear).toBe(2017);
      expect(formatted.earlyAccess).toBe(false);
      expect(formatted.category).toBe("main");
      expect(formatted.rawgUrl).toBe("https://rawg.io/games/hollow-knight");
      expect(formatted.expansions).toEqual([
        {
          id: 100,
          name: "Hallownest Edition",
          coverUrl: "https://media.rawg.io/media/games/ed.jpg",
          releaseDate: "2019-08-20",
          category: "dlc",
          rawgUrl: "https://rawg.io/games/100",
        },
      ]);
    });

    it("flags ESRB Mature / Adults Only as age restricted", async () => {
      const { rawgClient } = await import("../rawg.js");

      const mature = rawgClient.formatGame({
        ...game,
        esrb_rating: { id: 13, slug: "mature", name: "M" },
      } as never);
      expect(mature.isAgeRestricted).toBe(true);

      const ao = rawgClient.formatGame({
        ...game,
        esrb_rating: { id: 14, slug: "adults-only", name: "AO" },
      } as never);
      expect(ao.isAgeRestricted).toBe(true);

      const everyone = rawgClient.formatGame({
        ...game,
        esrb_rating: { id: 9, slug: "everyone", name: "E" },
      } as never);
      expect(everyone.isAgeRestricted).toBe(false);
    });

    it("leaves isAdultContent false (RAWG has no equivalent field)", async () => {
      const { rawgClient } = await import("../rawg.js");
      const formatted = rawgClient.formatGame(game as never);
      expect(formatted.isAdultContent).toBe(false);
    });

    it("handles TBA games (no release date)", async () => {
      const { rawgClient } = await import("../rawg.js");
      const formatted = rawgClient.formatGame({
        ...game,
        released: null,
        tba: true,
      } as never);
      expect(formatted.releaseDate).toBe("");
      expect(formatted.isReleased).toBe(false);
      expect(formatted.releaseYear).toBeNull();
    });
  });

  describe("discovery endpoints", () => {
    it("getPopularGames orders by most added and filters platform/genre server-side", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          pagination([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ])
        )
      );
      const { rawgClient } = await import("../rawg.js");
      const results = await rawgClient.getPopularGames(30, { platform: "pc", genre: "action" });

      expect(results.map((g) => g.name)).toEqual(["A", "B"]);
      const u = new URL(fetchMock.mock.calls[0][0] as string);
      expect(u.searchParams.get("ordering")).toBe("-added");
      expect(u.searchParams.get("platforms")).toBe("pc");
      expect(u.searchParams.get("genres")).toBe("action");
      expect(u.searchParams.get("page_size")).toBe("30");
    });

    it("getRecentReleases drops undated games", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          pagination([
            { id: 1, name: "Dated", released: "2026-01-01" },
            { id: 2, name: "Undated", released: null },
          ])
        )
      );
      const { rawgClient } = await import("../rawg.js");
      const results = await rawgClient.getRecentReleases(10);
      expect(results.map((g) => g.name)).toEqual(["Dated"]);
    });

    it("getUpcomingReleases uses a one-year dates window", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(pagination([])));
      const { rawgClient } = await import("../rawg.js");
      await rawgClient.getUpcomingReleases(10);

      const u = new URL(fetchMock.mock.calls[0][0] as string);
      const dates = (u.searchParams.get("dates") ?? "").split(",");
      expect(dates).toHaveLength(2);
      expect(() => {
        const from = new Date(dates[0]);
        const to = new Date(dates[1]);
        expect(Number.isNaN(from.getTime())).toBe(false);
        expect(to.getFullYear() - from.getFullYear()).toBe(1);
      }).not.toThrow();
    });

    it("getGamesByGenre/Platform use the slug in the query", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(pagination([{ id: 1, name: "X" }])));
      fetchMock.mockResolvedValueOnce(jsonResponse(pagination([{ id: 2, name: "Y" }])));
      const { rawgClient } = await import("../rawg.js");

      await rawgClient.getGamesByGenre("metroidvania", 10, 10);
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("genres")).toBe(
        "metroidvania"
      );
      // offset 10 with page_size 10 -> page 2
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("page")).toBe("2");

      await rawgClient.getGamesByPlatform("nintendo-switch", 10, 0);
      expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("platforms")).toBe(
        "nintendo-switch"
      );
    });

    it("getGameById returns null on 404", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: "not found" }, false, 404));
      const { rawgClient } = await import("../rawg.js");
      await expect(rawgClient.getGameById(999999)).resolves.toBeNull();
    });

    it("getGenres/getPlatforms return the taxonomy list", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          pagination([
            { id: 2, name: "Shooter", slug: "shooter" },
            { id: 1, name: "Action", slug: "action" },
          ])
        )
      );
      const { rawgClient } = await import("../rawg.js");
      const genres = await rawgClient.getGenres();
      expect(genres.map((g) => g.name)).toEqual(["Action", "Shooter"]);
    });
  });

  describe("getGamesForRefresh", () => {
    it("fetches each game once and only re-fetches screenshots when asked", async () => {
      // Two games: first has stored screenshots (no screenshot fetch),
      // second does not (screenshots fetched). Call order per game is
      // [game, screenshots?].
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ id: 1, name: "G1" }))
        .mockResolvedValueOnce(jsonResponse({ id: 2, name: "G2" }))
        .mockResolvedValueOnce(
          jsonResponse(pagination([{ id: 10, image: "https://s.example/1.jpg" }]))
        );

      const { rawgClient } = await import("../rawg.js");
      const map = await rawgClient.getGamesForRefresh([1, 2], (id) => id === 2);

      expect(map.size).toBe(2);
      expect(map.get(1)?.screenshots).toEqual([]);
      expect(map.get(2)?.screenshots).toEqual(["https://s.example/1.jpg"]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("returns an empty map without requests when no IDs are given", async () => {
      const { rawgClient } = await import("../rawg.js");
      const map = await rawgClient.getGamesForRefresh([], () => true);
      expect(map.size).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips individual failures without aborting the rest", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ message: "boom" }, false, 500))
        .mockResolvedValueOnce(jsonResponse({ id: 2, name: "G2" }));

      const { rawgClient } = await import("../rawg.js");
      const map = await rawgClient.getGamesForRefresh([1, 2], () => false);
      expect(map.has(1)).toBe(false);
      expect(map.has(2)).toBe(true);
    });
  });
});
