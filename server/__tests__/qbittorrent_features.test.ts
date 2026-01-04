import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Downloader } from "@shared/schema";

vi.mock("parse-torrent", () => ({
  default: vi.fn().mockResolvedValue({ infoHash: "abc123def456" }),
}));

describe("QBittorrentClient - Advanced Features", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it("should handle adding torrent from http URL (non-magnet) and resolve hash", async () => {
    const testDownloader: Downloader = {
      id: "qb-id",
      name: "QBittorrent",
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

    // Mock login
    const loginResponse = {
      ok: true,
      status: 200,
      headers: new Headers([["set-cookie", "SID=abc; path=/"]]),
      text: async () => "Ok.",
    };

    // Mock add torrent response (success)
    const addResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "Ok.",
    };

    // Mock torrents info response (to find the added torrent)
    const torrentsInfoResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => [
        {
          hash: "resolved-hash-123",
          name: "My Game Title",
          state: "downloading",
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // authenticate
      .mockResolvedValueOnce(addResponse) // add torrent
      .mockResolvedValueOnce(torrentsInfoResponse); // check info

    const { DownloaderManager } = await import("../downloaders.js");

    // Use a title that matches the mocked response name
    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: "http://tracker.example.com/download/123.torrent",
      title: "My Game Title",
    });

    // Verify authentication
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v2/auth/login",
      expect.anything()
    );

    // Verify add torrent call
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v2/torrents/add",
      expect.objectContaining({
        body: expect.stringContaining("urls=http%3A%2F%2Ftracker.example.com%2Fdownload%2F123.torrent"),
      })
    );

    // Verify info call
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v2/torrents/info",
      expect.anything()
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe("resolved-hash-123");
  });

  it("should apply force-start when configured in settings", async () => {
    const testDownloader: Downloader = {
      id: "qb-id-force",
      name: "QBittorrent Force",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: "admin",
      password: "adminadmin",
      enabled: true,
      priority: 1,
      downloadPath: "/downloads",
      category: "games",
      settings: JSON.stringify({ initialState: "force-started" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login
    const loginResponse = {
      ok: true,
      status: 200,
      headers: new Headers([["set-cookie", "SID=abc; path=/"]]),
      text: async () => "Ok.",
    };

    // Mock add torrent response
    const addResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "Ok.",
    };

    // Mock verify torrent info (for magnet link)
    const verifyResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => [
        {
          hash: "1234567890123456789012345678901234567890",
          name: "Force Started Game",
        },
      ],
    };

    // Mock setForceStart response
    const forceStartResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "Ok.",
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // authenticate
      .mockResolvedValueOnce(addResponse) // add torrent
      .mockResolvedValueOnce(verifyResponse) // verify hash
      .mockResolvedValueOnce(forceStartResponse); // set force start

    const { DownloaderManager } = await import("../downloaders.js");

    const magnetHash = "1234567890123456789012345678901234567890";
    const result = await DownloaderManager.addTorrent(testDownloader, {
      url: `magnet:?xt=urn:btih:${magnetHash}`,
      title: "Force Started Game",
    });

    // Verify force start call
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v2/torrents/setForceStart",
      expect.objectContaining({
        body: expect.stringContaining(`hashes=${magnetHash}&value=true`),
      })
    );

    expect(result.success).toBe(true);
  });

  it("should apply stopped state when configured in settings", async () => {
    const testDownloader: Downloader = {
      id: "qb-id-stopped",
      name: "QBittorrent Stopped",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: "admin",
      password: "adminadmin",
      enabled: true,
      priority: 1,
      downloadPath: "/downloads",
      category: "games",
      settings: JSON.stringify({ initialState: "stopped" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Mock login
    const loginResponse = {
      ok: true,
      status: 200,
      headers: new Headers([["set-cookie", "SID=abc; path=/"]]),
      text: async () => "Ok.",
    };

    // Mock add torrent response
    const addResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "Ok.",
    };

    // Mock verify torrent info
    const verifyResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => [
        {
          hash: "magnet-hash-123",
          name: "Stopped Game",
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse)
      .mockResolvedValueOnce(addResponse)
      .mockResolvedValueOnce(verifyResponse);

    const { DownloaderManager } = await import("../downloaders.js");

    const magnetHash = "magnethash123";
    await DownloaderManager.addTorrent(testDownloader, {
      url: `magnet:?xt=urn:btih:${magnetHash}`,
      title: "Stopped Game",
    });

    // Verify paused=true in add request
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v2/torrents/add",
      expect.objectContaining({
        body: expect.stringContaining("paused=true"),
      })
    );
  });
});
