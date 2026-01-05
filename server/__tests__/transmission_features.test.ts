
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Downloader } from "@shared/schema";

// Mock parse-torrent
vi.mock("parse-torrent", () => ({
  default: vi.fn().mockResolvedValue({ infoHash: "abc123def456" }),
}));

describe("TransmissionClient Feature Verification", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  const testDownloader: Downloader = {
    id: "test-trans",
    name: "Transmission",
    type: "transmission",
    url: "localhost",
    username: "admin",
    password: "password",
    enabled: true,
    priority: 1,
    downloadPath: "/downloads",
    category: "games",
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    useSsl: false,
    port: 9091,
    urlPath: "/transmission/rpc",
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
  };

  it("should handle magnet links by passing them directly", async () => {
    const { DownloaderManager } = await import("../downloaders.js");
    
    // Mock successful RPC response
    const rpcResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        result: "success",
        arguments: { "torrent-added": { id: 1, name: "test" } }
      })
    };
    fetchMock.mockResolvedValue(rpcResponse);

    await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:123",
      title: "Magnet Game"
    });

    // Should call RPC with filename = magnet link
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Find the call that has the filename argument
    const rpcCall = fetchMock.mock.calls.find(call => {
      try {
        const body = JSON.parse(call[1].body);
        return body && body.arguments && body.arguments.filename;
      } catch {
        return false;
      }
    });

    expect(rpcCall).toBeDefined();
    const callBody = JSON.parse(rpcCall[1].body);
    expect(callBody.arguments.filename).toBe("magnet:?xt=urn:btih:123");
  });

  it("should handle categories by setting labels and download-dir", async () => {
    const { DownloaderManager } = await import("../downloaders.js");

    const rpcResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        result: "success",
        arguments: { "torrent-added": { id: 1, name: "test" } }
      })
    };
    fetchMock.mockResolvedValue(rpcResponse);

    await DownloaderManager.addTorrent(testDownloader, {
      url: "magnet:?xt=urn:btih:123",
      title: "Category Game",
      category: "rpg",
      downloadPath: "/games"
    });

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.arguments.labels).toEqual(["rpg"]);
    expect(callBody.arguments["download-dir"]).toBe("/games/rpg");
  });

  it("should download .torrent file server-side and upload metainfo", async () => {
    const { DownloaderManager } = await import("../downloaders.js");

    // Mock 1: .torrent file download
    const torrentFileResponse = {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(10), // Mock content
      text: async () => "mock torrent content",
      headers: new Headers()
    };

    // Mock 2: RPC response
    const rpcResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        result: "success",
        arguments: { "torrent-added": { id: 1, name: "test" } }
      })
    };

    fetchMock
      .mockResolvedValueOnce(torrentFileResponse)
      .mockResolvedValueOnce(rpcResponse);

    const torrentUrl = "http://indexer.com/download/123.torrent";
    await DownloaderManager.addTorrent(testDownloader, {
      url: torrentUrl,
      title: "Torrent File Game"
    });

    // Check if fetch was called for the .torrent file
    // Might be called 2 or 3 times depending on retry/check logic
    // But the FIRST call should be the torrent URL
    expect(fetchMock.mock.calls[0][0]).toBe(torrentUrl);

    // Check if RPC was called with metainfo
    // Find the call with metainfo
    const rpcCall = fetchMock.mock.calls.find(call => {
      try {
        const body = JSON.parse(call[1].body);
        return body && body.arguments && body.arguments.metainfo;
      } catch {
        return false;
      }
    });

    expect(rpcCall).toBeDefined();
    const rpcCallBody = JSON.parse(rpcCall[1].body);
    expect(rpcCallBody.arguments.metainfo).toBeDefined();
    expect(rpcCallBody.arguments.filename).toBeUndefined(); // Should use metainfo, not filename
  });
});
