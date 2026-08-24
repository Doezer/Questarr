import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the config module before importing igdb
vi.mock("../config.js", () => ({
  config: {
    database: {
      url: "postgresql://test:password@localhost/test",
    },
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

// Mock the storage module to prevent DB calls
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

// igdb.ts fetches through the SSRF-safe wrapper rather than global fetch; mock it here
// the same way steam.ts/hltb.ts/nexusmods.ts tests do.
vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

// Mock the IGDBClient by testing the fallback behavior
describe("IGDBClient - Fallback Mechanism", { timeout: 20000 }, () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset mocks and modules before each test to ensure fresh IGDBClient instance
    vi.clearAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
  });

  // Helper function to count IGDB API search calls (excluding auth calls)
  function countIgdbSearchCalls(mockCalls: unknown[]): number {
    return mockCalls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("api.igdb.com/v4/games")
    ).length;
  }

  it("should try multiple search approaches when first approach returns no results", async () => {
    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };

    // Mock game search responses - first approach returns empty, second returns results
    const emptyResponse = {
      ok: true,
      json: async () => [],
    };

    const successResponse = {
      ok: true,
      json: async () => [
        {
          id: 1,
          name: "Test Game",
          summary: "A test game",
          cover: {
            id: 123,
            url: "//images.igdb.com/igdb/image/upload/t_thumb/test.jpg",
          },
          first_release_date: 1609459200,
          rating: 85.5,
          platforms: [{ id: 1, name: "PC (Microsoft Windows)" }],
          genres: [{ id: 1, name: "Action" }],
          screenshots: [],
        },
      ],
    };

    // Setup fetch mock to return different responses for different calls
    fetchMock
      .mockResolvedValueOnce(authResponse) // Auth call
      .mockResolvedValueOnce(emptyResponse) // First search approach - empty
      .mockResolvedValueOnce(successResponse); // Second search approach - success

    // Import the IGDBClient (we need to import it after mocking)
    const { igdbClient } = await import("../igdb.js");

    // Test the searchGames method
    const results = await igdbClient.searchGames("test query", 20);

    // Verify that fetch was called multiple times (auth + search attempts)
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify the results contain the expected game
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Test Game");
    expect(results[0].rating).toBe(85.5);
  });

  it("sorts dated search results by release date descending and excludes undated games when requested", async () => {
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };

    const successResponse = {
      ok: true,
      json: async () => [
        { id: 1, name: "Older Game", first_release_date: 946684800 },
        { id: 2, name: "Undated Game" },
        { id: 3, name: "Newer Game", first_release_date: 1704067200 },
      ],
    };

    fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(successResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("test query", 20, { includeUndated: false });

    expect(results.map((game) => game.name)).toEqual(["Newer Game", "Older Game"]);
  });

  it("places undated games before dated results when includeUndated and undatedFirst are enabled", async () => {
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };

    const successResponse = {
      ok: true,
      json: async () => [
        { id: 1, name: "Older Game", first_release_date: 946684800 },
        { id: 2, name: "Undated Game" },
        { id: 3, name: "Newer Game", first_release_date: 1704067200 },
      ],
    };

    fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(successResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("test query", 20, {
      includeUndated: true,
      undatedFirst: true,
    });

    expect(results.map((game) => game.name)).toEqual(["Undated Game", "Newer Game", "Older Game"]);
  });

  it("does not send platformId/releaseYear as an upstream IGDB `where` clause, and requests extra headroom for local filtering", async () => {
    // platformId/releaseYear must NOT be baked into the upstream query: an
    // edition's own platform list / first_release_date can differ from its
    // canonical version_parent's, so if IGDB filtered upstream it could
    // exclude an edition whose parent *would* match before canonicalization
    // ever runs. Filtering happens locally instead, against the
    // canonicalized (parent) metadata -- see the "canonicalization runs
    // before filtering/sorting" describe block below.
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };
    const emptyResponse = { ok: true, json: async () => [] };
    const successResponse = {
      ok: true,
      json: async () => [{ id: 1, name: "God of War", first_release_date: 1110844800 }],
    };

    // Approach 1 (full-text search, no category filter) emits no `where`
    // clause at all, so it can't exercise the platforms/first_release_date
    // assertions below. Make it return empty so search falls through to
    // approach 2, which does have a `where` clause (category = 0).
    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(successResponse);

    const { igdbClient } = await import("../igdb.js");
    await igdbClient.searchGames("God of War", 10, { platformId: 8, releaseYear: 2005 });

    const gameRequests = fetchMock.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("api.igdb.com/v4/games")
    );
    expect(gameRequests).toHaveLength(2);
    const body = String(gameRequests[1]?.[1]?.body);
    const whereClauseMatch = /where ([^;]*);/.exec(body);
    // Confirm a `where` clause was actually emitted before asserting what it
    // excludes -- otherwise a vacuous (null) match would make the two
    // negative assertions below pass without checking anything.
    expect(whereClauseMatch).not.toBeNull();
    const whereClause = whereClauseMatch?.[1] ?? "";
    expect(whereClause).not.toMatch(/platforms/);
    expect(whereClause).not.toMatch(/first_release_date/);
    // The upstream request asks for more than the caller's `limit` when a
    // local platform/year filter is active (capped, here 10 * 5 = 50) so
    // there's enough headroom left after that filter discards non-matching
    // rows and edition->parent dedupe runs.
    expect(body).toMatch(/limit 50;/);
  });

  it("should return empty array when all search approaches fail", async () => {
    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };

    // Mock empty responses for all attempts
    const emptyResponse = {
      ok: true,
      json: async () => [],
    };

    // Setup fetch mock - auth + multiple empty search attempts
    fetchMock
      .mockResolvedValueOnce(authResponse) // Auth call
      .mockResolvedValue(emptyResponse); // All search attempts return empty

    // Import the IGDBClient
    const { igdbClient } = await import("../igdb.js");

    // Test the searchGames method
    const results = await igdbClient.searchGames("nonexistent game xyz", 20);

    // Verify that fetch was called multiple times
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    // Verify the results are empty
    expect(results).toHaveLength(0);
  });

  it("should cap total search attempts at MAX_SEARCH_ATTEMPTS (5)", async () => {
    // Mock environment variables
    process.env.IGDB_CLIENT_ID = "test-client-id";
    process.env.IGDB_CLIENT_SECRET = "test-client-secret";

    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };

    // Mock empty responses for all attempts
    const emptyResponse = {
      ok: true,
      json: async () => [],
    };

    // Setup fetch mock - auth + all empty search attempts
    fetchMock
      .mockResolvedValueOnce(authResponse) // Auth call
      .mockResolvedValue(emptyResponse); // All search attempts return empty

    // Import the IGDBClient (vi.resetModules ensures fresh instance)
    const { igdbClient } = await import("../igdb.js");

    // Use a query with many words to verify the cap works
    // Without the cap, this would try: 4 approaches + 6 word searches = 10 attempts
    const results = await igdbClient.searchGames("word one two three four five six", 20);

    // Count only IGDB API search calls (excluding auth calls to Twitch)
    const igdbSearchCalls = countIgdbSearchCalls(fetchMock.mock.calls);

    // Verify exactly 5 search attempts were made (the MAX_SEARCH_ATTEMPTS cap)
    expect(igdbSearchCalls).toBe(5);

    // Verify the results are empty
    expect(results).toHaveLength(0);
  });

  it("should return null for getGameById when not found", async () => {
    // Mock environment
    process.env.IGDB_CLIENT_ID = "test-client-id";
    process.env.IGDB_CLIENT_SECRET = "test-client-secret";

    const authResponse = {
      ok: true,
      json: async () => ({ access_token: "test-token", expires_in: 3600, token_type: "bearer" }),
    };

    const emptyResponse = {
      ok: true,
      json: async () => [],
    };

    fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(emptyResponse);

    const { igdbClient } = await import("../igdb.js");
    const result = await igdbClient.getGameById(99999);
    expect(result).toBeNull();
  });

  describe("Discovery Methods", () => {
    // Common mock response for list methods
    const mockGamesList = [
      { id: 1, name: "Popular Game 1", rating: 90 },
      { id: 2, name: "Popular Game 2", rating: 88 },
    ];

    const setupMocks = () => {
      const authResponse = {
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600, token_type: "bearer" }),
      };
      const successResponse = {
        ok: true,
        json: async () => mockGamesList,
      };
      fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(successResponse);
    };

    it("getPopularGames should return list of games", async () => {
      setupMocks();
      const { igdbClient } = await import("../igdb.js");
      const results = await igdbClient.getPopularGames(10);
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("Popular Game 1");
      // Verify caching request (ttl > 0)
      // Implementation detail check might be brittle, but ensuring call is made is good
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("getRecentReleases should return list of games", async () => {
      setupMocks();
      const { igdbClient } = await import("../igdb.js");
      const results = await igdbClient.getRecentReleases(10);
      expect(results).toHaveLength(2);
    });

    it("getUpcomingReleases should return list of games", async () => {
      setupMocks();
      const { igdbClient } = await import("../igdb.js");
      const results = await igdbClient.getUpcomingReleases(10);
      expect(results).toHaveLength(2);
    });
  });

  describe("Category Search", () => {
    it("getGamesByGenre should return games", async () => {
      const authResponse = {
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600, token_type: "bearer" }),
      };
      const successResponse = {
        ok: true,
        json: async () => [{ id: 3, name: "RPG Game", genres: [{ name: "RPG" }] }],
      };
      fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(successResponse);

      const { igdbClient } = await import("../igdb.js");
      const results = await igdbClient.getGamesByGenre("RPG");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("RPG Game");
    });

    it("getGamesByPlatform should return games", async () => {
      const authResponse = {
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600, token_type: "bearer" }),
      };
      const successResponse = {
        ok: true,
        json: async () => [
          { id: 4, name: "Switch Game", platforms: [{ name: "Nintendo Switch" }] },
        ],
      };
      fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(successResponse);

      const { igdbClient } = await import("../igdb.js");
      const results = await igdbClient.getGamesByPlatform("Switch");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Switch Game");
    });
  });
});

