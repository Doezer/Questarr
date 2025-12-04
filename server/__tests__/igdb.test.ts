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
    // Reset mocks before each test
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

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
});
