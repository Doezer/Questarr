import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";

const fetchMock = vi.fn();

vi.mock("parse-torrent", () => ({
  default: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
}));

vi.mock("../downloaders/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../downloaders/utils.js")>();
  return {
    ...actual,
    fetchWithMagnetDetection: vi.fn(),
  };
});

global.fetch = fetchMock as unknown as typeof fetch;

const { isSafeUrl } = await import("../ssrf.js");
const { fetchWithMagnetDetection } = await import("../downloaders/utils.js");
const { DelugeClient } = await import("../downloaders/deluge.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "deluge-coverage",
    name: "Deluge",
    type: "deluge",
    url: "http://deluge.local",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "",
    password: "secret",
    downloadPath: null,
    category: null,
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

describe("DelugeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
    vi.mocked(fetchWithMagnetDetection).mockReset();
  });

  describe("testConnection", () => {
    it("should return success on valid connection", async () => {
      const client = new DelugeClient(createDownloader());

      // auth.login
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
      } as Response);

      // web.connected
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);

      // daemon.get_version
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.1.1", error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected successfully to Deluge 2.1.1");
    });

    it("should handle authentication failure", async () => {
      const client = new DelugeClient(createDownloader());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: false, error: null, id: 1 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain("authentication failed");
    });

    it("should auto-connect when not connected to daemon", async () => {
      const client = new DelugeClient(createDownloader());

      // auth.login
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
      } as Response);

      // web.connected (false initially)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: false, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);

      // web.get_hosts
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: [["host-1", "127.0.0.1", 58846, "", ""]],
          error: null,
          id: 3,
        }),
        headers: new Headers(),
      } as Response);

      // web.connect
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 4 }),
        headers: new Headers(),
      } as Response);

      // web.connected (verify after connect)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 5 }),
        headers: new Headers(),
      } as Response);

      // daemon.get_version
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.1.1", error: null, id: 6 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });
  });

  describe("addDownload", () => {
    it("should add a magnet link successfully", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "abcdef1234567890abcdef1234567890abcdef12",
          error: null,
          id: 4,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Test Magnet",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("abcdef1234567890abcdef1234567890abcdef12");
    });

    it("should handle duplicate magnet links", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      // add_torrent_magnet returns null for duplicate
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null, id: 4 }),
        headers: new Headers(),
      } as Response);

      // Verify by checking torrent status
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { name: "Test Magnet" },
          error: null,
          id: 5,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Test Magnet",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
    });

    it("should add a torrent file via local download and upload", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as Response,
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "deadbeef1234567890abcdef1234567890abcdef12",
          error: null,
          id: 4,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Test File",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("deadbeef1234567890abcdef1234567890abcdef12");
    });

    it("should handle torrent file add returning null (fallback)", async () => {
      const client = new DelugeClient(createDownloader());
      vi.useFakeTimers();

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as Response,
      });

      // add_torrent_file returns null
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null, id: 4 }),
        headers: new Headers(),
      } as Response);

      // No hash match from URL — findRecentlyAddedDownload
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { recenthash123: { name: "Recent", time_added: Date.now() / 1000 } },
          error: null,
          id: 5,
        }),
        headers: new Headers(),
      } as Response);

      const addPromise = client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Test File",
      });

      // Advance past the 1s delay in findRecentlyAddedDownload
      await vi.advanceTimersByTimeAsync(1200);

      const result = await addPromise;

      expect(result.success).toBe(true);
      vi.useRealTimers();
    });

    it("should handle torrent download failure with URL fallback", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockRejectedValueOnce(new Error("download failed"));

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "fallbackhash1234567890abcdef1234567890ab",
          error: null,
          id: 4,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Test File",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("via URL");
    });

    it("should return error for unsafe URLs", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      vi.mocked(isSafeUrl).mockResolvedValueOnce(false);

      const result = await client.addDownload({
        url: "http://unsafe.local/file.torrent",
        title: "Unsafe",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unsafe URL blocked");
    });

    it("should return error when add fails completely", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null, id: 4 }),
        headers: new Headers(),
      } as Response);

      // Verify hash mock — return null so torrent doesn't "exist"
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null, id: 5 }),
        headers: new Headers(),
      } as Response);

      vi.useFakeTimers();

      // No recent download found
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: {}, error: null, id: 6 }),
        headers: new Headers(),
      } as Response);

      const addPromise = client.addDownload({
        url: "magnet:?xt=urn:btih:nonexistent1234567890abcdef1234567890ab",
        title: "Test Magnet",
      });

      await vi.advanceTimersByTimeAsync(1200);
      const result = await addPromise;
      vi.useRealTimers();

      expect(result.success).toBe(false);
    });

    it("should redirect to magnet when fetchWithMagnetDetection returns magnetLink", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        magnetLink: "magnet:?xt=urn:btih:magnetredirect1234567890abcdef123456",
      });

      // Extra mocks for recursive addDownload: ensureConnected + add_torrent_magnet
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "magnetredirect1234567890abcdef123456",
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Test File",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("getDownloadStatus", () => {
    it("should map downloading status correctly", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "Linux ISO",
            state: "Downloading",
            progress: 50,
            download_payload_rate: 1024,
            upload_payload_rate: 0,
            eta: 3600,
            total_size: 1000000,
            all_time_download: 500000,
            ratio: 0.1,
            num_peers: 10,
            num_seeds: 5,
            message: "",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("hash123");

      expect(status).not.toBeNull();
      expect(status?.status).toBe("downloading");
      expect(status?.progress).toBe(50);
      expect(status?.downloadSpeed).toBe(1024);
      expect(status?.eta).toBe(3600);
    });

    it("should map completed status from 100% progress", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "Done",
            state: "Paused",
            progress: 100,
            download_payload_rate: 0,
            upload_payload_rate: 0,
            eta: 0,
            total_size: 1000000,
            all_time_download: 1000000,
            ratio: 1.0,
            num_peers: 0,
            num_seeds: 0,
            message: "",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("hash123");

      expect(status?.status).toBe("completed");
      expect(status?.progress).toBe(100);
    });

    it("should map error status from Deluge Error state with message", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "Broken",
            state: "Error",
            progress: 0.1,
            download_payload_rate: 0,
            upload_payload_rate: 0,
            eta: 0,
            total_size: 1000000,
            all_time_download: 100000,
            ratio: 0,
            num_peers: 0,
            num_seeds: 0,
            message: "Tracker error",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("hash123");

      expect(status?.status).toBe("error");
      expect(status?.error).toBe("Tracker error");
    });

    it("should not treat innocuous tracker message 'OK' as an error — regression for #568", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "My Game",
            state: "Seeding",
            progress: 100,
            download_payload_rate: 0,
            upload_payload_rate: 1024,
            eta: 0,
            total_size: 5000000,
            all_time_download: 5000000,
            ratio: 1.5,
            num_peers: 3,
            num_seeds: 5,
            message: "OK",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("abc123");
      expect(status?.status).toBe("seeding");
      expect(status?.error).toBeUndefined();
    });

    it("should return null when torrent not found", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("nonexistent");
      expect(status).toBeNull();
    });
  });

  describe("getAllDownloads", () => {
    it("should return all downloads mapped correctly", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            hash1: {
              name: "Game A",
              state: "Downloading",
              progress: 25,
              download_payload_rate: 512,
              upload_payload_rate: 0,
              eta: 7200,
              total_size: 5000000,
              all_time_download: 1250000,
              ratio: 0,
              num_peers: 5,
              num_seeds: 2,
              message: "",
            },
            hash2: {
              name: "Game B",
              state: "Seeding",
              progress: 100,
              download_payload_rate: 0,
              upload_payload_rate: 256,
              eta: 0,
              total_size: 3000000,
              all_time_download: 3000000,
              ratio: 2.0,
              num_peers: 1,
              num_seeds: 1,
              message: "",
            },
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const downloads = await client.getAllDownloads();

      expect(downloads).toHaveLength(2);
      expect(downloads[0].status).toBe("downloading");
      expect(downloads[1].status).toBe("seeding");
    });

    it("should return empty array when no torrents", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: {}, error: null }),
        headers: new Headers(),
      } as Response);

      const downloads = await client.getAllDownloads();
      expect(downloads).toEqual([]);
    });
  });

  describe("download control", () => {
    it("should pause a download", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.pauseDownload("hash123");
      expect(result.success).toBe(true);
    });

    it("should resume a download", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.resumeDownload("hash123");
      expect(result.success).toBe(true);
    });

    it("should remove a download", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.removeDownload("hash123", false);
      expect(result.success).toBe(true);
    });

    it("should remove a download with files", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.removeDownload("hash123", true);
      expect(result.success).toBe(true);
    });

    it("should handle pause errors gracefully", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("pause error"));

      const result = await client.pauseDownload("hash123");
      expect(result.success).toBe(false);
      expect(result.message).toContain("pause error");
    });
  });

  describe("getDownloadDetails", () => {
    it("should return detailed download info with files and trackers", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "Detailed Game",
            state: "Downloading",
            progress: 50,
            download_payload_rate: 1024,
            upload_payload_rate: 0,
            eta: 3600,
            total_size: 1000000,
            all_time_download: 500000,
            all_time_upload: 0,
            ratio: 0,
            num_peers: 10,
            num_seeds: 5,
            save_path: "/downloads",
            time_added: 1700000000,
            completed_time: 0,
            files: [
              { path: "game/setup.exe", size: 500000, progress: 50, priority: 1 },
              { path: "game/readme.txt", size: 1000, progress: 100, priority: 2 },
            ],
            file_priorities: [1, 2],
            file_progress: [0.5, 1.0],
            trackers: [
              {
                url: "https://tracker1.com/announce",
                tier: 0,
                send_stats: true,
                fails: 0,
                verified: true,
              },
              {
                url: "https://tracker2.com/announce",
                tier: 1,
                send_stats: true,
                fails: 2,
                verified: false,
                last_error: { category: "tracker", value: "Connection refused" },
              },
            ],
            tracker_status: "Announcing",
            message: "",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const details = await client.getDownloadDetails("hash123");

      expect(details).not.toBeNull();
      expect(details?.files).toHaveLength(2);
      expect(details?.files[0].name).toBe("game/setup.exe");
      expect(details?.trackers).toHaveLength(2);
      expect(details?.trackers[0].status).toBe("working");
      expect(details?.trackers[1].status).toBe("error");
      expect(details?.downloadDir).toBe("/downloads");
    });

    it("should return null when torrent not found", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const details = await client.getDownloadDetails("nonexistent");
      expect(details).toBeNull();
    });
  });

  describe("getFreeSpace", () => {
    it("should return free space", async () => {
      const client = new DelugeClient(createDownloader({ downloadPath: "/downloads" }));
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 10737418240, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.getFreeSpace();
      expect(result).toBe(10737418240);
    });

    it("should return 0 on error", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("space error"));

      const result = await client.getFreeSpace();
      expect(result).toBe(0);
    });

    it("should return 0 for invalid response", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: -1, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.getFreeSpace();
      expect(result).toBe(0);
    });
  });

  describe("status mapping", () => {
    // Use it.each so beforeEach runs before every test case, keeping mocks fresh
    it.each([
      { state: "Downloading", expected: "downloading", progress: 50 },
      { state: "Checking", expected: "downloading", progress: 50 },
      { state: "Allocating", expected: "downloading", progress: 50 },
      { state: "Seeding", expected: "seeding", progress: 100 },
      { state: "Paused", expected: "paused", progress: 50 },
      { state: "Queued", expected: "paused", progress: 50 },
      { state: "Error", expected: "error", progress: 10 },
      { state: "Moving", expected: "downloading", progress: 80 },
      { state: "Paused", expected: "completed", progress: 100 },
    ])("maps Deluge state '$state' to '$expected'", async ({ state, expected, progress }) => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: state,
            state,
            progress,
            download_payload_rate: 0,
            upload_payload_rate: 0,
            eta: 0,
            total_size: 1000,
            all_time_download: 0,
            ratio: 0,
            num_peers: 0,
            num_seeds: 0,
            message: "",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("hash");
      expect(status?.status).toBe(expected);
    });
  });

  describe("RPC error handling", () => {
    it("should return failed result on Deluge RPC error", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: null,
          error: { message: "Invalid torrent", code: 5 },
          id: 4,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abc123",
        title: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid torrent");
    });

    it("should return failed result on HTTP errors", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("Server error"));

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abc123",
        title: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Server error");
    });

    it("should return failed result on invalid JSON", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abc123",
        title: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid JSON");
    });
  });

  describe("URL path support", () => {
    it("should include urlPath in the RPC URL", async () => {
      const client = new DelugeClient(
        createDownloader({ url: "http://deluge.local", urlPath: "/deluge" })
      );

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.1.1", error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      await client.testConnection();

      const calls = fetchMock.mock.calls;
      expect(calls[0][0]).toContain("/deluge/json");
    });

    it("should handle SSL and custom port", async () => {
      const client = new DelugeClient(
        createDownloader({ url: "deluge.local", useSsl: true, port: 8443 })
      );

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.1.1", error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      await client.testConnection();

      const calls = fetchMock.mock.calls;
      expect(calls[0][0]).toBe("https://deluge.local:8443/json");
    });
  });
});

// Helper to set up common auth + connection mocks for Deluge tests
function setupAuthAndConnect(): void {
  // auth.login
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ result: true, error: null, id: 1 }),
    headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
  } as Response);

  // web.connected
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ result: true, error: null, id: 2 }),
    headers: new Headers(),
  } as Response);
}

describe("DownloaderManager with Deluge", () => {
  it("creates a DelugeClient for deluge type", async () => {
    const { DownloaderManager } = await import("../downloaders/manager.js");
    const client = DownloaderManager.createClient(createDownloader());
    expect(client.constructor.name).toBe("DelugeClient");
  });
});
