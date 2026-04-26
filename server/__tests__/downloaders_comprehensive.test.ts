import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader } from "../../shared/schema";

vi.mock("parse-torrent", () => ({
  default: vi.fn((_buffer) => {
    return {
      infoHash: "abc123def456",
      name: "Test Game",
    };
  }),
}));

// Mock ssrf check to allow all URLs in tests
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn((url, options) => fetch(url, options)),
}));

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

function mockNzbFetch(content = "nzb content") {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  });
}

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

    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    const _torrentFileResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from("torrent content"),
    };

    it("should add download successfully", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(loginResponse)
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
              name: "Test Torrent",
              added_on: Math.floor(Date.now() / 1000),
            },
          ],
        });

      const promise = DownloaderManager.addDownload(downloader, {
        url: "http://tracker.example.com/download/123.torrent",
        title: "Test Torrent",
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.id).toBe("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd");
    });

    it("should handle duplicate torrent (Fails.) as success", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(loginResponse)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "Fails.",
          headers: { entries: () => [] },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
              name: "Test Torrent",
              added_on: Math.floor(Date.now() / 1000),
            },
          ],
        });

      const promise = DownloaderManager.addDownload(downloader, {
        url: "http://tracker.example.com/download/123.torrent",
        title: "Test Torrent",
      });

      await vi.runAllTimersAsync();
      const result = await promise;

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

    const emptyQueueResponse = {
      queue: { slots: [], speed: "0", diskspace1: 100, diskspace1_norm: "100 GB" },
    };

    const mockQueueThenHistory = (historyData: unknown) => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => emptyQueueResponse });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => historyData });
    };

    it("should add NZB successfully", async () => {
      mockNzbFetch();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: true, nzo_ids: ["nzo123"] }),
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.nzb",
        title: "Test NZB",
        downloadType: "usenet",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("nzo123");
      expect(fetchMock.mock.calls[1][0]).toContain("cat=games");
    });

    it("should handle duplicate NZB as success", async () => {
      mockNzbFetch();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: false, error: "Duplicate NZB" }),
      });

      const result = await DownloaderManager.addDownload(downloader, {
        url: "http://example.com/test.nzb",
        title: "Test NZB",
        downloadType: "usenet",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("NZB already exists");
    });

    it("should return completed status when download is found in history", async () => {
      mockQueueThenHistory({
        history: {
          slots: [
            {
              nzo_id: "nzo123",
              name: "Test Game",
              status: "Completed",
              fail_message: "",
              path: "/downloads/games/Test Game",
              bytes: 1073741824,
              category: "games",
              download_time: 120,
              completed: 1700000000,
            },
          ],
        },
      });

      const result = await DownloaderManager.getDownloadStatus(downloader, "nzo123");

      expect(result).not.toBeNull();
      expect(result?.status).toBe("completed");
      expect(result?.progress).toBe(100);
      expect(result?.repairStatus).toBe("good");
      expect(result?.unpackStatus).toBe("completed");
    });

    it("should include history path in SABnzbd download details", async () => {
      const historyResponse = {
        history: {
          slots: [
            {
              nzo_id: "nzo123",
              name: "Test Game",
              status: "Completed",
              fail_message: "",
              path: "/downloads/complete/Test Game",
              bytes: 1073741824,
              category: "games",
              download_time: 120,
              completed: 1700000000,
            },
          ],
        },
      };
      mockQueueThenHistory(historyResponse);
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => historyResponse });

      const result = await DownloaderManager.getDownloadDetails(downloader, "nzo123");

      expect(result?.downloadDir).toBe("/downloads/complete/Test Game");
    });

    it("should return error status when history shows a failed download", async () => {
      mockQueueThenHistory({
        history: {
          slots: [
            {
              nzo_id: "nzo456",
              name: "Broken Game",
              status: "Failed",
              fail_message: "Repair failed",
              path: "",
              bytes: 0,
              category: "games",
              download_time: 0,
              completed: 1700000000,
            },
          ],
        },
      });

      const result = await DownloaderManager.getDownloadStatus(downloader, "nzo456");

      expect(result).not.toBeNull();
      expect(result?.status).toBe("error");
      expect(result?.error).toBe("Repair failed");
      expect(result?.repairStatus).toBe("failed");
    });

    it("should return null when download is not in queue or history", async () => {
      // queue → not found → getFromHistory (2 passes: filtered then full)
      mockQueueThenHistory({ history: { slots: [] } }); // queue + filtered history (empty → retry)
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ history: { slots: [] } }) }); // full history (empty → null)

      const result = await DownloaderManager.getDownloadStatus(downloader, "nzo_unknown");

      expect(result).toBeNull();
    });

    it("should pass nzo_ids parameter when querying history", async () => {
      mockQueueThenHistory({
        history: {
          slots: [
            {
              nzo_id: "nzo_test_id",
              name: "Test Download",
              status: "Completed",
              bytes: 1000000,
              category: "games",
              fail_message: "",
            },
          ],
        },
      });

      await DownloaderManager.getDownloadStatus(downloader, "nzo_test_id");

      const historyCalls = fetchMock.mock.calls.filter((call) => {
        const url: string = call[0];
        return url.includes("mode=history");
      });
      expect(historyCalls.length).toBe(1);
      expect(historyCalls[0][0]).toContain("nzo_ids=nzo_test_id");
    });

    it("should retry full history when the filtered history lookup fails", async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => emptyQueueResponse });
      fetchMock.mockRejectedValueOnce(new Error("Filtered history failed"));
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          history: {
            slots: [
              {
                nzo_id: "nzo_retry",
                name: "Retry Download",
                status: "Completed",
                fail_message: "",
                bytes: 2048,
                category: "games",
              },
            ],
          },
        }),
      });

      const result = await DownloaderManager.getDownloadStatus(downloader, "nzo_retry");

      expect(result?.status).toBe("completed");

      const historyCalls = fetchMock.mock.calls.filter((call) => {
        const url: string = call[0];
        return url.includes("mode=history");
      });
      expect(historyCalls.length).toBe(2);
      expect(historyCalls[0][0]).toContain("nzo_ids=nzo_retry");
      expect(historyCalls[1][0]).not.toContain("nzo_ids=");
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

    it("should add NZB successfully", async () => {
      // Mock NZB file download
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("nzb content").buffer,
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
      expect(fetchMock.mock.calls[1][1].body).toContain("<string>games</string>");
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
