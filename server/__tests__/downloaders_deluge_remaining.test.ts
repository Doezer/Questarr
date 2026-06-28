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

global.fetch = fetchMock as unknown as typeof fetch;

const { DelugeClient } = await import("../downloaders/deluge.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "deluge-remaining",
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

describe("DelugeClient — remaining coverage edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  describe("status mapping", () => {
    it("warns on unknown state and maps to paused", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "Weird",
            state: "SomeUnknownState",
            progress: 30,
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
      expect(status?.status).toBe("paused");
    });

    it("forces seeding when progress is 100% during downloading", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "AlmostDone",
            state: "Downloading",
            progress: 100,
            download_payload_rate: 0,
            upload_payload_rate: 256,
            eta: 0,
            total_size: 1000,
            all_time_download: 1000,
            ratio: 0,
            num_peers: 0,
            num_seeds: 1,
            message: "",
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const status = await client.getDownloadStatus("hash");
      expect(status?.status).toBe("seeding");
    });
  });

  describe("makeRequest error handling", () => {
    it("returns failed result on Deluge RPC error", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Bad credentials",
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abc123",
        title: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Authentication failed");
    });

    it("returns null on non-401 HTTP errors for getDownloadStatus", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Boom",
        headers: new Headers(),
      } as Response);

      const result = await client.getDownloadStatus("hash");
      expect(result).toBeNull();
    });
  });

  describe("testConnection logVersionInfo", () => {
    it("returns success even when version is not a string", async () => {
      const client = new DelugeClient(createDownloader());

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
        json: async () => ({ result: 123, error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected successfully to Deluge");
    });

    it("logVersionInfo logs version when available", async () => {
      const client = new DelugeClient(createDownloader());

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

      await client.logVersionInfo();
      const { downloadersLogger } = await import("../logger.js");
      expect(downloadersLogger.info).toHaveBeenCalled();
    });

    it("logVersionInfo handles errors gracefully", async () => {
      const client = new DelugeClient(createDownloader());

      fetchMock.mockRejectedValueOnce(new Error("connect refused"));

      await client.logVersionInfo();
      const { downloadersLogger } = await import("../logger.js");
      expect(downloadersLogger.warn).toHaveBeenCalled();
    });
  });

  describe("ensureConnected edge cases", () => {
    it("throws when no hosts are configured", async () => {
      const client = new DelugeClient(createDownloader());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: false, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: [], error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain("No Deluge daemon hosts");
    });

    it("throws when daemon connection verification fails", async () => {
      const client = new DelugeClient(createDownloader());

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=abc123; Path=/" }),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: false, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: [["host-1", "127.0.0.1", 58846, "", ""]],
          error: null,
          id: 3,
        }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 4 }),
        headers: new Headers(),
      } as Response);

      // verification connected returns false
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: false, error: null, id: 5 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to connect");
    });
  });

  describe("addDownload edge cases", () => {
    it("returns error when URL is missing", async () => {
      const client = new DelugeClient(createDownloader());
      const result = await client.addDownload({ url: "", title: "Empty" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("required");
    });
  });

  describe("getAllDownloads edge cases", () => {
    it("returns empty array on error", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("network"));

      const result = await client.getAllDownloads();
      expect(result).toEqual([]);
    });

    it("handles null result from get_torrents_status", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.getAllDownloads();
      expect(result).toEqual([]);
    });
  });

  describe("getFreeSpace edge cases", () => {
    it("works when downloadPath is not set", async () => {
      const client = new DelugeClient(createDownloader({ downloadPath: null }));
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 5000, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.getFreeSpace();
      expect(result).toBe(5000);
    });
  });

  describe("cookie handling", () => {
    it("extracts and reuses session cookie", async () => {
      const client = new DelugeClient(createDownloader());

      // First call: auth login returns cookie
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=cookie123; Path=/; HttpOnly" }),
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

      // Second call: should reuse cookie (no auth/login fetch)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 4 }),
        headers: new Headers(),
      } as Response);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            hash1: {
              name: "Cached",
              state: "Seeding",
              progress: 100,
              download_payload_rate: 0,
              upload_payload_rate: 0,
              eta: 0,
              total_size: 1000,
              all_time_download: 1000,
              ratio: 1,
              num_peers: 0,
              num_seeds: 1,
              message: "",
            },
          },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const downloads = await client.getAllDownloads();
      expect(downloads).toHaveLength(1);

      // Should NOT have called auth.login again (only 1 extra fetch for get_torrents_status after testConnection)
      const authCalls = fetchMock.mock.calls.filter((call) => {
        const body = JSON.parse((call[1]?.body as string) || "{}") as Record<string, unknown>;
        return body.method === "auth.login";
      });
      expect(authCalls).toHaveLength(1);
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