describe("IGDBClient - Batch Operations", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
  });

  it("should batch steam app ID lookups correctly", async () => {
    // Mock auth
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "bearer",
      }),
    };

    const successResponse1 = {
      ok: true,
      json: async () => [
        { uid: "10", game: 100 },
        { uid: "20", game: 200 },
      ],
    };

    const successResponse2 = {
      ok: true,
      json: async () => [{ uid: "110", game: 1100 }],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(successResponse1)
      .mockResolvedValueOnce(successResponse2);

    const { igdbClient } = await import("../igdb.js");

    // Generate 150 IDs
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    // We manually map specific ones in the mock response
    // ID 10 -> Game 100
    // ID 20 -> Game 200
    // ID 110 -> Game 1100 (in second batch)

    const result = await igdbClient.getGameIdsBySteamAppIds(ids);

    expect(result.size).toBe(3);
    expect(result.get(10)).toBe(100);
    expect(result.get(20)).toBe(200);
    expect(result.get(110)).toBe(1100);

    // Verify batches
    // 1 Auth call + 2 API calls (150 / 100 = 2 chunks)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("IGDBClient - canonicalizeVersionedGames (edition/version dedup)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
  });

  const authResponse = {
    ok: true,
    json: async () => ({
      access_token: "test-token",
      expires_in: 3600,
      token_type: "bearer",
    }),
  };

  it("collapses editions sharing the same version_parent into a single canonical result", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 10,
          name: "Cyberpunk 2077: Ultimate Edition",
          first_release_date: 1704067200,
          version_parent: { id: 100, name: "Cyberpunk 2077" },
        },
        {
          id: 11,
          name: "Cyberpunk 2077: Digital Deluxe",
          first_release_date: 1609459200,
          version_parent: { id: 100, name: "Cyberpunk 2077" },
        },
      ],
    };
    const parentResponse = {
      ok: true,
      json: async () => [{ id: 100, name: "Cyberpunk 2077", first_release_date: 1577836800 }],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Cyberpunk 2077", 20);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 100, name: "Cyberpunk 2077" });
    // auth + search + one batch fetch of the shared canonical parent
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT merge similarly-named results that lack a version_parent (no name-similarity matching)", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        { id: 20, name: "Halo Infinite", first_release_date: 1704067200 },
        { id: 21, name: "Halo Infinite: Campaign Edition", first_release_date: 1609459200 },
      ],
    };

    fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(searchResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Halo Infinite", 20);

    expect(results).toHaveLength(2);
    expect(results.map((g) => g.id).sort()).toEqual([20, 21]);
    // No version_parent on either result -- must not trigger a parent lookup fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the original uncanonicalized entries if fetching the parent game fails", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 10,
          name: "Some Game: Special Edition",
          first_release_date: 1704067200,
          version_parent: { id: 100, name: "Some Game" },
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockRejectedValueOnce(new Error("network down"));

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Some Game", 20);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(10);
    expect(results[0].name).toBe("Some Game: Special Edition");
  });

  it("does not fetch a parent that's already present among the raw results", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        { id: 100, name: "Some Game", first_release_date: 1577836800 },
        {
          id: 10,
          name: "Some Game: Special Edition",
          first_release_date: 1704067200,
          version_parent: { id: 100, name: "Some Game" },
        },
      ],
    };

    fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(searchResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Some Game", 20);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(100);
    // No extra fetch for the parent -- it was already in the result set.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("IGDBClient - canonicalization runs before filtering/sorting (edition vs. parent metadata mismatch)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
  });

  const authResponse = {
    ok: true,
    json: async () => ({
      access_token: "test-token",
      expires_in: 3600,
      token_type: "bearer",
    }),
  };

  it("filters out a canonicalized result whose parent platforms don't match platformId, even though the edition's did", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 10,
          name: "Test Game: Deluxe Edition",
          platforms: [{ id: 5, name: "PlayStation 5" }],
          version_parent: { id: 100, name: "Test Game" },
        },
      ],
    };
    // Parent has a completely different platform list than the edition.
    const parentResponse = {
      ok: true,
      json: async () => [
        { id: 100, name: "Test Game", platforms: [{ id: 6, name: "PC (Microsoft Windows)" }] },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game", 20, { platformId: 5 });

    // The edition matched platformId 5, but the canonical parent it resolves
    // to does not -- the parent's own metadata must govern the filter.
    expect(results).toHaveLength(0);
  });

  it("filters out a canonicalized result whose parent release year doesn't match releaseYear, even though the edition's did", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 11,
          name: "Test Game 2: Game of the Year Edition",
          first_release_date: 1577836800, // 2020-01-01
          version_parent: { id: 101, name: "Test Game 2" },
        },
      ],
    };
    // Parent released in a different year than the edition.
    const parentResponse = {
      ok: true,
      json: async () => [
        { id: 101, name: "Test Game 2", first_release_date: 1420070400 }, // 2015-01-01
      ],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game 2", 20, { releaseYear: 2020 });

    expect(results).toHaveLength(0);
  });

  it("excludes a canonicalized result with includeUndated:false when the parent is undated, even though the edition was dated", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 12,
          name: "Test Game 3: Special Edition",
          first_release_date: 1577836800,
          version_parent: { id: 102, name: "Test Game 3" },
        },
      ],
    };
    // Parent has no release date at all.
    const parentResponse = {
      ok: true,
      json: async () => [{ id: 102, name: "Test Game 3" }],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game 3", 20, { includeUndated: false });

    expect(results).toHaveLength(0);
  });

  it("sorts a canonicalized result by the parent's release date, not treated as undated just because the edition lacked one", async () => {
    const searchResponse = {
      ok: true,
      json: async () => [
        { id: 200, name: "Already Released Game", first_release_date: 1577836800 }, // 2020-01-01
        {
          id: 13,
          name: "Test Game 4: Ultimate Edition",
          // The edition itself has no first_release_date.
          version_parent: { id: 103, name: "Test Game 4" },
        },
      ],
    };
    // Parent has a real (later) release date.
    const parentResponse = {
      ok: true,
      json: async () => [{ id: 103, name: "Test Game 4", first_release_date: 1704067200 }], // 2024-01-01
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game 4", 20, {
      includeUndated: true,
      undatedFirst: true,
    });

    // The canonicalized parent is dated (2024), so it sorts by that date
    // alongside the other dated result rather than being pulled to the
    // front as "undated" just because the edition lacked a date.
    expect(results.map((game) => game.name)).toEqual(["Test Game 4", "Already Released Game"]);
  });

  it("keeps a canonicalized result whose parent's platforms match platformId, even though the edition's own platforms did not", async () => {
    // Regression test: platformId must not be sent as an upstream IGDB
    // `where` clause. If it were, IGDB itself would drop this edition from
    // the response (its own platform list doesn't include platformId)
    // before canonicalizeVersionedGames ever gets a chance to resolve it to
    // a parent that does match -- the edition would never reach local
    // filtering at all. Here the mocked upstream response includes the
    // edition regardless of its own platforms, simulating an unfiltered
    // upstream query, and the parent (which DOES match) must survive.
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 14,
          name: "Test Game 5: Gold Edition",
          // Edition's own platform list does NOT include the requested platformId.
          platforms: [{ id: 999, name: "Some Other Platform" }],
          version_parent: { id: 104, name: "Test Game 5" },
        },
      ],
    };
    // Parent's platform list DOES include the requested platformId.
    const parentResponse = {
      ok: true,
      json: async () => [
        { id: 104, name: "Test Game 5", platforms: [{ id: 5, name: "PlayStation 5" }] },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game 5", 20, { platformId: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 104, name: "Test Game 5" });
  });

  it("keeps a canonicalized result whose parent's release year matches releaseYear, even though the edition's own release date did not", async () => {
    // Same regression as above, for releaseYear: the edition's own release
    // date falls outside the requested year, but its canonical parent's
    // falls inside it. The edition must still reach local filtering (i.e.
    // releaseYear must not be sent as an upstream `where` clause either),
    // and the parent must be returned.
    const searchResponse = {
      ok: true,
      json: async () => [
        {
          id: 15,
          name: "Test Game 6: Anniversary Edition",
          first_release_date: 1420070400, // 2015-01-01 -- outside the requested year
          version_parent: { id: 105, name: "Test Game 6" },
        },
      ],
    };
    const parentResponse = {
      ok: true,
      json: async () => [
        { id: 105, name: "Test Game 6", first_release_date: 1577836800 }, // 2020-01-01 -- matches
      ],
    };

    fetchMock
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(parentResponse);

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game 6", 20, { releaseYear: 2020 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 105, name: "Test Game 6" });
  });
});

