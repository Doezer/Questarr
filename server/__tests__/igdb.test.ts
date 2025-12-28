import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config module before importing igdb
vi.mock('../config.js', () => ({
  config: {
    database: {
      url: 'postgresql://test:test@localhost/test',
    },
    igdb: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      isConfigured: true,
    },
    server: {
      port: 5000,
      host: 'localhost',
      nodeEnv: 'test',
      isDevelopment: false,
      isProduction: false,
      isTest: true,
    },
  },
}));

// Mock the IGDBClient by testing the fallback behavior
describe('IGDBClient - Fallback Mechanism', () => {
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
    return mockCalls.filter(call => 
      typeof call[0] === 'string' && call[0].includes('api.igdb.com/v4/games')
    ).length;
  }

  it('should try multiple search approaches when first approach returns no results', async () => {
    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'bearer',
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
          name: 'Test Game',
          summary: 'A test game',
          cover: {
            id: 123,
            url: '//images.igdb.com/igdb/image/upload/t_thumb/test.jpg',
          },
          first_release_date: 1609459200,
          rating: 85.5,
          platforms: [{ id: 1, name: 'PC (Microsoft Windows)' }],
          genres: [{ id: 1, name: 'Action' }],
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
    const { igdbClient } = await import('../igdb.js');

    // Test the searchGames method
    const results = await igdbClient.searchGames('test query', 20);

    // Verify that fetch was called multiple times (auth + search attempts)
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify the results contain the expected game
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Game');
    expect(results[0].rating).toBe(85.5);
  });

  it('should return empty array when all search approaches fail', async () => {
    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'bearer',
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
    const { igdbClient } = await import('../igdb.js');

    // Test the searchGames method
    const results = await igdbClient.searchGames('nonexistent game xyz', 20);

    // Verify that fetch was called multiple times
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    // Verify the results are empty
    expect(results).toHaveLength(0);
  });

  it('should cap total search attempts at MAX_SEARCH_ATTEMPTS (5)', async () => {
    // Mock environment variables
    process.env.IGDB_CLIENT_ID = 'test-client-id';
    process.env.IGDB_CLIENT_SECRET = 'test-client-secret';

    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'bearer',
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
    const { igdbClient } = await import('../igdb.js');

    // Use a query with many words to verify the cap works
    // Without the cap, this would try: 4 approaches + 6 word searches = 10 attempts
    const results = await igdbClient.searchGames('word one two three four five six', 20);

    // Count only IGDB API search calls (excluding auth calls to Twitch)
    const igdbSearchCalls = countIgdbSearchCalls(fetchMock.mock.calls);
    
    // Verify exactly 5 search attempts were made (the MAX_SEARCH_ATTEMPTS cap)
    expect(igdbSearchCalls).toBe(5);

    // Verify the results are empty
    expect(results).toHaveLength(0);
  });

  it('should cache search results to avoid redundant API calls', async () => {
    // Mock authentication response
    const authResponse = {
      ok: true,
      json: async () => ({
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    };

    // Mock a successful search response
    const successResponse = {
      ok: true,
      json: async () => [{ id: 1, name: 'Cached Game' }],
    };

    // Setup fetch mock
    fetchMock
      .mockResolvedValueOnce(authResponse) // Auth call for the first search
      .mockResolvedValueOnce(successResponse); // The actual search call

    // Import the IGDBClient
    const { igdbClient } = await import('../igdb.js');

    // First call - should hit the API
    const firstResults = await igdbClient.searchGames('cached-query');
    expect(firstResults).toHaveLength(1);
    expect(firstResults[0].name).toBe('Cached Game');

    // Verify fetch was called for auth and for the search
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const igdbSearchCallsAfterFirst = countIgdbSearchCalls(fetchMock.mock.calls);
    expect(igdbSearchCallsAfterFirst).toBe(1);

    // Second call - should hit the cache
    const secondResults = await igdbClient.searchGames('cached-query');
    expect(secondResults).toEqual(firstResults);

    // Verify fetch was NOT called again for the search
    const igdbSearchCallsAfterSecond = countIgdbSearchCalls(fetchMock.mock.calls);
    expect(igdbSearchCallsAfterSecond).toBe(1); // Should still be 1
  });
});
