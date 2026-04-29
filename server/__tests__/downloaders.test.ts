import { describe, it, expect, vi, beforeEach } from "vitest";
import { Downloader } from "../../shared/schema";
import { TransmissionClient, RTorrentClient, QBittorrentClient } from "../downloaders.js";

const { parseTorrentMock } = vi.hoisted(() => ({
  parseTorrentMock: vi.fn().mockResolvedValue({ infoHash: "abc123def456" }),
}));

vi.mock("parse-torrent", () => ({
  default: parseTorrentMock,
}));

// Mock dependencies
vi.mock("../logger.js", () => ({
  downloadersLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ssrf check to allow all URLs in tests
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn((url, options) => fetch(url, options)),
}));

// Mock parse-torrent so rTorrent tests get a deterministic infoHash
vi.mock("parse-torrent", () => ({
  default: vi.fn().mockResolvedValue({ infoHash: "abc123def456abc123def456abc123def456abc1" }),
}));

describe("TransmissionClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: TransmissionClient;

  const mockDownloader: Downloader = {
    id: "trans-1",
    name: "Test Transmission",
    type: "transmission",
    url: "http://transmission:9091",
    enabled: true,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    port: 9091,
    useSsl: false,
    urlPath: "/transmission/rpc",
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new TransmissionClient(mockDownloader);
  });

  describe("testConnection", () => {
    it("should return success on valid session-get response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: { "session-id": "12345" },
        }),
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toContain("Connected successfully");
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

  // Fully populated mock downloader to satisfy type requirements
  const mockDownloader: Downloader = {
    id: "rtorrent-1",
    name: "Test rTorrent",
    type: "rtorrent",
    url: "http://rtorrent:8080",
    enabled: true,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    port: 8080,
    useSsl: false,
    urlPath: "/RPC2",
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new RTorrentClient(mockDownloader);
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

  const mockDownloader: Downloader = {
    id: "qbit-1",
    name: "Test access",
    type: "qbittorrent",
    url: "http://qbittorrent:8080",
    enabled: true,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    port: 8080,
    useSsl: false,
    urlPath: null,
    username: "admin",
    password: "adminadmin",
    category: null,
    downloadDir: null,
    downloadPath: "/downloads",
    label: "tv",
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new QBittorrentClient(mockDownloader);
  });

  describe("authenticate", () => {
    it("should authenticate and set cookie", async () => {
      // 1. Mock login success
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => "Ok.",
        headers: {
          getSetCookie: () => ["SID=abc12345; HttpOnly; Path=/"],
          get: () => "SID=abc12345; HttpOnly; Path=/",
        },
      });

      // 2. Mock subsequent request (e.g. testConnection calling app/version)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => "v4.3.9",
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);

      // Check if cookie was used in second request
      expect(fetchMock.mock.calls[1][1].headers.Cookie).toContain("SID=abc12345");
    });
  });
});
