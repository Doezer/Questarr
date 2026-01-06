import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader } from "@shared/schema";

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

describe("QBittorrentClient - Advanced Features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("should handle adding download from http URL (non-magnet) and resolve hash", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "QBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      username: "admin",
      password: "password",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login response
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    // Mock add torrent response (success)
    const addResponse = {
      ok: true,
      text: async () => "Ok.",
    };

    // Mock torrents info response (to find the added torrent)
    const torrentsInfoResponse = {
      ok: true,
      json: async () => [
        {
          hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
          name: "Test Game",
          content_path: "/downloads/Test Game",
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // login
      .mockResolvedValueOnce(addResponse) // add torrent
      .mockResolvedValueOnce(torrentsInfoResponse); // check info

    const result = await DownloaderManager.addDownload(testDownloader, {
      url: "http://tracker.example.com/download/123.torrent",
      title: "Test Game",
    });

    // Verify add torrent call
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8080/api/v2/torrents/add");
    // Should pass URL as form data
    expect(fetchMock.mock.calls[1][1].body).toContain(
      "urls=http%3A%2F%2Ftracker.example.com%2Fdownload%2F123.torrent"
    );

    // Verify info call
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/v2/torrents/info");

    expect(result.success).toBe(true);
    expect(result.id).toBe("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd");
  });

  it("should support force-started mode via settings", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "QBittorrent Force",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      username: "admin",
      password: "password",
      settings: JSON.stringify({ initialState: "force-started" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login response
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    // Mock add torrent response
    const addResponse = {
      ok: true,
      text: async () => "Ok.",
    };

    // Mock verify torrent info (for magnet link)
    const verifyResponse = {
      ok: true,
      json: async () => [{ hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd", name: "Test Game" }],
    };

    // Mock set force start response
    const setForceResponse = {
      ok: true,
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // login
      .mockResolvedValueOnce(addResponse) // add torrent
      .mockResolvedValueOnce(verifyResponse) // verify added
      .mockResolvedValueOnce(setForceResponse); // set force start

    const result = await DownloaderManager.addDownload(testDownloader, {
      url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
      title: "Test Game",
    });

    // Verify set force start call
    const calls = fetchMock.mock.calls;
    const forceStartCall = calls.find((call) => call[0].includes("/api/v2/torrents/setForceStart"));

    expect(forceStartCall).toBeDefined();
    expect(forceStartCall[0]).toBe("http://localhost:8080/api/v2/torrents/setForceStart");
    expect(forceStartCall[1].body).toBe(
      "hashes=aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd&value=true"
    );

    expect(result.success).toBe(true);
  });

  it("should support stopped (paused) mode via settings", async () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "QBittorrent Stopped",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 1,
      addStopped: true, // Legacy setting or override
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login response
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    // Mock add torrent response
    const addResponse = {
      ok: true,
      text: async () => "Ok.",
    };

    // Mock verify torrent info
    const verifyResponse = {
      ok: true,
      json: async () => [{ hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd", name: "Test Game" }],
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse)
      .mockResolvedValueOnce(addResponse)
      .mockResolvedValueOnce(verifyResponse);

    await DownloaderManager.addDownload(testDownloader, {
      url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
      title: "Test Game",
    });

    // Verify add call has paused=true
    const calls = fetchMock.mock.calls;
    const addCall = calls.find((call) => call[0].includes("/api/v2/torrents/add"));

    expect(addCall).toBeDefined();
    expect(addCall[0]).toBe("http://localhost:8080/api/v2/torrents/add");
    expect(addCall[1].body).toContain("paused=true");
  });
});
