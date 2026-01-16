import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader } from "../../shared/schema";

vi.mock("parse-torrent", () => ({
  default: vi.fn((buffer) => {
    // If buffer contains "invalid", throw error
    if (buffer.toString().includes("invalid")) {
      throw new Error("Invalid torrent");
    }
    return {
      infoHash: "abc123def456",
      name: "Test Game",
    };
  }),
}));

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("DownloaderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.useRealTimers();
  });

  describe("TransmissionClient - RPC Protocol", () => {
    const testDownloader: Downloader = {
      id: "transmission-id",
      name: "Test Transmission",
      type: "transmission",
      url: "http://localhost:9091",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      username: null,
      password: null,
      downloadPath: null,
      category: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
      settings: null,
    };

    it("should connect and add download successfully", async () => {
      // Mock session-get response
      const sessionResponse = {
        arguments: { "session-id": "session-123" },
        result: "success",
      };

      // Mock torrent-add response
      const addResponse = {
        arguments: {
          "torrent-added": {
            hashString: "hash123",
            id: 1,
            name: "Test Game.torrent",
          },
        },
        result: "success",
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 409,
          headers: { get: () => "session-123" },
          json: async () => sessionResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => addResponse,
        });

      // Test adding a download
      const result = await DownloaderManager.addDownload(testDownloader, {
        url: "magnet:?xt=urn:btih:hash123",
        title: "Test Game",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("hash123");
      expect(result.message).toBe("Download added successfully");
    });
  });

  describe("addDownloadWithFallback", () => {
    const downloader1: Downloader = {
      id: "downloader-1",
      name: "Primary Downloader",
      type: "transmission",
      url: "http://localhost:9091",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      username: null,
      password: null,
      downloadPath: null,
      category: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
      settings: null,
    };

    const downloader2: Downloader = {
      id: "downloader-2",
      name: "Secondary Downloader",
      type: "qbittorrent",
      url: "http://localhost:8080",
      enabled: true,
      priority: 2,
      username: "admin",
      password: "password",
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      downloadPath: null,
      category: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
      settings: null,
    };

    it("should fallback to second downloader if first fails", async () => {
      vi.useFakeTimers();
      // Mock first downloader failure (Transmission)
      // 1. Session check (409) -> Success getting session
      // 2. Add torrent failure
      const sessionResponse = {
        arguments: { "session-id": "session-123" },
        result: "success",
      };

      // Mock Transmission failure
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 409,
          headers: { get: () => "session-123" },
          json: async () => sessionResponse,
        })
        .mockResolvedValueOnce({
          ok: false, // Transmission request failed
          status: 500,
          statusText: "Server Error",
          text: async () => "Internal Error",
        });

      // Mock second downloader (qBittorrent) success
      // 3. Login
      // 4. Add torrent by URL
      // 5. Info check (find newly added torrent)
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Ok.",
          headers: { get: () => "SID=123" },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "Ok.",
          headers: { entries: () => [] },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
              name: "Test Game",
              added_on: Math.floor(Date.now() / 1000),
            },
          ],
        });

      const promise = DownloaderManager.addDownloadWithFallback([downloader1, downloader2], {
        url: "http://tracker.example.com/download/123.torrent",
        title: "Test Game",
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.downloaderId).toBe(downloader2.id);
      expect(result.attemptedDownloaders).toContain(downloader1.name);
      expect(result.attemptedDownloaders).toContain(downloader2.name);
    });
  });

  describe("RTorrentClient - XML-RPC Protocol", () => {
    const testDownloader: Downloader = {
      id: "rtorrent-id",
      name: "Test rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      username: null,
      password: null,
      downloadPath: null,
      category: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
      settings: null,
    };

    it("should connect successfully", async () => {
      const xmlResponse = `<?xml version="1.0"?><methodResponse><params><param><value><string>0.9.8</string></value></param></params></methodResponse>`;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => xmlResponse,
      });

      const result = await DownloaderManager.testDownloader(testDownloader);

      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/rutorrent/RPC2");
      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected successfully to rTorrent");
    });

    it("should add download successfully", async () => {
      const xmlResponse = `<?xml version="1.0"?><methodResponse><params><param><value><i4>0</i4></value></param></params></methodResponse>`;

      const fileResponse = {
        ok: true,
        arrayBuffer: async () => Buffer.from("torrent content"),
        text: async () => "torrent content",
      };

      fetchMock
        .mockResolvedValueOnce(fileResponse)
        .mockResolvedValueOnce({ ok: true, text: async () => xmlResponse })
        .mockResolvedValueOnce({ ok: true, text: async () => xmlResponse });

      const result = await DownloaderManager.addDownload(testDownloader, {
        url: "http://example.com/test.torrent",
        title: "Test Game",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("Download added successfully");
    });

    it("should get all downloads with correct status mapping", async () => {
      const xmlResponse = `
        <?xml version="1.0"?>
        <methodResponse>
          <params>
            <param>
              <value>
                <array>
                  <data>
                    <value><array><data>
                      <value><string>HASH1</string></value>
                      <value><string>Downloading Game.torrent</string></value>
                      <value><i4>1</i4></value>
                      <value><i4>0</i4></value>
                      <value><i8>104857600</i8></value>
                      <value><i8>52428800</i8></value>
                      <value><i8>102400</i8></value>
                      <value><i8>51200</i8></value>
                      <value><i4>500</i4></value>
                      <value><i4>10</i4></value>
                      <value><i4>5</i4></value>
                      <value><string></string></value>
                      <value><string></string></value>
                    </data></array></value>
                  </data>
                </array>
              </value>
            </param>
          </params>
        </methodResponse>`;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => xmlResponse,
      });

      const downloads = await DownloaderManager.getAllDownloads(testDownloader);

      expect(downloads).toHaveLength(1);
      expect(downloads[0].id).toBe("HASH1");
      expect(downloads[0].status).toBe("downloading");
    });
  });

  describe("QBittorrentClient - Web API v2", () => {
    const testDownloader: Downloader = {
      id: "qbittorrent-id",
      name: "Test qBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      username: "admin",
      password: "password",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      downloadPath: null,
      category: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
      settings: null,
    };

    it("should connect successfully with authentication", async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Ok.",
          headers: { get: () => "SID=123" },
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "v4.6.2",
        });

      const result = await DownloaderManager.testDownloader(testDownloader);

      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/v2/auth/login");
      expect(result.success).toBe(true);
    });

    it("should add download successfully", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Ok.",
          headers: { get: () => "SID=123" },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "Ok.",
          headers: { entries: () => [] },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
              name: "Test Game",
              added_on: Math.floor(Date.now() / 1000),
            },
          ],
        });

      const promise = DownloaderManager.addDownload(testDownloader, {
        url: "http://tracker.example.com/download/123.torrent",
        title: "Test Game",
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.id).toBe("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd");
    });
  });
});
