import { describe, it, expect, vi, beforeEach } from "vitest";
import { Downloader } from "../../shared/schema";
import { safeFetch } from "../ssrf.js";
import { downloadersLogger } from "../logger.js";
import {
  TransmissionClient,
  RTorrentClient,
  QBittorrentClient,
  SynologyDownloadStationClient,
} from "../downloaders.js";

const { parseTorrentMock } = vi.hoisted(() => ({
  parseTorrentMock: vi.fn().mockResolvedValue({ infoHash: "abc123def456" }),
}));

vi.mock("parse-torrent", () => ({
  default: parseTorrentMock,
}));

// Mock dependencies
vi.mock("../logger.js", () => {
  const mockChildLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    logger: {
      child: vi.fn(() => mockChildLogger),
    },
    igdbLogger: mockChildLogger,
    routesLogger: mockChildLogger,
    expressLogger: mockChildLogger,
    downloadersLogger: mockChildLogger,
    torznabLogger: mockChildLogger,
    searchLogger: mockChildLogger,
  };
});

// Mock ssrf check to allow all URLs in tests
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn(),
}));

// Mock parse-torrent so rTorrent tests get a deterministic infoHash
vi.mock("parse-torrent", () => ({
  default: vi.fn().mockResolvedValue({ infoHash: "abc123def456abc123def456abc123def456abc1" }),
}));

const mockTimestamp = new Date("2024-01-01T00:00:00.000Z");

function createMockDownloader(
  overrides: Pick<Downloader, "id" | "name" | "type" | "url" | "port"> & Partial<Downloader>
): Downloader {
  return {
    enabled: true,
    priority: 1,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    useSsl: false,
    urlPath: null,
    username: "user",
    password: "password",
    category: null,
    downloadDir: null,
    downloadPath: "/downloads",
    label: "tv",
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    ...overrides,
  };
}

function setupClientTest<T>(createClient: () => T) {
  vi.clearAllMocks();
  const fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.mocked(safeFetch).mockImplementation((url, options) =>
    Promise.resolve(fetchMock(url, options) as Awaited<ReturnType<typeof safeFetch>>)
  );
  return { fetchMock, client: createClient() };
}

