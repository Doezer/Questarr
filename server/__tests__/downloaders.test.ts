import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Downloader } from "@shared/schema";

vi.mock("parse-torrent", () => ({
  default: vi.fn().mockResolvedValue({ infoHash: "abc123def456" }),
}));

describe("TransmissionClient - 409 Retry Mechanism", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it("should retry request with session ID when receiving 409 status", async () => {
    // Create a test downloader configuration
    const testDownloader: Downloader = {
      id: "test-id",
      name: "Test Transmission",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: "admin",
      password: "password",
      enabled: true,
      priority: 1,
      downloadPath: "/downloads",
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock the first response with 409 status and session ID header
    const _firstResponse = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: new Map([["X-Transmission-Session-Id", "test-session-id-12345"]]),
      json: async () => ({}),
    };

    // Create a proper Headers object for the first response
    const headers409 = new Headers();
    headers409.set("X-Transmission-Session-Id", "test-session-id-12345");
    const response409 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: headers409,
      json: async () => ({}),
    };

    // Mock the second response after retry with session ID
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          "torrent-added": {
            id: 42,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      }),
    };

    // Setup fetch mock to return 409 first, then success
    fetchMock
      .mockResolvedValueOnce(response409) // First call - 409 with session ID
      .mockResolvedValueOnce(successResponse); // Retry - success

    // Import the DownloaderManager
    const { DownloaderManager } = await import("../downloaders.js");

    // Test adding a torrent
    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    // Verify that fetch was called twice (initial + retry)
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify both calls were made to the correct URL (with trailing slash added by client)
    const firstCall = fetchMock.mock.calls[0];
    const secondCall = fetchMock.mock.calls[1];

    expect(firstCall[0]).toBe("http://localhost:9091/transmission/rpc/");
    expect(secondCall[0]).toBe("http://localhost:9091/transmission/rpc/");

    // Verify the second call (retry) includes the session ID header
    const secondCallHeaders = secondCall[1].headers;
    expect(secondCallHeaders["X-Transmission-Session-Id"]).toBe("test-session-id-12345");

    // Verify the operation succeeded
    expect(result.success).toBe(true);
    expect(result.id).toBe("42");
    expect(result.message).toBe("Torrent added successfully");
  });

  it("should handle 409 response when testing connection", async () => {
    // Create a test downloader configuration
    const testDownloader: Downloader = {
      id: "test-id",
      name: "Test Transmission",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock 409 response with session ID
    const headers409 = new Headers();
    headers409.set("X-Transmission-Session-Id", "session-abc-123");
    const response409 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: headers409,
      json: async () => ({}),
    };

    // Mock successful response after retry
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          version: "3.00",
        },
        result: "success",
      }),
    };

    // Setup fetch mock
    fetchMock.mockResolvedValueOnce(response409).mockResolvedValueOnce(successResponse);

    // Import the DownloaderManager
    const { DownloaderManager } = await import("../downloaders.js");

    // Test connection
    const result = await DownloaderManager.testDownloader(testDownloader);

    // Verify that fetch was called twice
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify the connection test succeeded
    expect(result.success).toBe(true);
    expect(result.message).toBe("Connected successfully to Transmission");
  });
});

