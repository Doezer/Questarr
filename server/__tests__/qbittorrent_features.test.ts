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

// Mock fetch
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

describe("QBittorrentClient - Advanced Features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.useRealTimers();
  });

  const createTestDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
    const now = new Date();
    return {
      id: "qbittorrent-id",
      name: "QBittorrent",
      type: "qbittorrent",
      url: "http://localhost:8080",
      port: null,
      useSsl: false,
      urlPath: null,
      username: "admin",
      password: "password",
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      label: "Questarr",
      addStopped: false,
      removeCompleted: false,
      postImportCategory: null,
      settings: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  };

  const bodyToString = (body: RequestInit["body"]): string => {
    if (body === null || body === undefined) return "";
    if (typeof body === "string") return body;
    if (body instanceof Uint8Array) return Buffer.from(body).toString();
    if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body)).toString();
    return String(body);
  };

  it("should handle adding download from http URL (non-magnet) and resolve hash", async () => {
    vi.useFakeTimers();
    const testDownloader = createTestDownloader();

    // Mock login response
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    const torrentFileResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from("torrent content"),
    };

    // Mock add torrent response (success)
    const addResponse = {
      ok: true,
      status: 200,
      text: async () => "Ok.",
      headers: { entries: () => [] },
    };

    // Mock torrents info response (to find the added torrent)
    const torrentsInfoResponse = {
      ok: true,
      json: async () => [
        {
          hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
          name: "Test Game",
          added_on: Math.floor(Date.now() / 1000),
        },
      ],
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // login
      .mockResolvedValueOnce(torrentFileResponse) // download torrent file
      .mockResolvedValueOnce(addResponse) // upload torrent to qBittorrent
      .mockResolvedValueOnce(torrentsInfoResponse); // list torrents

    const promise = DownloaderManager.addDownload(testDownloader, {
      url: "http://tracker.example.com/download/123.torrent",
      title: "Test Game",
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    // Verify torrent download call
    expect(fetchMock.mock.calls[1][0]).toBe("http://tracker.example.com/download/123.torrent");

    // Verify upload call
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/v2/torrents/add");
    expect(fetchMock.mock.calls[2][1].headers["Content-Type"]).toContain("multipart/form-data; boundary=");

    // Verify info call
    expect(fetchMock.mock.calls[3][0]).toBe(
      "http://localhost:8080/api/v2/torrents/info?sort=added_on&reverse=true"
    );

    expect(result.success).toBe(true);
    expect(result.id).toBe("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd");
  });

  it("should support force-started mode via settings", async () => {
    vi.useFakeTimers();
    const testDownloader = createTestDownloader({
      name: "QBittorrent Force",
      settings: JSON.stringify({ initialState: "force-started" }),
    });

    // Mock login response
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    const torrentFileResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from("torrent content"),
    };

    // Mock add torrent response
    const addResponse = {
      ok: true,
      status: 200,
      text: async () => "Ok.",
      headers: { entries: () => [] },
    };

    // Mock verify torrent info (hash extracted from URL query)
    const verifyResponse = {
      ok: true,
      json: async () => [{ hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd", name: "Test Game" }],
    };

    // Mock set force start response
    const setForceResponse = {
      ok: true,
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse) // login
      .mockResolvedValueOnce(torrentFileResponse) // download torrent file
      .mockResolvedValueOnce(addResponse) // upload torrent
      .mockResolvedValueOnce(verifyResponse) // verify added
      .mockResolvedValueOnce(setForceResponse); // set force start

    const promise = DownloaderManager.addDownload(testDownloader, {
      url: "http://tracker.example.com/download/123.torrent?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
      title: "Test Game",
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    // Verify set force start call
    const calls = fetchMock.mock.calls;
    const forceStartCall = calls.find((call) => call[0].includes("/api/v2/torrents/setForceStart"));

    expect(forceStartCall).toBeDefined();
    expect(forceStartCall![0]).toBe("http://localhost:8080/api/v2/torrents/setForceStart");
    expect((forceStartCall![1] as RequestInit).body).toBe(
      "hashes=aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd&value=true"
    );

    expect(result.success).toBe(true);
  });

  it("should support stopped (paused) mode via settings", async () => {
    vi.useFakeTimers();
    const testDownloader = createTestDownloader({
      name: "QBittorrent Stopped",
      addStopped: true, // Legacy setting or override
    });

    // Mock login response
    const loginResponse = {
      ok: true,
      text: async () => "Ok.",
      headers: { get: () => "SID=123" },
    };

    const torrentFileResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from("torrent content"),
    };

    // Mock add torrent response
    const addResponse = {
      ok: true,
      status: 200,
      text: async () => "Ok.",
      headers: { entries: () => [] },
    };

    // Mock verify torrent info (hash extracted from URL query)
    const verifyResponse = {
      ok: true,
      json: async () => [{ hash: "aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd", name: "Test Game" }],
    };

    fetchMock
      .mockResolvedValueOnce(loginResponse)
      .mockResolvedValueOnce(torrentFileResponse)
      .mockResolvedValueOnce(addResponse)
      .mockResolvedValueOnce(verifyResponse);

    const promise = DownloaderManager.addDownload(testDownloader, {
      url: "http://tracker.example.com/download/123.torrent?xt=urn:btih:aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd",
      title: "Test Game",
    });

    await vi.runAllTimersAsync();
    await promise;

    // Verify add call has paused=true
    const calls = fetchMock.mock.calls;
    const addCall = calls.find((call) => call[0].includes("/api/v2/torrents/add"));

    expect(addCall).toBeDefined();
    expect(addCall![0]).toBe("http://localhost:8080/api/v2/torrents/add");
    const bodyText = bodyToString((addCall![1] as RequestInit).body);
    expect(bodyText).toContain('name="paused"');
    expect(bodyText).toContain("\r\n\r\ntrue\r\n");
  });
});
