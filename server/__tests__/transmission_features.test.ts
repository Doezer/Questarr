import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader } from "@shared/schema";

// Mock parse-torrent
vi.mock("parse-torrent", () => ({
  default: vi.fn((buffer) => {
    return {
      infoHash: "abc123def456",
      name: "Test Game",
    };
  }),
}));

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("TransmissionClient - Advanced Features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  const testDownloader: Downloader = {
    id: "transmission-id",
    name: "Test Transmission",
    type: "transmission",
    url: "http://localhost:9091",
    enabled: true,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("should handle session ID conflict (409) and retry", async () => {
    // Mock 1: 409 Conflict with X-Transmission-Session-Id header
    const conflictResponse = {
      ok: false,
      status: 409,
      headers: {
        get: (name: string) => (name === "X-Transmission-Session-Id" ? "new-session-id" : null),
      },
      json: async () => ({ result: "fail" }),
    };

    // Mock 2: Success with new session ID
    const successResponse = {
      ok: true,
      json: async () => ({
        arguments: {
          "torrent-added": {
            hashString: "hash123",
            id: 1,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      }),
    };

    fetchMock.mockResolvedValueOnce(conflictResponse).mockResolvedValueOnce(successResponse);

    await DownloaderManager.addDownload(testDownloader, {
      url: "magnet:?xt=urn:btih:hash123",
      title: "Test Game",
    });

    // Expect 2 calls
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: initial request
    expect(fetchMock.mock.calls[0][0]).toContain("/transmission/rpc");

    // Second call: retry with session ID
    expect(fetchMock.mock.calls[1][0]).toContain("/transmission/rpc");
    expect(fetchMock.mock.calls[1][1].headers).toHaveProperty(
      "X-Transmission-Session-Id",
      "new-session-id"
    );
  });

  it("should handle authentication failure (401)", async () => {
    // Mock 401 Unauthorized
    const unauthorizedResponse = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized user",
      headers: { get: () => null },
    };

    fetchMock.mockResolvedValueOnce(unauthorizedResponse);

    const result = await DownloaderManager.addDownload(testDownloader, {
      url: "magnet:?xt=urn:btih:hash123",
      title: "Test Game",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Authentication failed");
  });

  it("should download file server-side and upload metainfo", async () => {
    // Mock 1: file download

    const torrentFileResponse = {
      ok: true,

      arrayBuffer: async () => Buffer.from("mock download content"),

      text: async () => "mock download content",
    };

    // Mock 2: session check (409)

    const sessionResponse = {
      ok: false,

      status: 409,

      headers: { get: () => "session-id" },
    };

    // Mock 3: RPC add

    const rpcResponse = {
      ok: true,

      json: async () => ({
        arguments: {
          "torrent-added": {
            hashString: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",

            id: 1,

            name: "Download File Game",
          },
        },

        result: "success",
      }),
    };

    fetchMock.mockResolvedValueOnce(torrentFileResponse).mockResolvedValueOnce(rpcResponse);

    const downloadUrl = "http://indexer.com/download/123.torrent";

    await DownloaderManager.addDownload(testDownloader, {
      url: downloadUrl,

      title: "Download File Game",
    });

    // Check if fetch was called for the file

    expect(fetchMock.mock.calls[0][0]).toBe(downloadUrl);

    // Check if RPC call included metainfo (base64 encoded)

    const rpcCall = fetchMock.mock.calls[1];

    const rpcBody = JSON.parse(rpcCall[1].body);

    expect(rpcBody.method).toBe("torrent-add");

    expect(rpcBody.arguments).toHaveProperty("metainfo");

    expect(rpcBody.arguments.metainfo).toBe(
      Buffer.from("mock download content").toString("base64")
    );
  });
});