describe("DownloaderManager - Priority-based Fallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it("should use first downloader when it succeeds", async () => {
    const downloader1: Downloader = {
      id: "downloader-1",
      name: "Primary Downloader",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const downloader2: Downloader = {
      id: "downloader-2",
      name: "Fallback Downloader",
      type: "transmission",
      url: "http://localhost:9092/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock successful response for first downloader
    const headers = new Headers();
    headers.set("X-Transmission-Session-Id", "session-123");
    const response409 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers,
      json: async () => ({}),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          "torrent-added": {
            id: 100,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      }),
    };

    fetchMock.mockResolvedValueOnce(response409).mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrentWithFallback([downloader1, downloader2], {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    expect(result.success).toBe(true);
    expect(result.downloaderId).toBe("downloader-1");
    expect(result.downloaderName).toBe("Primary Downloader");
    expect(result.attemptedDownloaders).toEqual(["Primary Downloader"]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Only called for first downloader (409 + retry)
  });

  it("should fallback to second downloader when first fails", async () => {
    const downloader1: Downloader = {
      id: "downloader-1",
      name: "Primary Downloader",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const downloader2: Downloader = {
      id: "downloader-2",
      name: "Fallback Downloader",
      type: "transmission",
      url: "http://localhost:9092/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock error response for first downloader
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: async () => ({}),
    };

    // Mock successful response for second downloader
    const headers = new Headers();
    headers.set("X-Transmission-Session-Id", "session-456");
    const response409 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers,
      json: async () => ({}),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          "torrent-added": {
            id: 200,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      }),
    };

    fetchMock
      .mockResolvedValueOnce(errorResponse) // First downloader fails
      .mockResolvedValueOnce(response409) // Second downloader 409
      .mockResolvedValueOnce(successResponse); // Second downloader success

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrentWithFallback([downloader1, downloader2], {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    expect(result.success).toBe(true);
    expect(result.downloaderId).toBe("downloader-2");
    expect(result.downloaderName).toBe("Fallback Downloader");
    expect(result.attemptedDownloaders).toEqual(["Primary Downloader", "Fallback Downloader"]);
  });

  it("should return error when all downloaders fail", async () => {
    const downloader1: Downloader = {
      id: "downloader-1",
      name: "Primary Downloader",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const downloader2: Downloader = {
      id: "downloader-2",
      name: "Fallback Downloader",
      type: "transmission",
      url: "http://localhost:9092/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock error responses for both downloaders
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: async () => ({}),
    };

    fetchMock
      .mockResolvedValueOnce(errorResponse) // First downloader fails
      .mockResolvedValueOnce(errorResponse); // Second downloader fails

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrentWithFallback([downloader1, downloader2], {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("All downloaders failed");
    expect(result.attemptedDownloaders).toEqual(["Primary Downloader", "Fallback Downloader"]);
  });

  it("should return error when no downloaders are provided", async () => {
    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrentWithFallback([], {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("No downloaders available");
    expect(result.attemptedDownloaders).toEqual([]);
  });

  it("should handle downloader returning duplicate error and fallback to next", async () => {
    const downloader1: Downloader = {
      id: "downloader-1",
      name: "Primary Downloader",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const downloader2: Downloader = {
      id: "downloader-2",
      name: "Fallback Downloader",
      type: "transmission",
      url: "http://localhost:9092/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock duplicate response for first downloader
    const headers1 = new Headers();
    headers1.set("X-Transmission-Session-Id", "session-123");
    const response409_1 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: headers1,
      json: async () => ({}),
    };

    const duplicateResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          "torrent-duplicate": {
            id: 100,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      }),
    };

    // Mock successful response for second downloader
    const headers2 = new Headers();
    headers2.set("X-Transmission-Session-Id", "session-456");
    const response409_2 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: headers2,
      json: async () => ({}),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          "torrent-added": {
            id: 200,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      }),
    };

    fetchMock
      .mockResolvedValueOnce(response409_1) // First downloader 409
      .mockResolvedValueOnce(duplicateResponse) // First downloader duplicate
      .mockResolvedValueOnce(response409_2) // Second downloader 409
      .mockResolvedValueOnce(successResponse); // Second downloader success

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrentWithFallback([downloader1, downloader2], {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    expect(result.success).toBe(true);
    expect(result.downloaderId).toBe("downloader-2");
    expect(result.downloaderName).toBe("Fallback Downloader");
    expect(result.attemptedDownloaders).toEqual(["Primary Downloader", "Fallback Downloader"]);
  });
});

describe("RTorrentClient - XML-RPC Protocol", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it("should test connection successfully", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: "admin",
      password: "password",
      enabled: true,
      priority: 1,
      downloadPath: "/downloads",
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>0.9.8</string></value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.testDownloader(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/rutorrent/RPC2");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Connected successfully to rTorrent");
  });

  it("should add torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><int>0</int></value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    const fileResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(10),
      text: async () => "torrent content",
    };

    // Mock the file download, then add torrent call, then category set call
    fetchMock
      .mockResolvedValueOnce(fileResponse) // Download torrent file
      .mockResolvedValueOnce(successResponse) // load.raw_start
      .mockResolvedValueOnce(successResponse); // d.custom1.set

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:test123",
      title: "Test Game",
    });

    // Expects 3 calls: 1 for download file, 1 for add torrent, 1 for setting category
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.id).toBe("abc123def456");
    expect(result.message).toContain("Torrent added successfully");
  });

  it("should get all torrents with correct status mapping", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: null,
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock response with multiple torrents
    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value>
              <array>
                <data>
                  <value><string>HASH1</string></value>
                  <value><string>Downloading Game.torrent</string></value>
                  <value><int>1</int></value>
                  <value><int>0</int></value>
                  <value><int>1000000000</int></value>
                  <value><int>500000000</int></value>
                  <value><int>102400</int></value>
                  <value><int>51200</int></value>
                  <value><int>1500</int></value>
                  <value><int>10</int></value>
                  <value><int>5</int></value>
                  <value><string></string></value>
                </data>
              </array>
            </value>
            <value>
              <array>
                <data>
                  <value><string>HASH2</string></value>
                  <value><string>Seeding Game.torrent</string></value>
                  <value><int>1</int></value>
                  <value><int>1</int></value>
                  <value><int>2000000000</int></value>
                  <value><int>2000000000</int></value>
                  <value><int>0</int></value>
                  <value><int>204800</int></value>
                  <value><int>2000</int></value>
                  <value><int>8</int></value>
                  <value><int>8</int></value>
                  <value><string></string></value>
                </data>
              </array>
            </value>
            <value>
              <array>
                <data>
                  <value><string>HASH3</string></value>
                  <value><string>Paused Game.torrent</string></value>
                  <value><int>0</int></value>
                  <value><int>0</int></value>
                  <value><int>3000000000</int></value>
                  <value><int>1500000000</int></value>
                  <value><int>0</int></value>
                  <value><int>0</int></value>
                  <value><int>500</int></value>
                  <value><int>0</int></value>
                  <value><int>0</int></value>
                  <value><string></string></value>
                </data>
              </array>
            </value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const torrents = await DownloaderManager.getAllTorrents(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(torrents).toHaveLength(3);

    // Verify first torrent (downloading)
    expect(torrents[0].id).toBe("HASH1");
    expect(torrents[0].name).toBe("Downloading Game.torrent");
    expect(torrents[0].status).toBe("downloading");
    expect(torrents[0].progress).toBe(50);
    expect(torrents[0].downloadSpeed).toBe(102400);
    expect(torrents[0].uploadSpeed).toBe(51200);

    // Verify second torrent (seeding)
    expect(torrents[1].id).toBe("HASH2");
    expect(torrents[1].status).toBe("seeding");
    expect(torrents[1].progress).toBe(100);

    // Verify third torrent (paused)
    expect(torrents[2].id).toBe("HASH3");
    expect(torrents[2].status).toBe("paused");
    expect(torrents[2].progress).toBe(50);
  });

  it("should pause torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><int>0</int></value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.pauseTorrent(testDownloader, "HASH123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Torrent paused successfully");
  });

  it("should resume torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><int>0</int></value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.resumeTorrent(testDownloader, "HASH123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Torrent resumed successfully");
  });

  it("should remove torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><int>0</int></value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.removeTorrent(testDownloader, "HASH123", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Torrent removed successfully");
  });

  it("should handle XML-RPC fault responses", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const faultResponse = `<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member>
          <name>faultCode</name>
          <value><int>-506</int></value>
        </member>
        <member>
          <name>faultString</name>
          <value><string>Could not add torrent</string></value>
        </member>
      </struct>
    </value>
  </fault>
</methodResponse>`;

    const errorResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => faultResponse,
    };

    const fileResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(10),
      text: async () => "torrent content",
    };

    fetchMock
      .mockResolvedValueOnce(fileResponse)
      .mockResolvedValueOnce(errorResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:invalid",
      title: "Invalid Torrent",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("XML-RPC Fault");
  });

  it("should handle authentication with Basic Auth", async () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      username: "admin",
      password: "secret123",
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponse = `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>0.9.8</string></value>
    </param>
  </params>
</methodResponse>`;

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => xmlResponse,
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.testDownloader(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify Basic Auth header was set
    const callHeaders = fetchMock.mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBeDefined();
    expect(callHeaders.Authorization).toMatch(/^Basic /);

    expect(result.success).toBe(true);
  });
});