describe("TransmissionClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: TransmissionClient;

  const mockDownloader = createMockDownloader({
    id: "trans-1",
    name: "Test Transmission",
    type: "transmission",
    url: "http://transmission:9091",
    port: 9091,
    urlPath: "/transmission/rpc",
  });

  beforeEach(() => {
    ({ fetchMock, client } = setupClientTest(() => new TransmissionClient(mockDownloader)));
  });

  describe("testConnection", () => {
    it("should return success on valid session-get response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: { "session-id": "12345", version: "4.0.6", "rpc-version": 17 },
        }),
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected successfully to Transmission 4.0.6");
    });

    it("should handle authentication failure", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
        headers: { get: () => null },
      });

      const result = await client.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Authentication failed");
    });

    it("should log version info from session-get", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            version: "4.0.6",
            "rpc-version": 17,
            "rpc-version-minimum": 1,
          },
        }),
      });

      await client.logVersionInfo();

      expect(downloadersLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          downloaderId: "trans-1",
          downloaderType: "transmission",
          version: "4.0.6",
          rpcVersion: 17,
          rpcVersionMinimum: 1,
        }),
        "Downloader version probe completed"
      );
    });
  });

  describe("addDownload", () => {
    it("should add magnet link successfully", async () => {
      // Mock torrent-add success response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            "torrent-added": {
              id: 1,
              name: "Test Release",
              hashString: "hash123",
            },
          },
        }),
      });

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:hash123",
        title: "Test Release",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("hash123");
    });

    it("should handle duplicates", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            "torrent-duplicate": {
              id: 1,
              name: "Test Release",
              hashString: "hash123",
            },
          },
        }),
      });

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:hash123",
        title: "Test Release",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("already exists");
    });

    it("should fallback to local download for non-magnet URLs", async () => {
      // 1. Mock local download
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10), // dummy content
      });

      // 2. Mock torrent-add response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            "torrent-added": {
              id: 2,
              name: "File Release",
              hashString: "filehash",
            },
          },
        }),
      });

      const result = await client.addDownload({
        url: "http://indexer.com/release.torrent",
        title: "File Release",
      });

      // Verify local download was attempted
      expect(fetchMock.mock.calls[0][0]).toBe("http://indexer.com/release.torrent");

      // Verify Transmission add was called with metainfo (base64)
      const transCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(transCallBody.method).toBe("torrent-add");
      expect(transCallBody.arguments.metainfo).toBeDefined();

      expect(result.success).toBe(true);
      expect(result.id).toBe("filehash");
    });

    it("should include detailed Transmission RPC error in failure message", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "invalid or corrupt torrent file",
          arguments: {},
        }),
      });

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:hash123",
        title: "Test Release",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Failed to add download: invalid or corrupt torrent file");
    });

    it("should not expose non-string Transmission RPC error payloads", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { error: "bad request" },
          arguments: {},
        }),
      });

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:hash123",
        title: "Test Release",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Failed to add download");
    });
  });

  describe("getDownloadStatus", () => {
    it("should map status correctly", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            torrents: [
              {
                id: 1,
                name: "Test Linux ISO",
                status: 4, // downloading
                percentDone: 0.5,
                rateDownload: 1024,
                rateUpload: 0,
                eta: 60,
                totalSize: 1000,
                downloadedEver: 500,
                peersSendingToUs: 5,
                peersGettingFromUs: 0,
                uploadRatio: 0,
                errorString: "",
              },
            ],
          },
        }),
      });

      const status = await client.getDownloadStatus("1");

      expect(status).not.toBeNull();
      expect(status?.status).toBe("downloading");
      expect(status?.progress).toBe(50);
      expect(status?.downloadSpeed).toBe(1024);
    });

    it("should query Transmission using hash IDs without coercing them", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: { torrents: [] },
        }),
      });

      await client.getDownloadStatus("hash123");

      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(requestBody.arguments.ids).toEqual(["hash123"]);
    });
  });
});

