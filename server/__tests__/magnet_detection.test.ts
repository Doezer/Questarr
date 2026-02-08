import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DownloaderManager } from "../downloaders";
import type { Downloader } from "../../shared/schema";

// Mock parse-torrent
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

// Mock fetch global
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("Magnet Detection and Redirect Handling in QBittorrentClient", () => {
  const qbDownloader: Downloader = {
    id: "qb-1",
    name: "qBittorrent",
    type: "qbittorrent",
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    port: 8080,
    useSsl: false,
    urlPath: null,
    username: "admin",
    password: "password",
    downloadPath: "/downloads",
    category: "games",
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createResponse = (props: Record<string, unknown> = {}) => {
    const headersMap = (props.headersMap as Record<string, string>) || {};
    return {
      ok: (props.ok as boolean) ?? true,
      status: (props.status as number) ?? 200,
      statusText: (props.statusText as string) ?? "OK",
      headers: {
        get: (name: string) => headersMap[name.toLowerCase()] || null,
        getSetCookie: () => (headersMap["set-cookie"] ? [headersMap["set-cookie"]] : []),
        entries: () => Object.entries(headersMap),
      },
      text: async () => (props.text as string) ?? "Ok.",
      arrayBuffer: async () => (props.arrayBuffer as ArrayBuffer) ?? new ArrayBuffer(0),
    };
  };

  const mockAuthSuccess = () =>
    createResponse({
      headersMap: { "set-cookie": "SID=123" },
      text: "Ok.",
    });

  const mockAddTorrentSuccess = () =>
    createResponse({
      text: "Ok.",
    });

  const mockAddTorrentFail = () =>
    createResponse({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: "Failed",
      headersMap: {},
    });

  it("should retry with %20 when a URL with + returns 400 Bad Request", async () => {
    const urlWithPlus = "http://indexer.com/download?file=my+game.torrent";
    const fixedUrl = "http://indexer.com/download?file=my%20game.torrent";

    fetchMock
      // 1. Auth
      .mockResolvedValueOnce(mockAuthSuccess())
      // 2. Try Add URL to qBittorrent -> FAIL (Trigger Fallback)
      .mockResolvedValueOnce(mockAddTorrentFail())
      // 3. Fetch original URL -> 400 Bad Request
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 400,
          statusText: "Bad Request",
        })
      )
      // 4. Fetch fixed URL -> 200 OK (Torrent file)
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 200,
          headersMap: { "content-disposition": 'attachment; filename="test.torrent"' },
          arrayBuffer: new ArrayBuffer(10),
        })
      )
      // 5. Add torrent file to qBittorrent
      .mockResolvedValueOnce(mockAddTorrentSuccess());

    const result = await DownloaderManager.addDownload(qbDownloader, {
      url: urlWithPlus,
      title: "Test Game",
    });

    expect(result).not.toBeNull();
    // Verify specific calls
    // Call 2 (index 2) should be failing fetch
    expect(fetchMock.mock.calls[2][0]).toBe(urlWithPlus);

    // Call 3 (index 3) should be fixed fetch
    expect(fetchMock.mock.calls[3][0]).toBe(fixedUrl);
  });

  it("should detect magnet link redirects and handle them", async () => {
    const startUrl = "http://indexer.com/download/123";
    const magnetLink = "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=Test+Game";

    fetchMock
      // 1. Auth (Initial)
      .mockResolvedValueOnce(mockAuthSuccess())
      // 2. Try Add URL -> FAIL
      .mockResolvedValueOnce(mockAddTorrentFail())
      // 3. Fetch URL -> 302 Redirect to Magnet
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 302,
          headersMap: { location: magnetLink },
        })
      )
      // 4. Add magnet to qBittorrent (Auth is reused)
      .mockResolvedValueOnce(mockAddTorrentSuccess())
      // 5. Info check
      .mockResolvedValueOnce(
        createResponse({
          text: "[]",
        })
      );

    const result = await DownloaderManager.addDownload(qbDownloader, {
      url: startUrl,
      title: "Test Game",
    });

    expect(result).not.toBeNull();

    // Auth (1) + Fail (1) + Redirect (1) + Add (1) + Info (1) = 5
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // Check redirect handling (Call 2, index 2)
    expect(fetchMock.mock.calls[2][0]).toBe(startUrl);

    // Check magnet add (Call 3, index 3)
    const addCall = fetchMock.mock.calls[3];
    expect(addCall[0]).toContain("/api/v2/torrents/add");
  });

  it("should handle relative redirect URLs", async () => {
    const baseUrl = "http://indexer.com";
    const startPath = "/download/start";
    const redirectPath = "/download/final/file.torrent";

    fetchMock
      // 1. Auth
      .mockResolvedValueOnce(mockAuthSuccess())
      // 2. Try Add URL -> FAIL
      .mockResolvedValueOnce(mockAddTorrentFail())
      // 3. Fetch Start URL -> 302 Relative Redirect
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 302,
          headersMap: { location: redirectPath },
        })
      )
      // 4. Fetch Final URL -> 200 Torrent File
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 200,
          headersMap: { "content-disposition": 'attachment; filename="game.torrent"' },
          arrayBuffer: new ArrayBuffer(10),
        })
      )
      // 5. Add to qBittorrent
      .mockResolvedValueOnce(mockAddTorrentSuccess());

    const result = await DownloaderManager.addDownload(qbDownloader, {
      url: baseUrl + startPath,
      title: "Test Game",
    });

    expect(result).not.toBeNull();
    // Verify relative URL construction
    expect(fetchMock.mock.calls[3][0]).toBe(baseUrl + redirectPath);
  });

  it("should fail gracefully after max redirects", async () => {
    const url = "http://indexer.com/loop";

    fetchMock
      .mockResolvedValueOnce(mockAuthSuccess()) // 1. Auth
      .mockResolvedValueOnce(mockAddTorrentFail()) // 2. Add URL Fail
      .mockResolvedValue(
        createResponse({
          // Default: Infinite redirect
          ok: false,
          status: 302,
          headersMap: { location: "http://indexer.com/loop" },
        })
      );

    const result = await DownloaderManager.addDownload(qbDownloader, {
      url: url,
      title: "Test Game",
    });

    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
    // 1 Auth + 1 Fail + 5 Redirects = 7
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