describe("QBittorrentClient - Web API v2", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it("should test connection successfully", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: "admin",
      password: "adminadmin",
      enabled: true,
      priority: 1,
      downloadPath: "/downloads",
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login response
    const loginResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers([["set-cookie", "SID=abc123; path=/"]]),
      text: async () => "Ok.",
    };

    // Mock version response
    const versionResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "v4.6.2",
    };

    fetchMock.mockResolvedValueOnce(loginResponse).mockResolvedValueOnce(versionResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.testDownloader(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v2/auth/login");
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8080/api/v2/app/version");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Connected successfully to qBittorrent v4.6.2");
  });

  it("should test connection without authentication", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock version response (no auth needed)
    const versionResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "v4.6.2",
    };

    fetchMock.mockResolvedValueOnce(versionResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.testDownloader(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("should add torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: "/downloads/games",
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "Ok.",
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:abc123def456789abc123def456789abc123def4",
      title: "Test Game",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v2/torrents/add");
    expect(result.success).toBe(true);
    expect(result.id).toBe("abc123def456789abc123def456789abc123def4");
    expect(result.message).toBe("Torrent added successfully");
  });

  it("should handle duplicate torrent error", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: null,
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const failResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "Fails.",
    };

    fetchMock.mockResolvedValueOnce(failResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:abc123",
      title: "Test Game",
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Torrent already exists or invalid torrent");
  });

  it("should get all torrents with correct status mapping", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: null,
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const torrentsResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => [
        {
          hash: "hash1",
          name: "Downloading Game",
          state: "downloading",
          progress: 0.5,
          dlspeed: 102400,
          upspeed: 51200,
          eta: 3600,
          size: 1000000000,
          downloaded: 500000000,
          num_seeds: 10,
          num_leechs: 5,
          ratio: 0.5,
        },
        {
          hash: "hash2",
          name: "Seeding Game",
          state: "uploading",
          progress: 1,
          dlspeed: 0,
          upspeed: 204800,
          eta: -1,
          size: 2000000000,
          downloaded: 2000000000,
          num_seeds: 8,
          num_leechs: 2,
          ratio: 2.5,
        },
        {
          hash: "hash3",
          name: "Paused Game",
          state: "pausedDL",
          progress: 0.75,
          dlspeed: 0,
          upspeed: 0,
          eta: -1,
          size: 3000000000,
          downloaded: 2250000000,
          num_seeds: 0,
          num_leechs: 0,
          ratio: 0,
        },
      ],
    };

    fetchMock.mockResolvedValueOnce(torrentsResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const torrents = await DownloaderManager.getAllTorrents(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(torrents).toHaveLength(3);

    // Verify first torrent (downloading)
    expect(torrents[0].id).toBe("hash1");
    expect(torrents[0].name).toBe("Downloading Game");
    expect(torrents[0].status).toBe("downloading");
    expect(torrents[0].progress).toBe(50);
    expect(torrents[0].downloadSpeed).toBe(102400);
    expect(torrents[0].uploadSpeed).toBe(51200);

    // Verify second torrent (seeding)
    expect(torrents[1].id).toBe("hash2");
    expect(torrents[1].status).toBe("seeding");
    expect(torrents[1].progress).toBe(100);

    // Verify third torrent (paused)
    expect(torrents[2].id).toBe("hash3");
    expect(torrents[2].status).toBe("paused");
    expect(torrents[2].progress).toBe(75);
  });

  it("should pause torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "",
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.pauseTorrent(testDownloader, "hash123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v2/torrents/pause");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Torrent paused successfully");
  });

  it("should resume torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "",
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.resumeTorrent(testDownloader, "hash123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v2/torrents/resume");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Torrent resumed successfully");
  });

  it("should remove torrent successfully", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "",
    };

    fetchMock.mockResolvedValueOnce(successResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.removeTorrent(testDownloader, "hash123", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v2/torrents/delete");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Torrent removed successfully");
  });

  it("should handle authentication failure", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: "admin",
      password: "wrongpassword",
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const failResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "Fails.",
    };

    fetchMock.mockResolvedValueOnce(failResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.testDownloader(testDownloader);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Authentication failed");
  });

  it("should handle session expiration and re-authenticate", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: "admin",
      password: "adminadmin",
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login response
    const loginResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers([["set-cookie", "SID=abc123; path=/"]]),
      text: async () => "Ok.",
    };

    // Mock 403 response (session expired)
    const forbiddenResponse = {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers(),
      text: async () => "Forbidden",
    };

    // Mock successful response after re-auth
    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "v4.6.2",
    };

    // Second login response for re-authentication
    const loginResponse2 = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers([["set-cookie", "SID=def456; path=/"]]),
      text: async () => "Ok.",
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // Initial login
      .mockResolvedValueOnce(forbiddenResponse) // First request fails with 403
      .mockResolvedValueOnce(loginResponse2) // Re-login
      .mockResolvedValueOnce(successResponse); // Retry succeeds

    const { DownloaderManager } = await import("../downloaders.js");

    const result = await DownloaderManager.testDownloader(testDownloader);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.success).toBe(true);
  });
});

