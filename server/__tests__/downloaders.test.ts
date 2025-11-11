import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Downloader } from '@shared/schema';

describe('TransmissionClient - 409 Retry Mechanism', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('should retry request with session ID when receiving 409 status', async () => {
    // Create a test downloader configuration
    const testDownloader: Downloader = {
      id: 'test-id',
      name: 'Test Transmission',
      type: 'transmission',
      url: 'http://localhost:9091/transmission/rpc',
      username: 'admin',
      password: 'password',
      enabled: true,
      priority: 1,
      downloadPath: '/downloads',
      category: 'games',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock the first response with 409 status and session ID header
    const firstResponse = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: new Map([['X-Transmission-Session-Id', 'test-session-id-12345']]),
      json: async () => ({}),
    };

    // Create a proper Headers object for the first response
    const headers409 = new Headers();
    headers409.set('X-Transmission-Session-Id', 'test-session-id-12345');
    const response409 = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: headers409,
      json: async () => ({}),
    };

    // Mock the second response after retry with session ID
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        arguments: {
          'torrent-added': {
            id: 42,
            name: 'Test Game.torrent',
          },
        },
        result: 'success',
      }),
    };

    // Setup fetch mock to return 409 first, then success
    fetchMock
      .mockResolvedValueOnce(response409) // First call - 409 with session ID
      .mockResolvedValueOnce(successResponse); // Retry - success

    // Import the DownloaderManager
    const { DownloaderManager } = await import('../downloaders.js');

    // Test adding a torrent
    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: 'magnet:?xt=urn:btih:test123',
      title: 'Test Game',
    });

    // Verify that fetch was called twice (initial + retry)
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify both calls were made to the correct URL (with trailing slash added by client)
    const firstCall = fetchMock.mock.calls[0];
    const secondCall = fetchMock.mock.calls[1];
    
    expect(firstCall[0]).toBe('http://localhost:9091/transmission/rpc/');
    expect(secondCall[0]).toBe('http://localhost:9091/transmission/rpc/');

    // Verify the second call (retry) includes the session ID header
    const secondCallHeaders = secondCall[1].headers;
    expect(secondCallHeaders['X-Transmission-Session-Id']).toBe('test-session-id-12345');

    // Verify the operation succeeded
    expect(result.success).toBe(true);
    expect(result.id).toBe('42');
    expect(result.message).toBe('Torrent added successfully');
  });

  it('should handle 409 response when testing connection', async () => {
    // Create a test downloader configuration
    const testDownloader: Downloader = {
      id: 'test-id',
      name: 'Test Transmission',
      type: 'transmission',
      url: 'http://localhost:9091/transmission/rpc',
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: 'games',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock 409 response with session ID
    const headers409 = new Headers();
    headers409.set('X-Transmission-Session-Id', 'session-abc-123');
    const response409 = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: headers409,
      json: async () => ({}),
    };

    // Mock successful response after retry
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        arguments: {
          version: '3.00',
        },
        result: 'success',
      }),
    };

    // Setup fetch mock
    fetchMock
      .mockResolvedValueOnce(response409)
      .mockResolvedValueOnce(successResponse);

    // Import the DownloaderManager
    const { DownloaderManager } = await import('../downloaders.js');

    // Test connection
    const result = await DownloaderManager.testDownloader(testDownloader);

    // Verify that fetch was called twice
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify the connection test succeeded
    expect(result.success).toBe(true);
    expect(result.message).toBe('Connected successfully to Transmission');
  });
});
