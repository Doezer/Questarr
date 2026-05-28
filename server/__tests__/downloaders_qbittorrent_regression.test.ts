import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader } from "../../shared/schema.js";
import { QBittorrentClient } from "../downloaders/qbittorrent.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn(),
  safeFetch: vi.fn((url: string, options?: RequestInit) => global.fetch(url, options)),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "dl-1",
    name: "Downloader",
    type: "qbittorrent",
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "admin",
    password: "password",
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

const emptyHeaders = {
  entries: () => [][Symbol.iterator](),
  get: () => null,
};

describe("qbittorrent regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("covers auth helpers, base URL normalization, and status mapping branches", async () => {
    const client = new QBittorrentClient(
      createDownloader({
        url: "qb.local/root/",
        port: 8080,
        useSsl: true,
        urlPath: "nested/",
      })
    ) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
      getBaseUrl(): string;
      mapQBittorrentStatus(torrent: Record<string, unknown>): Record<string, unknown>;
    };

    expect(client.getBaseUrl()).toBe("https://qb.local:8080/root/nested");

    const noAuthClient = new QBittorrentClient(
      createDownloader({
        username: null,
        password: null,
      } as Partial<Downloader>)
    ) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
    };
    await expect(noAuthClient.authenticate()).resolves.toBeUndefined();
    expect(noAuthClient.cookie).toBeNull();

    expect(
      client.mapQBittorrentStatus({
        hash: "hash-up",
        name: "Uploading",
        state: "forcedUP",
        progress: 0.5,
        dlspeed: 0,
        upspeed: 10,
        eta: 15,
        size: 100,
        downloaded: 50,
        ratio: 1.2,
        num_seeds: 5,
        num_leechs: 1,
      }).status
    ).toBe("seeding");

    expect(
      client.mapQBittorrentStatus({
        hash: "hash-complete",
        name: "Complete paused",
        state: "pausedDL",
        progress: 1,
        dlspeed: 0,
        upspeed: 0,
        eta: 0,
        size: 100,
        downloaded: 100,
        ratio: 1,
        num_seeds: 1,
        num_leechs: 0,
      }).status
    ).toBe("completed");

    expect(
      client.mapQBittorrentStatus({
        hash: "hash-error",
        name: "Broken",
        state: "missingFiles",
        progress: 0.1,
        dlspeed: 0,
        upspeed: 0,
        eta: 0,
        size: 100,
        downloaded: 10,
        ratio: 0,
        num_seeds: 0,
        num_leechs: 0,
      }).status
    ).toBe("error");
  });

  it("covers authentication success, fallback cookie parsing, and failure branches", async () => {
    const client = new QBittorrentClient(createDownloader()) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "Ok.",
      headers: {
        getSetCookie: () => [],
        get: (name: string) =>
          name.toLowerCase() === "set-cookie" ? "SID=fallback123; Path=/" : null,
      },
    } as Response);

    await client.authenticate(true);
    expect(client.cookie).toBe("SID=fallback123");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "Forbidden",
      headers: {
        getSetCookie: () => [],
        get: () => null,
      },
    } as Response);
    await expect(client.authenticate(true)).rejects.toThrow("Authentication failed: Forbidden");
    expect(client.cookie).toBeNull();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "Ok.",
      headers: {
        getSetCookie: () => [],
        get: () => null,
      },
    } as Response);
    await expect(client.authenticate(true)).resolves.toBeUndefined();
    expect(client.cookie).toBeNull();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "denied",
      headers: {
        getSetCookie: () => [],
        get: () => null,
      },
    } as Response);
    await expect(client.authenticate(true)).rejects.toThrow(
      "Authentication failed: 403 Forbidden - denied"
    );
  });

  it("covers status/detail/list/control branches", async () => {
    const client = new QBittorrentClient(createDownloader());
    const privateClient = client as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "hash-1",
            name: "Torrent",
            state: "downloading",
            progress: 0.5,
            dlspeed: 10,
            upspeed: 1,
            eta: 30,
            size: 100,
            downloaded: 50,
            ratio: 0.5,
            num_seeds: 2,
            num_leechs: 3,
          },
        ],
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "hash-2",
            name: "Missing props",
            state: "uploading",
            progress: 1,
            dlspeed: 0,
            upspeed: 10,
            eta: 0,
            size: 100,
            downloaded: 100,
            ratio: 2,
            num_seeds: 4,
            num_leechs: 0,
            save_path: "/downloads",
            category: "games",
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ addition_date: 0, completion_date: 0, peers_total: 5, peers: 2 }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "hash-3",
            name: "Error torrent",
            state: "error",
            progress: 0.1,
            dlspeed: 0,
            upspeed: 0,
            eta: 0,
            size: 100,
            downloaded: 10,
            ratio: 0,
            num_seeds: 0,
            num_leechs: 0,
          },
        ],
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(client.getDownloadStatus("hash-1")).resolves.toMatchObject({
      status: "downloading",
      progress: 50,
    });
    await expect(client.getDownloadStatus("missing")).resolves.toBeNull();
    await expect(client.getDownloadDetails("hash-2")).resolves.toMatchObject({
      hash: "hash-2",
      files: [],
      trackers: [],
      totalPeers: 5,
      connectedPeers: 2,
    });
    await expect(client.getAllDownloads()).resolves.toEqual([
      expect.objectContaining({ status: "error" }),
    ]);
    await expect(client.pauseDownload("hash-3")).resolves.toEqual({
      success: true,
      message: "Download paused successfully",
    });
    await expect(client.resumeDownload("hash-3")).resolves.toEqual({
      success: true,
      message: "Download resumed successfully",
    });
    await expect(client.removeDownload("hash-3", true)).resolves.toEqual({
      success: true,
      message: "Download removed successfully",
    });

    makeRequestSpy.mockRejectedValueOnce(new Error("status boom"));
    await expect(client.getDownloadStatus("boom")).resolves.toBeNull();
    makeRequestSpy.mockRejectedValueOnce(new Error("details boom"));
    await expect(client.getDownloadDetails("boom")).resolves.toBeNull();
    makeRequestSpy.mockRejectedValueOnce(new Error("list boom"));
    await expect(client.getAllDownloads()).resolves.toEqual([]);
    makeRequestSpy.mockRejectedValueOnce(new Error("pause boom"));
    await expect(client.pauseDownload("boom")).resolves.toEqual({
      success: false,
      message: "Failed to pause download: pause boom",
    });
    makeRequestSpy.mockRejectedValueOnce(new Error("resume boom"));
    await expect(client.resumeDownload("boom")).resolves.toEqual({
      success: false,
      message: "Failed to resume download: resume boom",
    });
    makeRequestSpy.mockRejectedValueOnce(new Error("remove boom"));
    await expect(client.removeDownload("boom")).resolves.toEqual({
      success: false,
      message: "Failed to remove download: remove boom",
    });
  });

  it("covers URL-add magnet branches and torrent-upload verification branches", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      _delay?: number,
      ...args: unknown[]
    ) => {
      if (typeof callback === "function") {
        callback(...args);
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const client = new QBittorrentClient(
      createDownloader({
        settings: JSON.stringify({ initialState: "force-started" }),
      })
    );
    const privateClient = client as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Fails.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ hash: "abcdef1234567890abcdef1234567890abcdef12" }],
      } as Response);

    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Duplicate magnet",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download already exists (qBittorrent)",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
    const missingMagnetPromise = client.addDownload({
      url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
      title: "Missing magnet",
    });
    await expect(missingMagnetPromise).resolves.toEqual({
      success: false,
      message: "Magnet link was accepted by qBittorrent but the torrent was not found afterwards",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "Nope",
      headers: emptyHeaders,
    } as Response);

    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Unexpected magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add magnet link: Nope",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-disposition"
            ? 'attachment; filename="questarr.torrent"'
            : null,
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response);

    const notFoundAfterUploadPromise = client.addDownload({
      url: "http://indexer.local/file.torrent?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
      title: "Upload not found",
    });
    await expect(notFoundAfterUploadPromise).resolves.toEqual({
      success: false,
      message: "Download was not added to qBittorrent (not found after adding)",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Fails.",
        headers: emptyHeaders,
      } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
    } as Response);

    await expect(
      client.addDownload({
        url: "http://indexer.local/file3.torrent",
        title: "Duplicate upload",
      })
    ).resolves.toEqual({
      success: true,
      message: "Download already exists or invalid download (qBittorrent)",
    });

    setTimeoutSpy.mockRestore();
  });

  it("covers qBittorrent recent-match success for non-magnet URL adds", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      _delay?: number,
      ...args: unknown[]
    ) => {
      if (typeof callback === "function") {
        callback(...args);
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const client = new QBittorrentClient(createDownloader());
    const privateClient = client as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "makeRequest")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "recent-hash",
            name: "Verified upload",
            added_on: Math.floor(Date.now() / 1000),
          },
        ],
      } as Response);

    await expect(
      client.addDownload({
        url: "http://indexer.local/file2.torrent",
        title: "Verified upload",
      })
    ).resolves.toEqual({
      success: true,
      id: "recent-hash",
      message: "Download added successfully",
    });

    setTimeoutSpy.mockRestore();
  });

  it("covers torrent-download failure, free-space fallbacks, and request error branches", async () => {
    const client = new QBittorrentClient(createDownloader());
    const privateClient = client as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
      getFreeSpace(): Promise<number>;
      makeRequestInternal?: unknown;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    makeRequestSpy.mockRejectedValueOnce(new Error("url add failed"));
    vi.mocked(safeFetch).mockRejectedValueOnce(
      Object.assign(new Error("fetch failed"), {
        cause: { code: "ECONNREFUSED", message: "refused" },
      })
    );
    await expect(
      client.addDownload({
        url: "http://indexer.local/fail.torrent",
        title: "Fetch failure",
      })
    ).resolves.toEqual({
      success: false,
      message:
        "Failed to download torrent file: fetch failed (ECONNREFUSED) - The indexer refused the connection. Check if Prowlarr/Jackett is running and the port is correct.",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ server_state: {} }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ free_space_on_disk: "NaN" }),
      } as Response);
    await expect(client.getFreeSpace()).resolves.toBe(0);

    makeRequestSpy.mockRejectedValueOnce(new Error("prefs boom"));
    await expect(client.getFreeSpace()).resolves.toBe(0);

    const rawClient = new QBittorrentClient(createDownloader()) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };
    rawClient.cookie = "SID=old";
    const authenticateSpy = vi.spyOn(rawClient, "authenticate").mockImplementation(async () => {
      rawClient.cookie = "SID=new";
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "expired",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Offline",
        text: async () => "still bad",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: async () => "boom",
      } as Response);

    await expect(rawClient.makeRequest("GET", "/api/v2/fail")).rejects.toThrow(
      "HTTP 503: Offline - still bad"
    );
    await expect(rawClient.makeRequest("GET", "/api/v2/direct-fail")).rejects.toThrow(
      "HTTP 500: Server Error - boom"
    );
    expect(authenticateSpy).toHaveBeenCalledWith(true);
  });
});
