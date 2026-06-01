import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";

const fetchMock = vi.fn();
const parseTorrentMock = vi.fn();
const fetchWithMagnetDetectionMock = vi.fn();

vi.mock("parse-torrent", () => ({
  default: parseTorrentMock,
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
  safeFetch: vi.fn(),
}));

vi.mock("../downloaders/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../downloaders/utils.js")>();
  return {
    ...actual,
    fetchWithMagnetDetection: fetchWithMagnetDetectionMock,
  };
});

global.fetch = fetchMock as unknown as typeof fetch;

const { isSafeUrl } = await import("../ssrf.js");
const { QBittorrentClient } = await import("../downloaders/qbittorrent.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "qb-remaining",
    name: "qBittorrent",
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

describe("qbittorrent remaining regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    parseTorrentMock.mockReset();
    fetchWithMagnetDetectionMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("covers auth, base URL, free space, status, and detail edge branches", async () => {
    const fallbackUrlClient = new QBittorrentClient(
      createDownloader({ url: "http://:8080" })
    ) as unknown as {
      getBaseUrl(): string;
    };
    expect(fallbackUrlClient.getBaseUrl()).toBe("http://http//:8080");

    const authClient = new QBittorrentClient(createDownloader()) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
      mapQBittorrentStatus(torrent: Record<string, unknown>): { status: string };
    };

    authClient.cookie = "SID=existing";
    await expect(authClient.authenticate()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Offline",
      text: async () => "denied",
      headers: {
        getSetCookie: () => [],
        get: () => null,
      },
    } as Response);
    await expect(authClient.authenticate(true)).rejects.toThrow(
      "Authentication failed: 503 Offline - denied"
    );

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

    vi.spyOn(authClient, "authenticate").mockImplementation(async (force?: boolean) => {
      if (force) {
        authClient.cookie = "SID=new";
      }
    });
    authClient.cookie = "SID=old";

    await expect(authClient.makeRequest("GET", "/api/v2/fail")).rejects.toThrow(
      "HTTP 503: Offline - still bad"
    );
    await expect(authClient.makeRequest("GET", "/api/v2/direct-fail")).rejects.toThrow(
      "HTTP 500: Server Error - boom"
    );

    expect(
      authClient.mapQBittorrentStatus({
        hash: "stopped-up",
        name: "Stopped upload",
        state: "stoppedUP",
        progress: 1,
        dlspeed: 0,
        upspeed: 0,
        eta: 0,
        size: 1,
        downloaded: 1,
        ratio: 1,
        num_seeds: 0,
        num_leechs: 0,
      }).status
    ).toBe("completed");

    expect(
      authClient.mapQBittorrentStatus({
        hash: "done-downloading",
        name: "Done downloading",
        state: "downloading",
        progress: 1,
        dlspeed: 0,
        upspeed: 5,
        eta: 0,
        size: 1,
        downloaded: 1,
        ratio: 1,
        num_seeds: 1,
        num_leechs: 0,
      }).status
    ).toBe("seeding");

    const client = new QBittorrentClient(createDownloader({ downloadPath: "C:\\Downloads" }));
    const privateClient = client as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
      getFreeSpace(): Promise<number>;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ save_path: "C:\\Downloads" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ free_space_on_disk: 123 }),
      } as Response);
    await expect(client.getFreeSpace()).resolves.toBe(123);

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ save_path: "C:\\Downloads" }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ server_state: { free_space_on_disk: 234 } }),
      } as Response);
    await expect(client.getFreeSpace()).resolves.toBe(234);

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ save_path: "C:\\Downloads" }),
      } as Response)
      .mockRejectedValueOnce(new Error("no app/free_space"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ server_state: {} }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ free_space_on_disk: 456 }),
      } as Response);
    await expect(client.getFreeSpace()).resolves.toBe(456);

    makeRequestSpy.mockReset();
    vi.spyOn(privateClient, "authenticate").mockRejectedValueOnce(new Error("auth boom"));
    await expect(client.getFreeSpace()).resolves.toBe(0);

    const detailsClient = new QBittorrentClient(createDownloader());
    const detailsPrivate = detailsClient as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    vi.spyOn(detailsPrivate, "authenticate").mockResolvedValue(undefined);
    const detailsSpy = vi.spyOn(detailsPrivate, "makeRequest");

    detailsSpy.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
    await expect(detailsClient.getDownloadDetails("missing")).resolves.toBeNull();

    detailsSpy.mockReset();
    detailsSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "hash-1",
            name: "Tracked",
            state: "uploading",
            progress: 1,
            dlspeed: 0,
            upspeed: 1,
            eta: 0,
            size: 100,
            downloaded: 100,
            ratio: 1,
            num_seeds: 1,
            num_leechs: 0,
            save_path: "/downloads",
            num_complete: 5,
            num_incomplete: 2,
            category: "games",
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ addition_date: 1, completion_date: 2, peers_total: 5, peers: 2 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "off.bin", size: 10, progress: 0.5, priority: 0 },
          { name: "high.bin", size: 20, progress: 1, priority: 6 },
          { name: "normal.bin", size: 30, progress: 1, priority: 1 },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            url: "udp://tracker-working",
            tier: 0,
            status: 2,
            num_seeds: 1,
            num_leeches: 2,
            msg: "",
          },
          {
            url: "udp://tracker-error",
            tier: 1,
            status: 3,
            num_seeds: 0,
            num_leeches: 0,
            msg: "bad",
          },
          {
            url: "udp://tracker-updating",
            tier: 2,
            status: 1,
            num_seeds: 3,
            num_leeches: 4,
            msg: "",
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "hash-unknown",
            name: "Unknown state",
            state: "mystery",
            progress: 0.2,
            dlspeed: 0,
            upspeed: 0,
            eta: 0,
            size: 10,
            downloaded: 2,
            ratio: 0,
            num_seeds: 0,
            num_leechs: 0,
          },
        ],
      } as Response);

    await expect(detailsClient.getDownloadDetails("hash-1")).resolves.toMatchObject({
      files: [
        expect.objectContaining({ priority: "off" }),
        expect.objectContaining({ priority: "high" }),
        expect.objectContaining({ priority: "normal" }),
      ],
      trackers: [
        expect.objectContaining({ status: "working" }),
        expect.objectContaining({ status: "error" }),
        expect.objectContaining({ status: "updating" }),
      ],
    });
    await expect(detailsClient.getAllDownloads()).resolves.toEqual([
      expect.objectContaining({ status: "paused" }),
    ]);

    detailsSpy.mockReset();
    detailsSpy.mockResolvedValueOnce({ ok: true, json: async () => null } as Response);
    await expect(detailsClient.getAllDownloads()).resolves.toEqual([]);
  });

  it("covers testConnection, early addDownload guards, cookie extraction, and raw request branches", async () => {
    const guardedClient = new QBittorrentClient(createDownloader());
    const guardedPrivate = guardedClient as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    vi.spyOn(guardedPrivate, "authenticate").mockResolvedValue(undefined);
    vi.spyOn(guardedPrivate, "makeRequest")
      .mockResolvedValueOnce({ text: async () => "4.6.0" } as Response)
      .mockRejectedValueOnce(new Error("offline"));

    await expect(guardedClient.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected successfully to qBittorrent 4.6.0",
    });
    await expect(guardedClient.testConnection()).resolves.toEqual({
      success: false,
      message: "Failed to connect to qBittorrent: offline",
    });

    await expect(guardedClient.addDownload({ url: "", title: "Missing URL" })).resolves.toEqual({
      success: false,
      message: "Download URL is required",
    });

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      guardedClient.addDownload({ url: "http://unsafe.local/file.torrent", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.torrent",
    });

    const cookieClient = new QBittorrentClient(createDownloader()) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "Ok.",
      headers: {
        getSetCookie: () => ["QBT_SID_special=abc123; Path=/"],
        get: () => null,
      },
    } as Response);
    await expect(cookieClient.authenticate(true)).resolves.toBeUndefined();
    expect(cookieClient.cookie).toBe("QBT_SID_special=abc123");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Offline",
      text: async () => {
        throw new Error("no text");
      },
      headers: {
        getSetCookie: () => [],
        get: () => null,
      },
    } as Response);
    await expect(cookieClient.authenticate(true)).rejects.toThrow(
      "Authentication failed: 503 Offline - No error details available"
    );

    const postClient = new QBittorrentClient(createDownloader()) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    postClient.cookie = "SID=current";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "ok",
    } as Response);
    await expect(
      postClient.makeRequest("POST", "/api/v2/post", Buffer.from([1, 2, 3]))
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ Cookie: "SID=current" }),
      body: expect.any(Uint8Array),
    });

    const reauthClient = new QBittorrentClient(createDownloader()) as unknown as {
      cookie: string | null;
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };
    reauthClient.cookie = "SID=old";
    vi.spyOn(reauthClient, "authenticate").mockImplementation(async (force?: boolean) => {
      if (force) {
        reauthClient.cookie = "SID=new";
      }
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
        text: async () => {
          throw new Error("still bad");
        },
      } as Response);
    await expect(reauthClient.makeRequest("GET", "/api/v2/fail")).rejects.toThrow(
      "HTTP 503: Offline - No error details available"
    );

    const directFailClient = new QBittorrentClient(createDownloader()) as unknown as {
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => {
        throw new Error("boom");
      },
    } as Response);
    await expect(directFailClient.makeRequest("GET", "/api/v2/direct-fail")).rejects.toThrow(
      "HTTP 500: Server Error - No error details available"
    );
  });

  it("covers recent-match, malformed magnet, savepath, and force-start warning branches", async () => {
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
        settings: "{",
        downloadPath: "C:\\Downloads",
        category: "games",
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
        json: async () => [{ hash: "recent-hash", added_on: Math.floor(Date.now() / 1000) - 1 }],
      } as Response);

    await expect(
      client.addDownload({
        url: "http://indexer.local/recent.torrent",
        title: "Recent title",
      })
    ).resolves.toEqual({
      success: true,
      id: "recent-hash",
      message: "Download already exists (qBittorrent)",
    });

    expect(makeRequestSpy.mock.calls[0]?.[2]).toContain("savepath=");
    expect(makeRequestSpy.mock.calls[0]?.[2]).toContain("category=games");

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

    await expect(
      client.addDownload({
        url: "magnet:?dn=nohash",
        title: "Malformed magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add magnet link to qBittorrent",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy.mockRejectedValueOnce("boom");
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Thrown magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add magnet link: Unknown error",
    });

    const forceStartedClient = new QBittorrentClient(
      createDownloader({
        settings: JSON.stringify({ initialState: "force-started" }),
      })
    );
    const forceStartedPrivate = forceStartedClient as unknown as {
      authenticate(force?: boolean): Promise<void>;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
    };

    vi.spyOn(forceStartedPrivate, "authenticate").mockResolvedValue(undefined);
    const forceStartedSpy = vi.spyOn(forceStartedPrivate, "makeRequest");
    forceStartedSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ hash: "force-hash", name: "Force" }],
      } as Response)
      .mockRejectedValueOnce(new Error("setForceStart failed"));

    await expect(
      forceStartedClient.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Force started",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    setTimeoutSpy.mockRestore();
  });

  it("covers redirected magnet recursion and fallback download errors", async () => {
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
      .mockRejectedValueOnce(new Error("url add failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ hash: "abcdef1234567890abcdef1234567890abcdef12" }],
      } as Response);
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      magnetLink: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/redirect.torrent",
        title: "Redirected magnet",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy.mockRejectedValueOnce(new Error("url add failed"));
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      magnetLink: "magnet:?dn=nohash",
    });
    await expect(
      client.addDownload({
        url: "http://indexer.local/invalid-redirect.torrent",
        title: "Invalid redirected magnet",
      })
    ).resolves.toEqual({
      success: false,
      message:
        "Failed to download torrent file: Could not extract hash from redirected magnet link",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy.mockRejectedValueOnce(new Error("url add failed"));
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response,
    });
    await expect(
      client.addDownload({
        url: "http://indexer.local/missing.torrent",
        title: "Missing torrent",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to download torrent file: Failed to download torrent: 404 Not Found",
    });
  });

  it("treats structured qBittorrent URL-add acceptance as success without fallback", async () => {
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
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        text: async () =>
          '{"added_torrent_ids":[],"failure_count":0,"pending_count":1,"success_count":0}',
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

    await expect(
      client.addDownload({
        url: "http://indexer.local/proxied.torrent",
        title: "Structured acceptance",
      })
    ).resolves.toEqual({
      success: true,
      message: "Download accepted by qBittorrent but could not be verified immediately",
    });

    expect(fetchWithMagnetDetectionMock).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it("treats qBittorrent magnet 409 conflicts as duplicates", async () => {
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
      .mockRejectedValueOnce(new Error("HTTP 409: Conflict - Conflict"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ hash: "abcdef1234567890abcdef1234567890abcdef12" }],
      } as Response);

    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Duplicate magnet conflict",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download already exists (qBittorrent)",
    });
  });

  it("covers upload hash recovery, verification, unexpected responses, and upload errors", async () => {
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
        downloadPath: "C:\\Uploads",
        category: "games",
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
        text: async () => "Weird",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ hash: "recent-upload", name: "Recent Upload" }],
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    parseTorrentMock.mockResolvedValueOnce({});
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as Response,
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/upload-recent.torrent",
        title: "Recent Upload",
      })
    ).resolves.toEqual({
      success: true,
      id: "recent-upload",
      message: "Download added successfully",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Weird",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);
    parseTorrentMock.mockResolvedValueOnce({});
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      } as Response,
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/upload-unknown.torrent",
        title: "Unknown Upload",
      })
    ).resolves.toEqual({
      success: true,
      id: "Unknown Upload",
      message: "Download added but hash could not be verified",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Weird",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: "Parsed Upload" }],
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    parseTorrentMock.mockResolvedValueOnce({
      infoHash: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        headers: { get: () => 'attachment; filename="parsed.torrent"' },
        arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
      } as Response,
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/upload-verified.torrent",
        title: "Parsed Upload",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    const uploadBody = makeRequestSpy.mock.calls[1]?.[2];
    expect(Buffer.isBuffer(uploadBody)).toBe(true);
    expect((uploadBody as Buffer).toString("utf8")).toContain('name="savepath"');
    expect((uploadBody as Buffer).toString("utf8")).toContain('name="category"');

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Weird",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Still weird",
        headers: emptyHeaders,
      } as Response);
    parseTorrentMock.mockResolvedValueOnce({});
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([10, 11, 12]).buffer,
      } as Response,
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/upload-weird.torrent",
        title: "Weird Upload",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download: Still weird",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockRejectedValueOnce(new Error("url add failed"))
      .mockRejectedValueOnce(new Error("upload exploded"));
    parseTorrentMock.mockResolvedValueOnce({});
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([13, 14, 15]).buffer,
      } as Response,
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/upload-error.torrent",
        title: "Broken Upload",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download: upload exploded",
    });

    setTimeoutSpy.mockRestore();
  });
});
