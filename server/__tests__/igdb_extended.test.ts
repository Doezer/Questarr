import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    database: { url: "postgresql://test:password@localhost/test" },
    igdb: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      isConfigured: true,
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

vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

const authResponse = {
  ok: true,
  json: async () => ({
    access_token: "test-token",
    expires_in: 3600,
    token_type: "bearer",
  }),
};

function gamesResponse(games: unknown[]) {
  return { ok: true, json: async () => games };
}

describe("IGDBClient - extended coverage", { timeout: 20000 }, () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
  });

  it("getGamesByGenres returns [] for an empty genre list without hitting the network", async () => {
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByGenres([]);
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getGamesByGenres fetches games matching sanitized genre conditions", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 1, name: "Action Game" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByGenres(["Action", "RPG"], [5, 6], 10);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Action Game");
  });

  it("getGamesByGenres returns [] and logs a warning when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByGenres(["Action"]);
    expect(results).toEqual([]);
  });

  it("getGamesByPlatforms returns [] for an empty platform list", async () => {
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByPlatforms([]);
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getGamesByPlatforms maps known platform names and fetches results", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 2, name: "PC Game" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByPlatforms(
      ["PC (Microsoft Windows)", "PlayStation 5"],
      [1],
      5
    );

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("PC Game");
  });

  it("getGamesByPlatforms returns [] and logs a warning on failure", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByPlatforms(["Xbox One"]);
    expect(results).toEqual([]);
  });

  it("getRecommendations falls back to popular games when the user has no games", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 9, name: "Popular Game" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getRecommendations([], 5);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Popular Game");
  });

  it("getRecommendations uses genre results and stops once the limit is reached", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 1, name: "Genre Game" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getRecommendations(
      [{ genres: ["Action"], platforms: ["PC"], igdbId: 42 }],
      1
    );

    expect(results.map((g) => g.id)).toEqual([1]);
  });

  it("getRecommendations fills remaining slots with popular games filtered for duplicates", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 1, name: "Genre Game" }]))
      .mockResolvedValueOnce(
        gamesResponse([
          { id: 1, name: "Genre Game" },
          { id: 2, name: "Fresh Popular" },
        ])
      );

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getRecommendations([{ genres: ["Action"] }], 2);

    expect(results.map((g) => g.name)).toContain("Fresh Popular");
  });

  it("getRecommendations falls back to popular games when generation throws", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockRejectedValueOnce(new Error("genre search exploded"))
      .mockResolvedValueOnce(gamesResponse([{ id: 3, name: "Fallback Popular" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getRecommendations([{ genres: ["Action"] }], 3);

    expect(results.map((g) => g.name)).toContain("Fallback Popular");
  });

  it("getGamesByGenre returns [] when the sanitized genre is empty", async () => {
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByGenre("");
    expect(results).toEqual([]);
  });

  it("getGamesByGenre clamps limit/offset and returns results", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 4, name: "Clamped Game" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByGenre("Action", 99999, -5);
    expect(results).toHaveLength(1);
  });

  it("getGamesByGenre returns [] on failure", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByGenre("Action");
    expect(results).toEqual([]);
  });

  it("getGamesByPlatform returns [] when the sanitized platform is empty", async () => {
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByPlatform("");
    expect(results).toEqual([]);
  });

  it("getGamesByPlatform fetches results with clamped pagination", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 5, name: "Platform Game" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByPlatform("PC", 0, 0);
    expect(results).toHaveLength(1);
  });

  it("getGamesByPlatform returns [] on failure", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGamesByPlatform("PC");
    expect(results).toEqual([]);
  });

  it("getGenres fetches and returns genre list", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([{ id: 1, name: "Action" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGenres();
    expect(results).toEqual([{ id: 1, name: "Action" }]);
  });

  it("getGenres returns [] on failure", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getGenres();
    expect(results).toEqual([]);
  });

  it("getPlatforms paginates through the primary category and dedupes/sorts results", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(
        gamesResponse(
          Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Platform ${i + 1}` }))
        )
      )
      .mockResolvedValueOnce(gamesResponse([{ id: 101, name: "Platform 101" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getPlatforms();

    expect(results.length).toBe(101);
    expect(results[0].name <= results[results.length - 1].name).toBe(true);
  });

  it("getPlatforms falls back to a broad query when the primary category returns nothing", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([]))
      .mockResolvedValueOnce(gamesResponse([{ id: 1, name: "Broad Platform" }]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getPlatforms();

    expect(results).toEqual([{ id: 1, name: "Broad Platform" }]);
  });

  it("getPlatforms returns the fallback list when both queries return nothing", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(gamesResponse([]))
      .mockResolvedValueOnce(gamesResponse([]));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getPlatforms();

    expect(results.length).toBeGreaterThan(0);
  });

  it("getPlatforms returns the fallback list when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.getPlatforms();
    expect(results.length).toBeGreaterThan(0);
  });

  it("formatGameData formats a fully populated game", async () => {
    const { igdbClient } = await import("../igdb.js");
    const formatted = igdbClient.formatGameData({
      id: 1,
      name: "Full Game",
      summary: "A summary",
      cover: { id: 1, url: "//img/t_thumb/x.jpg" },
      first_release_date: 1609459200,
      rating: 85.5,
      aggregated_rating: 90.2,
      platforms: [{ id: 1, name: "PC" }],
      genres: [{ id: 1, name: "Action" }],
      screenshots: [{ id: 1, url: "//img/t_thumb/s.jpg" }],
      websites: [{ category: 1, url: "https://example.com" }],
      involved_companies: [
        { company: { name: "Dev Co" }, developer: true, publisher: false },
        { company: { name: "Pub Co" }, developer: false, publisher: true },
      ],
      status: 4,
    });

    expect(formatted.title).toBe("Full Game");
    expect(formatted.coverUrl).toBe("https://img/t_cover_big/x.jpg");
    expect(formatted.rating).toBeCloseTo(8.6);
    expect(formatted.aggregatedRating).toBeCloseTo(9);
    expect(formatted.developers).toEqual(["Dev Co"]);
    expect(formatted.publishers).toEqual(["Pub Co"]);
    expect(formatted.earlyAccess).toBe(true);
    expect(formatted.isReleased).toBe(true);
    expect(formatted.releaseYear).toBe(2021);
  });

  it("formatGameData handles a minimal game with no optional fields", async () => {
    const { igdbClient } = await import("../igdb.js");
    const formatted = igdbClient.formatGameData({
      id: 2,
      name: "Minimal Game",
    });

    expect(formatted.summary).toBe("");
    expect(formatted.coverUrl).toBe("");
    expect(formatted.releaseDate).toBe("");
    expect(formatted.rating).toBeNull();
    expect(formatted.platforms).toEqual([]);
    expect(formatted.genres).toEqual([]);
    expect(formatted.publishers).toEqual([]);
    expect(formatted.developers).toEqual([]);
    expect(formatted.screenshots).toEqual([]);
    expect(formatted.isReleased).toBe(false);
    expect(formatted.releaseYear).toBeNull();
    expect(formatted.earlyAccess).toBe(false);
  });

  it("formatGameData treats an unreleased future date as not released", async () => {
    const { igdbClient } = await import("../igdb.js");
    const futureTimestamp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    const formatted = igdbClient.formatGameData({
      id: 3,
      name: "Future Game",
      first_release_date: futureTimestamp,
    });

    expect(formatted.isReleased).toBe(false);
  });
});