describe("RTorrentClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: RTorrentClient;

  const mockDownloader = createMockDownloader({
    id: "rtorrent-1",
    name: "Test rTorrent",
    type: "rtorrent",
    url: "http://rtorrent:8080",
    port: 8080,
    urlPath: "/RPC2",
  });

  beforeEach(() => {
    ({ fetchMock, client } = setupClientTest(() => new RTorrentClient(mockDownloader)));
  });

  describe("testConnection", () => {
    it("should return success on valid system.client_version response", async () => {
      // Mock XML-RPC response for system.client_version
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<?xml version="1.0"?><methodResponse><params><param><value><string>0.9.8</string></value></param></params></methodResponse>`,
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toContain("Connected to rTorrent v0.9.8");
    });
  });

  describe("addDownload", () => {
    it("should add download with downloadPath and category", async () => {
      // Mock for torrent download
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

      // Mock for load.raw_start (add torrent with inline commands)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<?xml version="1.0"?><methodResponse><params><param><value><int>0</int></value></param></params></methodResponse>`,
      });

      const clientWithCategory = new RTorrentClient({
        ...mockDownloader,
        category: "games",
      });

      const result = await clientWithCategory.addDownload({
        url: "http://indexer.com/release.torrent",
        title: "Test Release",
        category: "games",
        downloadPath: "/downloads",
      });

      expect(result.success).toBe(true);
      // Inline commands: only 2 fetch calls (torrent download + load.raw_start)
      expect(fetchMock.mock.calls.length).toBe(2);

      // rTorrent handles categories natively via d.custom1.set — the path must NOT
      // have the category appended (that would cause double-nesting /path/cat/cat).
      // Both commands are passed inline to load.raw_start.
      const addTorrentBody = fetchMock.mock.calls[1][1].body;
      expect(addTorrentBody).toContain("d.custom1.set=games");
      expect(addTorrentBody).toContain("d.directory.set=/downloads");
      expect(addTorrentBody).not.toContain("/downloads/games");
    });

    it("should add download with downloadPath only (no category)", async () => {
      // Mock for torrent download
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

      // Mock for load.raw_start (add torrent with inline directory command)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<?xml version="1.0"?><methodResponse><params><param><value><int>0</int></value></param></params></methodResponse>`,
      });

      const result = await client.addDownload({
        url: "http://indexer.com/release.torrent",
        title: "Test Release",
        downloadPath: "/downloads",
      });

      expect(result.success).toBe(true);
      // Inline commands: only 2 fetch calls (torrent download + load.raw_start)
      expect(fetchMock.mock.calls.length).toBe(2);

      // Verify d.directory.set is inline in load.raw_start (no separate call)
      const addTorrentBody = fetchMock.mock.calls[1][1].body;
      expect(addTorrentBody).toContain("d.directory.set=/downloads");
      expect(addTorrentBody).not.toContain("d.custom1.set");
    });

    it("should handle directory.set failure gracefully", async () => {
      // Mock for torrent download
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(10),
      });

      // Mock for load.raw_start (add torrent) — returns success even with inline directory command
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<?xml version="1.0"?><methodResponse><params><param><value><int>0</int></value></param></params></methodResponse>`,
      });

      const result = await client.addDownload({
        url: "http://indexer.com/release.torrent",
        title: "Test Release",
        downloadPath: "/invalid/path",
      });

      // Should succeed — the inline command is part of the atomic load.raw_start call
      expect(result.success).toBe(true);
      expect(result.message).toContain("Download added successfully");
    });
  });
});

describe("QBittorrentClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: QBittorrentClient;

  const mockDownloader = createMockDownloader({
    id: "qbit-1",
    name: "Test access",
    type: "qbittorrent",
    url: "http://qbittorrent:8080",
    port: 8080,
    username: "admin",
    password: "adminadmin",
  });

  beforeEach(() => {
    ({ fetchMock, client } = setupClientTest(() => new QBittorrentClient(mockDownloader)));
  });

  describe("authenticate", () => {
    it.each([
      {
        cookieName: "SID",
        cookieHeader: "SID=abc12345; HttpOnly; Path=/",
        expectedCookie: "SID=abc12345",
        version: "v4.3.9",
      },
      {
        cookieName: "QBT_SID",
        cookieHeader: "QBT_SID_20080=abc12345; HttpOnly; Path=/",
        expectedCookie: "QBT_SID_20080=abc12345",
        version: "v5.2.0",
      },
    ])(
      "should authenticate and set $cookieName cookie",
      async ({ cookieHeader, expectedCookie, version }) => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          text: async () => "Ok.",
          headers: {
            getSetCookie: () => [cookieHeader],
            get: () => cookieHeader,
          },
        });

        fetchMock.mockResolvedValueOnce({
          ok: true,
          text: async () => version,
        });

        const result = await client.testConnection();
        expect(result.success).toBe(true);
        expect(fetchMock.mock.calls[1][1].headers.Cookie).toContain(expectedCookie);
      }
    );
  });
});

function createJsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: {
      get: () => null,
    },
  };
}

function createSynologyApiInfoResponse({
  dsm7 = false,
}: {
  dsm7?: boolean;
} = {}) {
  return createJsonResponse({
    success: true,
    data: {
      "SYNO.API.Auth": {
        path: "auth.cgi",
        minVersion: 1,
        maxVersion: 6,
      },
      ...(!dsm7
        ? {
            "SYNO.DownloadStation.Task": {
              path: "DownloadStation/task.cgi",
              minVersion: 1,
              maxVersion: 3,
            },
          }
        : {}),
      ...(dsm7
        ? {
            "SYNO.DownloadStation2.Task": {
              path: "DownloadStation/entry.cgi",
              minVersion: 1,
              maxVersion: 2,
            },
          }
        : {}),
      "SYNO.FileStation.Info": {
        path: "entry.cgi",
        minVersion: 1,
        maxVersion: 2,
      },
    },
  });
}

function createSynologyTaskResponse(taskOverrides: Record<string, unknown> = {}) {
  return createJsonResponse({
    success: true,
    data: {
      tasks: [
        {
          id: "dbid_1",
          title: "Test Release",
          size: 1000,
          status: "downloading",
          additional: {
            detail: {
              destination: "video/downloads",
              uri: "magnet:?xt=urn:btih:abc123def456abc123def456abc123def456abc1",
              create_time: 1710000000,
            },
            transfer: {
              size_downloaded: 500,
              size_uploaded: 50,
              speed_download: 100,
              speed_upload: 10,
            },
          },
          ...taskOverrides,
        },
      ],
    },
  });
}

describe("SynologyDownloadStationClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: SynologyDownloadStationClient;

  const mockDownloader = createMockDownloader({
    id: "synology-1",
    name: "Test Synology",
    type: "synology",
    url: "http://synology.local",
    port: 5000,
    username: "vincent",
    password: "secret",
    downloadPath: "video/downloads",
  });

  beforeEach(() => {
    ({ fetchMock, client } = setupClientTest(
      () => new SynologyDownloadStationClient(mockDownloader)
    ));
  });

  describe("testConnection", () => {
    it("logs in and logs out successfully", async () => {
      fetchMock
        .mockResolvedValueOnce(createSynologyApiInfoResponse())
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { sid: "sid-123" },
          })
        )
        .mockResolvedValueOnce(createJsonResponse({ success: true }));

      const result = await client.testConnection();

      expect(result).toEqual({
        success: true,
        message: "Connected successfully to Synology Download Station",
      });
      expect(fetchMock.mock.calls[1][0]).toContain("auth.cgi");
      expect(fetchMock.mock.calls[2][0]).toContain("method=logout");
    });

    it("surfaces authentication failures", async () => {
      fetchMock.mockResolvedValueOnce(createSynologyApiInfoResponse()).mockResolvedValueOnce(
        createJsonResponse({
          success: false,
          error: { code: 400 },
        })
      );

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Synology authentication failed");
    });

    it("surfaces network errors", async () => {
      fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("connect ECONNREFUSED");
    });
  });

  describe("addDownload", () => {
    it("adds a magnet link through the DSM 6 task API", async () => {
      fetchMock
        .mockResolvedValueOnce(createSynologyApiInfoResponse())
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { sid: "sid-123" },
          })
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { task_id: ["dbid_123"] },
          })
        );

      const result = await client.addDownload({
        url: "magnet:?xt=urn:btih:abc123def456abc123def456abc123def456abc1",
        title: "Test Release",
      });

      const createCall = fetchMock.mock.calls[2];
      expect(createCall[0]).toContain("DownloadStation/task.cgi");
      expect(createCall[1].body.toString()).toContain("uri=magnet%3A%3Fxt%3Durn%3Abtih");
      expect(createCall[1].body.toString()).toContain("destination=video%2Fdownloads");
      expect(result).toEqual({
        success: true,
        id: "dbid_123",
        message: "Download added successfully",
      });
    });

    it("uploads torrent content through the DSM 7 entry API", async () => {
      fetchMock
        .mockResolvedValueOnce(createSynologyApiInfoResponse({ dsm7: true }))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => new ArrayBuffer(8),
          json: async () => ({
            success: true,
            data: { task_id: ["dbid_upload"] },
          }),
          text: async () => "",
          headers: {
            get: (name: string) =>
              name === "content-disposition"
                ? 'attachment; filename="release.torrent"'
                : name === "content-type"
                  ? "application/x-bittorrent"
                  : null,
          },
        })
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { sid: "sid-123" },
          })
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { task_id: ["dbid_upload"] },
          })
        );

      const result = await client.addDownload({
        url: "http://indexer.local/release.torrent",
        title: "Release Upload",
      });

      expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
        "http://indexer.local/release.torrent"
      );
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          id: "dbid_upload",
        })
      );
    });
  });

  describe("status queries", () => {
    it("maps a found task into Questarr status fields", async () => {
      fetchMock
        .mockResolvedValueOnce(createSynologyApiInfoResponse())
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { sid: "sid-123" },
          })
        )
        .mockResolvedValueOnce(createSynologyTaskResponse());

      const status = await client.getDownloadStatus("dbid_1");

      expect(status).not.toBeNull();
      expect(status?.status).toBe("downloading");
      expect(status?.progress).toBe(50);
      expect(status?.downloadSpeed).toBe(100);
      expect(status?.ratio).toBe(0.1);
    });

    it("returns null when a task cannot be found", async () => {
      fetchMock
        .mockResolvedValueOnce(createSynologyApiInfoResponse())
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { sid: "sid-123" },
          })
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { tasks: [] },
          })
        );

      const status = await client.getDownloadStatus("missing");

      expect(status).toBeNull();
    });

    it("maps list results including finished tasks", async () => {
      fetchMock
        .mockResolvedValueOnce(createSynologyApiInfoResponse())
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: { sid: "sid-123" },
          })
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            success: true,
            data: {
              tasks: [
                {
                  id: "dbid_1",
                  title: "Queued-ish",
                  size: 1000,
                  status: "waiting",
                  additional: {
                    transfer: {
                      size_downloaded: 100,
                      speed_download: 25,
                    },
                  },
                },
                {
                  id: "dbid_2",
                  title: "Finished",
                  size: 1000,
                  status: "finished",
                  additional: {
                    transfer: {
                      size_downloaded: 1000,
                    },
                  },
                },
              ],
            },
          })
        );

      const downloads = await client.getAllDownloads();

      expect(downloads).toHaveLength(2);
      expect(downloads[0]).toMatchObject({ id: "dbid_1", status: "downloading", progress: 10 });
      expect(downloads[1]).toMatchObject({ id: "dbid_2", status: "completed", progress: 100 });
    });
  });

  it("re-authenticates once when the session expires", async () => {
    fetchMock
      .mockResolvedValueOnce(createSynologyApiInfoResponse())
      .mockResolvedValueOnce(
        createJsonResponse({
          success: true,
          data: { sid: "sid-123" },
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          success: false,
          error: { code: 106 },
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          success: true,
          data: { sid: "sid-456" },
        })
      )
      .mockResolvedValueOnce(createSynologyTaskResponse());

    const status = await client.getDownloadStatus("dbid_1");

    expect(status?.id).toBe("dbid_1");
    expect(fetchMock.mock.calls[3][0]).toContain("method=login");
    expect(fetchMock.mock.calls[4][0]).toContain("method=getinfo");
  });

  it("supports pause, resume, and delete actions", async () => {
    fetchMock
      .mockResolvedValueOnce(createSynologyApiInfoResponse())
      .mockResolvedValueOnce(
        createJsonResponse({
          success: true,
          data: { sid: "sid-123" },
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ success: true }))
      .mockResolvedValueOnce(createJsonResponse({ success: true }))
      .mockResolvedValueOnce(createJsonResponse({ success: true }));

    const pauseResult = await client.pauseDownload("dbid_1");
    const resumeResult = await client.resumeDownload("dbid_1");
    const removeResult = await client.removeDownload("dbid_1", true);

    expect(pauseResult.success).toBe(true);
    expect(resumeResult.success).toBe(true);
    expect(removeResult.success).toBe(true);
    expect(fetchMock.mock.calls[2][0]).toContain("method=pause");
    expect(fetchMock.mock.calls[3][0]).toContain("method=resume");
    expect(fetchMock.mock.calls[4][0]).toContain("method=delete");
    expect(fetchMock.mock.calls[4][0]).toContain("remove=true");
    expect(fetchMock.mock.calls[4][0]).toContain("force_complete=true");
  });

  it("retrieves free space from File Station", async () => {
    fetchMock
      .mockResolvedValueOnce(createSynologyApiInfoResponse())
      .mockResolvedValueOnce(
        createJsonResponse({
          success: true,
          data: { sid: "sid-123" },
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          success: true,
          data: { useable_space: 987654321 },
        })
      );

    const freeSpace = await client.getFreeSpace();

    expect(freeSpace).toBe(987654321);
    expect(fetchMock.mock.calls[2][0]).toContain("entry.cgi");
    expect(fetchMock.mock.calls[2][0]).toContain("SYNO.FileStation.Info");
  });
});
