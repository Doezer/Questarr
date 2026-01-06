import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader, DownloadStatus } from "@shared/schema";

vi.mock("parse-torrent", () => ({
  default: vi.fn((buffer) => {
    return {
      infoHash: "abc123def456",
      name: "Test Torrent",
    };
  }),
}));

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Downloader Comprehensive Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  // ==================== Transmission Tests ====================
  describe("TransmissionClient", () => {
    const downloader: Downloader = {
      id: "transmission",
      name: "Transmission",
      type: "transmission",
      url: "http://localhost:9091",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const sessionResponse = {
      result: "success",
      arguments: { "session-id": "123" },
    };

    it("should add download successfully", async () => {
      const addResponse = {
        result: "success",
        arguments: {
          "torrent-added": {
            hashString: "hash123",
            id: 1,
            name: "Test Torrent",
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
          json: async () => addResponse,
        });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "magnet:?xt=urn:btih:hash123",
        title: "Test Torrent",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("hash123");
    });

    it("should handle duplicate torrent as success", async () => {
      const duplicateResponse = {
        result: "success",
        arguments: {
          "torrent-duplicate": {
            hashString: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
            id: 1,
            name: "Test Torrent",
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

      const result = await DownloaderManager.addDownload(downloader, {
        url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
        title: "Test Torrent",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("Download already exists");
    });

    it("should get download status", async () => {
      const statusResponse = {
        result: "success",
        arguments: {
          torrents: [
            {
              hashString: "hash123",
              name: "Test Torrent",
              status: 4, // downloading
              percentDone: 0.5,
              rateDownload: 1000,
              rateUpload: 500,
              eta: 60,
              totalSize: 10000,
              downloadedEver: 5000,
              peersSendingToUs: 10,
              peersGettingFromUs: 5,
              uploadRatio: 0.5,
            },
          ],
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => statusResponse,
      });

      const result = await DownloaderManager.getDownloadStatus(downloader, "hash123");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("hash123");
      expect(result?.status).toBe("downloading");
      expect(result?.progress).toBe(50);
    });
  });

  // ==================== rTorrent Tests ====================
  describe("RTorrentClient", () => {
    const downloader: Downloader = {
      id: "rtorrent",
      name: "rTorrent",
      type: "rtorrent",
      url: "http://localhost:8080/rutorrent",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const xmlResponseSuccess = `
      <?xml version="1.0" encoding="UTF-8"?>
      <methodResponse>
        <params><param><value><i4>0</i4></value></param></params>
      </methodResponse>
    `;

    it("should add download successfully", async () => {
      // Mock fetching .torrent file
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from("content"),
        text: async () => "content",
      });

      // Mock add torrent XML-RPC
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => xmlResponseSuccess,
      });

      // Mock set category XML-RPC
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => xmlResponseSuccess,
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.torrent",
        title: "Test Torrent",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("abc123def456"); // From mock parse-torrent
    });
  });

  // ==================== qBittorrent Tests ====================
  describe("QBittorrentClient", () => {
    const downloader: Downloader = {
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

    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    it("should add download successfully", async () => {
      fetchMock
        .mockResolvedValueOnce(loginResponse)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Ok.",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd", name: "Test Torrent" },
          ],
        });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
        title: "Test Torrent",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd");
    });

    it("should handle duplicate torrent (Fails.) as success", async () => {
      fetchMock.mockResolvedValueOnce(loginResponse).mockResolvedValueOnce({
        ok: true,
        text: async () => "Fails.",
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "magnet:?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
        title: "Test Torrent",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("Download already exists");
    });
  });

  // ==================== SABnzbd Tests ====================
  describe("SABnzbdClient", () => {
    const downloader: Downloader = {
      id: "sabnzbd",
      name: "SABnzbd",
      type: "sabnzbd",
      url: "http://localhost:8080",
      apiKey: "key",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should add NZB successfully", async () => {
      const addResponse = {
        status: true,
        nzo_ids: ["nzo123"],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => addResponse,
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.nzb",
        title: "Test NZB",
        downloadType: "usenet",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("nzo123");
    });

    it("should handle duplicate NZB as success", async () => {
      const duplicateResponse = {
        status: false,
        error: "Duplicate NZB",
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => duplicateResponse,
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.nzb",
        title: "Test NZB",
        downloadType: "usenet",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("NZB already exists");
    });
  });

  // ==================== NZBGet Tests ====================
  describe("NZBGetClient", () => {
    const downloader: Downloader = {
      id: "nzbget",
      name: "NZBGet",
      type: "nzbget",
      url: "http://localhost:6789",
      username: "user",
      password: "pass",
      enabled: true,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("should add NZB successfully", async () => {
      // Mock NZB file download
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => "nzb content",
      });

      // Mock XML-RPC append
      const xmlResponse = `
        <?xml version="1.0"?>
        <methodResponse>
          <params><param><value><i4>123</i4></value></param></params>
        </methodResponse>
      `;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => xmlResponse,
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.nzb",
        title: "Test NZB",
        downloadType: "usenet",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("123");
    });

    it("should handle failed NZB fetch", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.nzb",
        title: "Test NZB",
        downloadType: "usenet",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to fetch NZB");
    });
  });
});