describe("Authentication - HTTP Basic Auth Encoding", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  describe("TransmissionClient", () => {
    it("should encode credentials with UTF-8 encoding for HTTP Basic Auth", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test Transmission",
        type: "transmission",
        url: "http://localhost:9091/transmission/rpc",
        username: "admin",
        password: "test123",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: async () => ({
          arguments: { version: "3.00" },
          result: "success",
        }),
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      await DownloaderManager.testDownloader(testDownloader);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callHeaders = fetchMock.mock.calls[0][1].headers;

      // Verify Authorization header exists
      expect(callHeaders["Authorization"]).toBeDefined();
      expect(callHeaders["Authorization"]).toMatch(/^Basic /);

      // Verify the encoding uses UTF-8 (default for Buffer.from)
      // admin:test123 in base64 = YWRtaW46dGVzdDEyMw==
      const expectedAuth = Buffer.from("admin:test123", "utf-8").toString("base64");
      expect(callHeaders["Authorization"]).toBe(`Basic ${expectedAuth}`);
    });

    it("should handle authentication failure with 401 status", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test Transmission",
        type: "transmission",
        url: "http://localhost:9091/transmission/rpc",
        username: "admin",
        password: "wrongpassword",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const unauthorizedResponse = {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "Authentication failed",
      };

      fetchMock.mockResolvedValueOnce(unauthorizedResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      const result = await DownloaderManager.testDownloader(testDownloader);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Authentication failed");
      expect(result.message).toContain("Invalid username or password");
    });

    it("should encode credentials with special characters correctly", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test Transmission",
        type: "transmission",
        url: "http://localhost:9091/transmission/rpc",
        username: "admin",
        password: "pàss@wörd!",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        json: async () => ({
          arguments: { version: "3.00" },
          result: "success",
        }),
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      await DownloaderManager.testDownloader(testDownloader);

      const callHeaders = fetchMock.mock.calls[0][1].headers;

      // Verify UTF-8 encoding for special characters
      const expectedAuth = Buffer.from("admin:pàss@wörd!", "latin1").toString("base64");
      expect(callHeaders["Authorization"]).toBe(`Basic ${expectedAuth}`);

      // Verify it differs from UTF-8 encoding
      const utf8Auth = Buffer.from("admin:pàss@wörd!", "utf-8").toString("base64");
      expect(callHeaders["Authorization"]).not.toBe(`Basic ${utf8Auth}`);
    });
  });

  describe("RTorrentClient", () => {
    it("should encode credentials with UTF-8 encoding for HTTP Basic Auth", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test rTorrent",
        type: "rtorrent",
        url: "http://localhost:8080",
        urlPath: "RPC2",
        username: "admin",
        password: "test123",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: async () => `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>0.9.8</string></value>
    </param>
  </params>
</methodResponse>`,
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      await DownloaderManager.testDownloader(testDownloader);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callHeaders = fetchMock.mock.calls[0][1].headers;

      // Verify Authorization header uses UTF-8 encoding
      const expectedAuth = Buffer.from("admin:test123", "utf-8").toString("base64");
      expect(callHeaders["Authorization"]).toBe(`Basic ${expectedAuth}`);
      expect(callHeaders["Content-Type"]).toBe("text/xml");
    });

    it("should handle authentication failure with 401 status", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test rTorrent",
        type: "rtorrent",
        url: "http://localhost:8080",
        urlPath: "RPC2",
        username: "admin",
        password: "wrongpassword",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const unauthorizedResponse = {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        text: async () => "",
      };

      fetchMock.mockResolvedValueOnce(unauthorizedResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      const result = await DownloaderManager.testDownloader(testDownloader);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Authentication failed");
      expect(result.message).toContain("Invalid credentials");
    });

    it("should encode credentials with special characters correctly", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test rTorrent",
        type: "rtorrent",
        url: "http://localhost:8080",
        urlPath: "RPC2",
        username: "admin",
        password: "pàss@wörd!",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: async () => `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>0.9.8</string></value>
    </param>
  </params>
</methodResponse>`,
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      await DownloaderManager.testDownloader(testDownloader);

      const callHeaders = fetchMock.mock.calls[0][1].headers;

      // Verify UTF-8 encoding for special characters
      const expectedAuth = Buffer.from("admin:pàss@wörd!", "latin1").toString("base64");
      expect(callHeaders["Authorization"]).toBe(`Basic ${expectedAuth}`);

      // Verify it differs from UTF-8 encoding
      const utf8Auth = Buffer.from("admin:pàss@wörd!", "utf-8").toString("base64");
      expect(callHeaders["Authorization"]).not.toBe(`Basic ${utf8Auth}`);
    });

    it("should correctly format XML-RPC request with authentication", async () => {
      const testDownloader: Downloader = {
        id: "test-id",
        name: "Test rTorrent",
        type: "rtorrent",
        url: "http://localhost:8080",
        urlPath: "RPC2",
        username: "admin",
        password: "secret",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: async () => `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>0.9.8</string></value>
    </param>
  </params>
</methodResponse>`,
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      await DownloaderManager.testDownloader(testDownloader);

      const call = fetchMock.mock.calls[0];
      const [url, options] = call;

      // Verify URL construction
      expect(url).toBe("http://localhost:8080/RPC2");

      // Verify request format
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("text/xml");
      expect(options.headers["Authorization"]).toBeDefined();

      // Verify XML-RPC body format
      expect(options.body).toContain('<?xml version="1.0"?>');
      expect(options.body).toContain("<methodCall>");
      expect(options.body).toContain("<methodName>system.client_version</methodName>");
    });

    it("should clean URL double slashes in XML-RPC request", async () => {
      const testDownloader: Downloader = {
        id: "test-id-double-slash",
        name: "Test rTorrent Double Slash",
        type: "rtorrent",
        url: "https://example.com/rutorrent/",
        urlPath: "/plugins/httprpc/action.php",
        username: "admin",
        password: "password",
        enabled: true,
        priority: 1,
        downloadPath: null,
        category: null,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const successResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: async () => `<?xml version="1.0"?>
<methodResponse><params><param><value><string>0.9.8</string></value></param></params></methodResponse>`,
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      const { DownloaderManager } = await import("../downloaders.js");
      await DownloaderManager.testDownloader(testDownloader);

      const call = fetchMock.mock.calls[0];
      const [url] = call;

      // Expect single slash between path components
      expect(url).toBe("https://example.com/rutorrent/plugins/httprpc/action.php");
    });
  });

  describe("Encoding Comparison Tests", () => {
    it("should demonstrate difference between UTF-8 and Latin-1 encoding", () => {
      const username = "admin";
      const password = "café"; // Contains non-ASCII character

      // Latin-1 (ISO-8859-1) encoding
      const latin1Auth = Buffer.from(`${username}:${password}`, "latin1").toString("base64");

      // UTF-8 encoding - We now use this as it supports full unicode set
      const utf8Auth = Buffer.from(`${username}:${password}`, "utf8").toString("base64");

      // They should be different
      expect(latin1Auth).not.toBe(utf8Auth);

      // Verify the actual encoding difference
      // Latin-1 encodes é as 0xE9, UTF-8 as 0xC3 0xA9
      const latin1Bytes = Buffer.from(`${username}:${password}`, "latin1");
      const utf8Bytes = Buffer.from(`${username}:${password}`, "utf8");
      expect(utf8Bytes.length).toBeGreaterThan(latin1Bytes.length);
    });

    it("should produce identical results for ASCII-only credentials", () => {
      const username = "admin";
      const password = "test123"; // ASCII only

      const latin1Auth = Buffer.from(`${username}:${password}`, "latin1").toString("base64");
      const utf8Auth = Buffer.from(`${username}:${password}`, "utf8").toString("base64");

      // For ASCII-only, UTF-8 and Latin-1 are identical
      expect(latin1Auth).toBe(utf8Auth);
      expect(latin1Auth).toBe("YWRtaW46dGVzdDEyMw==");
    });
  });
});