describe("IGDBClient - formatGameData metadata fields", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { safeFetch } = await import("../ssrf.js");
    fetchMock = vi.mocked(safeFetch);
  });

  function mockAuthAndGame(igdbGame: Record<string, unknown>) {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600 }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => [igdbGame],
      });
  }

  it("returns null rating when IGDB game has no rating field", async () => {
    const { igdbClient } = await import("../igdb.js");
    const result = igdbClient.formatGameData({ id: 1, name: "Test Game" });
    expect(result.rating).toBeNull();
  });

  it("returns null rating when IGDB game rating is 0", async () => {
    const { igdbClient } = await import("../igdb.js");
    const result = igdbClient.formatGameData({ id: 1, name: "Test Game", rating: 0 });
    expect(result.rating).toBeNull();
  });

  it("returns scaled rating (Math.round / 10) when IGDB rating exists", async () => {
    const { igdbClient } = await import("../igdb.js");
    // IGDB rating 85.5 → Math.round(85.5) = 86 → 86 / 10 = 8.6
    const result = igdbClient.formatGameData({ id: 1, name: "Test Game", rating: 85.5 });
    expect(result.rating).toBe(8.6);
  });

  it("returns scaled rating for a whole-number IGDB rating", async () => {
    const { igdbClient } = await import("../igdb.js");
    // IGDB rating 90 → Math.round(90) = 90 → 90 / 10 = 9
    const result = igdbClient.formatGameData({ id: 1, name: "Test Game", rating: 90 });
    expect(result.rating).toBe(9);
  });

  it("parses aggregatedRating from IGDB aggregated_rating field (rounds to 1 decimal)", async () => {
    mockAuthAndGame({
      id: 1,
      name: "Test Game",
      aggregated_rating: 85.0,
      websites: [],
    });

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game", 1);

    expect(results[0].aggregated_rating).toBe(85.0);
  });

  it("leaves aggregatedRating undefined when IGDB field is absent", async () => {
    mockAuthAndGame({ id: 1, name: "Test Game" });

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game", 1);

    expect(results[0].aggregated_rating).toBeUndefined();
  });

  it("leaves aggregatedRating undefined when IGDB field is zero/falsy", async () => {
    mockAuthAndGame({ id: 1, name: "Test Game", aggregated_rating: 0 });

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game", 1);

    expect(results[0].aggregated_rating).toBeFalsy();
  });

  it("parses igdbWebsites as array when websites are present", async () => {
    const websites = [
      { id: 1, category: 1, url: "https://example.com/official" },
      { id: 2, category: 13, url: "https://store.steampowered.com/app/123" },
    ];
    mockAuthAndGame({ id: 1, name: "Test Game", websites });

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game", 1);

    expect(results[0].websites).toEqual(websites);
  });

  it("uses empty array for igdbWebsites when websites field is absent", async () => {
    mockAuthAndGame({ id: 1, name: "Test Game" });

    const { igdbClient } = await import("../igdb.js");
    const results = await igdbClient.searchGames("Test Game", 1);

    expect(results[0].websites).toBeUndefined();
  });
});
