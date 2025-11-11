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

describe('DownloaderManager - Priority-based Fallback', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('should use first downloader when it succeeds', async () => {
    const downloader1: Downloader = {
      id: 'downloader-1',
      name: 'Primary Downloader',
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

    const downloader2: Downloader = {
      id: 'downloader-2',
      name: 'Fallback Downloader',
      type: 'transmission',
      url: 'http://localhost:9092/transmission/rpc',
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: 'games',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock successful response for first downloader
    const headers = new Headers();
    headers.set('X-Transmission-Session-Id', 'session-123');
    const response409 = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers,
      json: async () => ({}),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        arguments: {
          'torrent-added': {
            id: 100,
            name: 'Test Game.torrent',
          },
        },
        result: 'success',
      }),
    };

    fetchMock
      .mockResolvedValueOnce(response409)
      .mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import('../downloaders.js');

    const result = await DownloaderManager.addTorrentWithFallback(
      [downloader1, downloader2],
      {
        url: 'magnet:?xt=urn:btih:test123',
        title: 'Test Game',
      }
    );

    expect(result.success).toBe(true);
    expect(result.downloaderId).toBe('downloader-1');
    expect(result.downloaderName).toBe('Primary Downloader');
    expect(result.attemptedDownloaders).toEqual(['Primary Downloader']);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Only called for first downloader (409 + retry)
  });

  it('should fallback to second downloader when first fails', async () => {
    const downloader1: Downloader = {
      id: 'downloader-1',
      name: 'Primary Downloader',
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

    const downloader2: Downloader = {
      id: 'downloader-2',
      name: 'Fallback Downloader',
      type: 'transmission',
      url: 'http://localhost:9092/transmission/rpc',
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: 'games',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock error response for first downloader
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: async () => ({}),
    };

    // Mock successful response for second downloader
    const headers = new Headers();
    headers.set('X-Transmission-Session-Id', 'session-456');
    const response409 = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers,
      json: async () => ({}),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        arguments: {
          'torrent-added': {
            id: 200,
            name: 'Test Game.torrent',
          },
        },
        result: 'success',
      }),
    };

    fetchMock
      .mockResolvedValueOnce(errorResponse) // First downloader fails
      .mockResolvedValueOnce(response409)   // Second downloader 409
      .mockResolvedValueOnce(successResponse); // Second downloader success

    const { DownloaderManager } = await import('../downloaders.js');

    const result = await DownloaderManager.addTorrentWithFallback(
      [downloader1, downloader2],
      {
        url: 'magnet:?xt=urn:btih:test123',
        title: 'Test Game',
      }
    );

    expect(result.success).toBe(true);
    expect(result.downloaderId).toBe('downloader-2');
    expect(result.downloaderName).toBe('Fallback Downloader');
    expect(result.attemptedDownloaders).toEqual(['Primary Downloader', 'Fallback Downloader']);
  });

  it('should return error when all downloaders fail', async () => {
    const downloader1: Downloader = {
      id: 'downloader-1',
      name: 'Primary Downloader',
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

    const downloader2: Downloader = {
      id: 'downloader-2',
      name: 'Fallback Downloader',
      type: 'transmission',
      url: 'http://localhost:9092/transmission/rpc',
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: 'games',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock error responses for both downloaders
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: async () => ({}),
    };

    fetchMock
      .mockResolvedValueOnce(errorResponse) // First downloader fails
      .mockResolvedValueOnce(errorResponse); // Second downloader fails

    const { DownloaderManager } = await import('../downloaders.js');

    const result = await DownloaderManager.addTorrentWithFallback(
      [downloader1, downloader2],
      {
        url: 'magnet:?xt=urn:btih:test123',
        title: 'Test Game',
      }
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('All downloaders failed');
    expect(result.attemptedDownloaders).toEqual(['Primary Downloader', 'Fallback Downloader']);
  });

  it('should return error when no downloaders are provided', async () => {
    const { DownloaderManager } = await import('../downloaders.js');

    const result = await DownloaderManager.addTorrentWithFallback(
      [],
      {
        url: 'magnet:?xt=urn:btih:test123',
        title: 'Test Game',
      }
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('No downloaders available');
    expect(result.attemptedDownloaders).toEqual([]);
  });

  it('should handle downloader returning duplicate error and fallback to next', async () => {
    const downloader1: Downloader = {
      id: 'downloader-1',
      name: 'Primary Downloader',
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

    const downloader2: Downloader = {
      id: 'downloader-2',
      name: 'Fallback Downloader',
      type: 'transmission',
      url: 'http://localhost:9092/transmission/rpc',
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: 'games',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock duplicate response for first downloader
    const headers1 = new Headers();
    headers1.set('X-Transmission-Session-Id', 'session-123');
    const response409_1 = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: headers1,
      json: async () => ({}),
    };

    const duplicateResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        arguments: {
          'torrent-duplicate': {
            id: 100,
            name: 'Test Game.torrent',
          },
        },
        result: 'success',
      }),
    };

    // Mock successful response for second downloader
    const headers2 = new Headers();
    headers2.set('X-Transmission-Session-Id', 'session-456');
    const response409_2 = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: headers2,
      json: async () => ({}),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => ({
        arguments: {
          'torrent-added': {
            id: 200,
            name: 'Test Game.torrent',
          },
        },
        result: 'success',
      }),
    };

    fetchMock
      .mockResolvedValueOnce(response409_1)    // First downloader 409
      .mockResolvedValueOnce(duplicateResponse) // First downloader duplicate
      .mockResolvedValueOnce(response409_2)     // Second downloader 409
      .mockResolvedValueOnce(successResponse);   // Second downloader success

    const { DownloaderManager } = await import('../downloaders.js');

    const result = await DownloaderManager.addTorrentWithFallback(
      [downloader1, downloader2],
      {
        url: 'magnet:?xt=urn:btih:test123',
        title: 'Test Game',
      }
    );

    expect(result.success).toBe(true);
    expect(result.downloaderId).toBe('downloader-2');
    expect(result.downloaderName).toBe('Fallback Downloader');
    expect(result.attemptedDownloaders).toEqual(['Primary Downloader', 'Fallback Downloader']);
  });
});

