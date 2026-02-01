import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the config module before importing igdb
vi.mock("../config.js", () => ({
  config: {
    database: {
      url: "postgresql://test:test@localhost/test",
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

// Mock the IGDBClient by testing the fallback behavior
describe("IGDBClient - Fallback Mechanism", { timeout: 20000 }, () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks and modules before each test to ensure fresh IGDBClient instance
    vi.clearAllMocks();
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
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
    }

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
        json: async () => [{ id: 4, name: "Switch Game", platforms: [{ name: "Nintendo Switch" }] }],
      };
      fetchMock.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(successResponse);

      const { igdbClient } = await import("../igdb.js");
      const results = await igdbClient.getGamesByPlatform("Switch");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Switch Game");
    });
  });
});
