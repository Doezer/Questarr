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
    id: "deluge-cov",
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

function setupAuthAndConnect() {
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
}

describe("DelugeClient — coverage gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
    vi.mocked(fetchWithMagnetDetection).mockReset();
  });

  describe("getBaseUrl — invalid URL fallback (line 106)", () => {
    it("falls back to raw URL when URL parsing fails", async () => {
      // "http://[invalid" causes new URL() to throw → line 106 executes
      const client = new DelugeClient(createDownloader({ url: "http://[invalid" }));

      setupAuthAndConnect();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.0.0", error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });
  });

  describe("addDownload — options (lines 249, 252)", () => {
    it("includes download_location and add_paused when set", async () => {
      const client = new DelugeClient(
        createDownloader({ downloadPath: "/mnt/downloads", addStopped: true })
      );

      setupAuthAndConnect();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "abcdef1234567890abcdef1234567890abcdef12",
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Test",
      });

      expect(result.success).toBe(true);
      const addCall = fetchMock.mock.calls.find((c) => {
        const body = JSON.parse((c[1]?.body as string) || "{}") as { method?: string };
        return body.method === "core.add_torrent_magnet";
      });
      const body = JSON.parse((addCall?.[1]?.body as string) || "{}") as {
        params?: [string, Record<string, unknown>];
      };
      expect(body.params?.[1]?.download_location).toBe("/mnt/downloads");
      expect(body.params?.[1]?.add_paused).toBe(true);
    });
  });

  describe("addDownload — label application (lines 231-240)", () => {
    it("applies label after successful add and warns when label.set_torrent fails", async () => {
      const client = new DelugeClient(createDownloader({ category: "games" }));

      setupAuthAndConnect();

      // core.add_torrent_magnet succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "aabbcc1234567890abcdef1234567890abcdef12",
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      // label.add succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null }),
        headers: new Headers(),
      } as Response);

      // label.set_torrent throws an RPC error
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: { message: "No such method", code: 2 } }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:aabbcc1234567890abcdef1234567890abcdef12",
        title: "Labeled Torrent",
      });

      expect(result.success).toBe(true);
      const { downloadersLogger } = await import("../logger.js");
      expect(downloadersLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ category: "games" }),
        "Failed to apply Deluge label"
      );
    });

    it("silently ignores label.add failure (label already exists)", async () => {
      const client = new DelugeClient(createDownloader({ category: "games" }));

      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "aabbcc1234567890abcdef1234567890abcdef12",
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      // label.add fails (already exists)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: { message: "Label already exists", code: 1 } }),
        headers: new Headers(),
      } as Response);

      // label.set_torrent succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:aabbcc1234567890abcdef1234567890abcdef12",
        title: "Labeled Torrent",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("addDownload — non-ok torrent response (lines 305-307)", () => {
    it("throws when torrent download returns non-ok response", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: false,
          status: 404,
          statusText: "Not Found",
          headers: { get: () => null },
        } as unknown as Response,
      });

      // Fallback: core.add_torrent_url
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "deadbeef1234567890abcdef1234567890abcdef",
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "404 Torrent",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("via URL");
    });
  });

  describe("addDownload — content-disposition filename (lines 312-314)", () => {
    it("uses filename from content-disposition header", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: {
            get: (h: string) =>
              h === "content-disposition" ? 'attachment; filename="mygame.torrent"' : null,
          },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response,
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "cafebabe1234567890abcdef1234567890abcdef",
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "http://indexer.local/download?id=123",
        title: "My Game",
      });

      expect(result.success).toBe(true);
      const addFileCall = fetchMock.mock.calls.find((c) => {
        const body = JSON.parse((c[1]?.body as string) || "{}") as { method?: string };
        return body.method === "core.add_torrent_file";
      });
      const body = JSON.parse((addFileCall?.[1]?.body as string) || "{}") as {
        params?: [string];
      };
      expect(body.params?.[0]).toBe("mygame.torrent");
    });
  });

  describe("addDownload — URL fallback null with hash (lines 343-357)", () => {
    it("verifies existing torrent by hash in URL fallback path", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockRejectedValueOnce(new Error("download failed"));

      // core.add_torrent_url returns null
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      // core.get_torrent_status verifies the torrent exists
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { name: "Existing Game" },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      // URL contains the btih hash so extractHashFromUrl can find it
      const result = await client.addDownload({
        url: "http://indexer.local/dl?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Existing",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
    });

    it("returns failure when URL fallback null and no hash in URL", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockRejectedValueOnce(new Error("download failed"));

      // core.add_torrent_url returns null, URL has no extractable hash
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const result = await client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "No Hash",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("addDownload — file add null with hash match (lines 380-396)", () => {
    it("verifies existing torrent by hash when add_torrent_file returns null", async () => {
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response,
      });

      // core.add_torrent_file returns null
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      // core.get_torrent_status confirms torrent exists
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { name: "Existing" },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      // URL contains the btih hash so extractHashFromUrl can find it
      const result = await client.addDownload({
        url: "http://indexer.local/dl?xt=urn:btih:deadbeef1234567890abcdef1234567890abcdef",
        title: "Existing File",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
    });

    it("returns failure when add_torrent_file null, no hash, and no recent download", async () => {
      vi.useFakeTimers();
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response,
      });

      // core.add_torrent_file returns null
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      // findRecentlyAddedDownload → no results
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: {}, error: null }),
        headers: new Headers(),
      } as Response);

      const addPromise = client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Nothing",
      });

      await vi.advanceTimersByTimeAsync(1200);
      const result = await addPromise;
      vi.useRealTimers();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to add download to Deluge");
    });
  });

  describe("findRecentlyAddedDownload — edge cases (lines 431, 433-434)", () => {
    it("returns null when most recent torrent was added more than 10s ago", async () => {
      vi.useFakeTimers();
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response,
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      const oldTime = Math.floor(Date.now() / 1000) - 60;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { oldhash: { name: "Old Torrent", time_added: oldTime } },
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const addPromise = client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Old",
      });

      await vi.advanceTimersByTimeAsync(1200);
      const result = await addPromise;
      vi.useRealTimers();

      expect(result.success).toBe(false);
    });

    it("handles exception in findRecentlyAddedDownload gracefully", async () => {
      vi.useFakeTimers();
      const client = new DelugeClient(createDownloader());

      setupAuthAndConnect();

      vi.mocked(fetchWithMagnetDetection).mockResolvedValueOnce({
        response: {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response,
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: null }),
        headers: new Headers(),
      } as Response);

      // get_torrents_status throws
      fetchMock.mockRejectedValueOnce(new Error("network failure in findRecent"));

      const addPromise = client.addDownload({
        url: "http://indexer.local/file.torrent",
        title: "Error Recovery",
      });

      await vi.advanceTimersByTimeAsync(1200);
      const result = await addPromise;
      vi.useRealTimers();

      expect(result.success).toBe(false);
    });
  });

  describe("getDownloadDetails — tracker status branches (lines 543, 547, 551)", () => {
    const makeTrackerResponse = (trackers: object[]) => ({
      ok: true,
      json: async () => ({
        result: {
          name: "Tracker Test",
          state: "Seeding",
          progress: 100,
          download_payload_rate: 0,
          upload_payload_rate: 0,
          eta: 0,
          total_size: 1000,
          all_time_download: 1000,
          all_time_upload: 500,
          ratio: 1,
          num_peers: 0,
          num_seeds: 3,
          save_path: "/downloads",
          time_added: 1700000000,
          completed_time: 1700001000,
          files: [],
          file_priorities: [],
          file_progress: [],
          trackers,
          tracker_status: "OK",
          message: "",
          label: "",
        },
        error: null,
      }),
      headers: new Headers(),
    });

    it("maps send_stats=false to inactive tracker status (line 543)", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce(
        makeTrackerResponse([{ url: "udp://t1.example.com:6969", tier: 0, send_stats: false }])
      );

      const details = await client.getDownloadDetails("hash1");
      expect(details?.trackers?.[0]?.status).toBe("inactive");
    });

    it("maps last_error.value to error tracker status (line 547)", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce(
        makeTrackerResponse([
          {
            url: "udp://t2.example.com:6969",
            tier: 0,
            send_stats: true,
            last_error: { category: "http", value: "Connection timed out" },
            fails: 0,
            verified: false,
          },
        ])
      );

      const details = await client.getDownloadDetails("hash2");
      expect(details?.trackers?.[0]?.status).toBe("error");
    });

    it("maps fails>0 to error tracker status (line 547)", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce(
        makeTrackerResponse([
          {
            url: "udp://t3.example.com:6969",
            tier: 0,
            send_stats: true,
            fails: 3,
            verified: false,
          },
        ])
      );

      const details = await client.getDownloadDetails("hash3");
      expect(details?.trackers?.[0]?.status).toBe("error");
    });

    it("maps verified=true to working tracker status (line 551)", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce(
        makeTrackerResponse([
          {
            url: "udp://t4.example.com:6969",
            tier: 1,
            send_stats: true,
            fails: 0,
            verified: true,
          },
        ])
      );

      const details = await client.getDownloadDetails("hash4");
      expect(details?.trackers?.[0]?.status).toBe("working");
    });

    it("maps unverified non-error tracker to updating status (line 551 else)", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockResolvedValueOnce(
        makeTrackerResponse([
          {
            url: "udp://t5.example.com:6969",
            tier: 0,
            send_stats: true,
            fails: 0,
            verified: false,
          },
        ])
      );

      const details = await client.getDownloadDetails("hash5");
      expect(details?.trackers?.[0]?.status).toBe("updating");
    });
  });

  describe("getDownloadDetails — error path (lines 580-581)", () => {
    it("returns null on exception", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("network failure"));

      const result = await client.getDownloadDetails("hashX");
      expect(result).toBeNull();
    });
  });

  describe("resumeDownload — error path (lines 638-639)", () => {
    it("returns failure message on error", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("timeout"));

      const result = await client.resumeDownload("hashY");
      expect(result.success).toBe(false);
      expect(result.message).toContain("timeout");
    });
  });

  describe("removeDownload — error path (lines 653-654)", () => {
    it("returns failure message on error", async () => {
      const client = new DelugeClient(createDownloader());
      setupAuthAndConnect();

      fetchMock.mockRejectedValueOnce(new Error("RPC error"));

      const result = await client.removeDownload("hashZ");
      expect(result.success).toBe(false);
      expect(result.message).toContain("RPC error");
    });
  });

  describe("401 cookie clearing", () => {
    it("clears cookie on 401 so next request re-authenticates", async () => {
      const client = new DelugeClient(createDownloader());

      // First successful auth
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "_session_id=expiredcookie; Path=/" }),
      } as Response);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.0", error: null }),
        headers: new Headers(),
      } as Response);

      await client.testConnection();

      // Next call: 401 → cookie should be cleared
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Session expired",
        headers: new Headers(),
      } as Response);

      const result = await client.getDownloadStatus("hashA");
      expect(result).toBeNull();

      // Next call: re-authentication should be attempted (auth.login called again)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null }),
        headers: new Headers({ "set-cookie": "_session_id=newcookie; Path=/" }),
      } as Response);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null }),
        headers: new Headers(),
      } as Response);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            name: "Test",
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
          error: null,
        }),
        headers: new Headers(),
      } as Response);

      const result2 = await client.getDownloadStatus("hashA");
      expect(result2).not.toBeNull();

      const authCalls = fetchMock.mock.calls.filter((c) => {
        const body = JSON.parse((c[1]?.body as string) || "{}") as { method?: string };
        return body.method === "auth.login";
      });
      expect(authCalls.length).toBe(2);
    });
  });

  describe("makeRequest — cookie fallback (line 783)", () => {
    it("extracts first cookie when no _session_id cookie is present", async () => {
      const client = new DelugeClient(createDownloader());

      // auth.login returns a non-_session_id cookie (e.g. from a reverse proxy)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": "proxy_session=xyz789; Path=/" }),
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
        json: async () => ({ result: "2.0.0", error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });

    it("does not set cookie when Set-Cookie header contains no extractable value", async () => {
      const client = new DelugeClient(createDownloader());

      // Both regexes return null when the cookie header is just ";" (no name=value before it)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 1 }),
        headers: new Headers({ "set-cookie": ";" }),
      } as Response);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true, error: null, id: 2 }),
        headers: new Headers(),
      } as Response);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "2.0.0", error: null, id: 3 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });
  });

  describe("makeRequest — RPC error without message (line 826)", () => {
    it("falls back to generic RPC error when error object has no message", async () => {
      const client = new DelugeClient(createDownloader());

      // auth.login returns an error object with no message field
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null, error: { code: 99 }, id: 1 }),
        headers: new Headers(),
      } as Response);

      const result = await client.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Deluge RPC error");
    });
  });
});
