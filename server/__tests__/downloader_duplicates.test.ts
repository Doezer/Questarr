import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader } from "@shared/schema";

vi.mock("parse-torrent", () => ({
  default: vi.fn((_buffer) => {
    return {
      infoHash: "abc123def456",
      name: "Test Game",
    };
  }),
}));

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Downloader Duplicates Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("Transmission: should return success: true when torrent is a duplicate", async () => {
    const transmission: Downloader = {
      id: "transmission",
      name: "Transmission",
      type: "transmission",
      url: "http://localhost:9091",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock session-get
    const sessionResponse = {
      result: "success",
      arguments: { "session-id": "123" },
    };

    // Mock duplicate response
    const duplicateResponse = {
      result: "success",
      arguments: {
        "torrent-duplicate": {
          hashString: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
          id: 1,
          name: "Test Game",
        },
      },
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 409,
        headers: { get: () => "123" },
        json: async () => sessionResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => duplicateResponse,
      });

    const result = await DownloaderManager.addDownload(transmission, {
      url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
      title: "Test Game",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd");
    expect(result.message).toContain("Download already exists");
  });

  it("qBittorrent: should return success: true when response is 'Fails.'", async () => {
    vi.useFakeTimers();
    const qbittorrent: Downloader = {
      id: "qbittorrent",
      name: "qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      username: "admin",
      password: "password",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    const torrentFileResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from("torrent content"),
    };

    // Mock add torrent response "Fails." (returned by qBittorrent after upload)
    const failResponse = {
      ok: true,
      text: async () => "Fails.",
      headers: { entries: () => [] },
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse)
      .mockResolvedValueOnce(torrentFileResponse)
      .mockResolvedValueOnce(failResponse);

    const promise = DownloaderManager.addDownload(qbittorrent, {
      url: "http://tracker.example.com/download/123.torrent",
      title: "Test Game",
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.message).toContain("Download already exists or invalid download");
  });

  it("SABnzbd: should return success: true when error mentions 'Duplicate'", async () => {
    const sabnzbd: Downloader = {
      id: "sabnzbd",
      name: "SABnzbd",
      type: "sabnzbd",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const duplicateResponse = {
      status: false,
      error: "Duplicate NZB",
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => duplicateResponse,
    });

    const result = await DownloaderManager.addDownload(sabnzbd, {
      url: "http://example.com/file.nzb",
      title: "Test NZB",
      downloadType: "usenet",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("NZB already exists");
  });

  it("SABnzbd: should return success: true when status is true but no IDs (merged/duplicate)", async () => {
    const sabnzbd: Downloader = {
      id: "sabnzbd",
      name: "SABnzbd",
      type: "sabnzbd",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mergedResponse = {
      status: true,
      nzo_ids: [],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mergedResponse,
    });

    const result = await DownloaderManager.addDownload(sabnzbd, {
      url: "http://example.com/file.nzb",
      title: "Test NZB",
      downloadType: "usenet",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("likely duplicate or merged");
  });

  it("addDownloadWithFallback: should stop falling back when duplicate is encountered (success: true)", async () => {
    const downloader1: Downloader = {
      id: "dl1",
      name: "Transmission (Primary)",
      type: "transmission",
      url: "http://localhost:9091",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const downloader2: Downloader = {
      id: "dl2",
      name: "qBittorrent (Secondary)",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 2,
      username: "admin",
      password: "password",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock Transmission response (duplicate)
    const sessionResponse = {
      result: "success",
      arguments: { "session-id": "123" },
    };

    const duplicateResponse = {
      result: "success",
      arguments: {
        "torrent-duplicate": {
          hashString: "hash123",
          id: 1,
          name: "Test Game",
        },
      },
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 409,
        headers: { get: () => "123" },
        json: async () => sessionResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => duplicateResponse,
      });

    const result = await DownloaderManager.addDownloadWithFallback([downloader1, downloader2], {
      url: "magnet:?xt=urn:btih:hash123",
      title: "Test Game",
      downloadType: "torrent",
    });

    expect(result.success).toBe(true);
    expect(result.downloaderName).toBe("Transmission (Primary)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Should NOT have called qBittorrent login/add
  });
});
