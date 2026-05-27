import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader, DownloadStatus } from "../../shared/schema.js";
import { DownloaderManager } from "../downloaders.js";
import {
  DOWNLOAD_CLIENT_USER_AGENT,
  extractHashFromUrl,
  fetchWithMagnetDetection,
  fixNzbUrlEncoding,
} from "../downloaders/utils.js";
import { NZBGetClient } from "../downloaders/nzbget.js";
import { QBittorrentClient } from "../downloaders/qbittorrent.js";
import { RTorrentClient } from "../downloaders/rtorrent.js";
import { SABnzbdClient } from "../downloaders/sabnzbd.js";
import { SynologyDownloadStationClient } from "../downloaders/synology.js";
import { TransmissionClient } from "../downloaders/transmission.js";
import { downloadersLogger } from "../logger.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";
import type { DownloaderClient } from "../downloaders/types.js";

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
  safeFetch: vi.fn(),
}));

const baseDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "dl-1",
    name: "Downloader",
    type: "transmission",
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "user",
    password: "pass",
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

const stubClient = (overrides: Partial<DownloaderClient> = {}): DownloaderClient => ({
  testConnection: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
  addDownload: vi.fn().mockResolvedValue({ success: true, id: "id-1", message: "ok" }),
  getDownloadStatus: vi.fn().mockResolvedValue(null),
  getDownloadDetails: vi.fn().mockResolvedValue(null),
  getAllDownloads: vi.fn().mockResolvedValue([]),
  pauseDownload: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
  resumeDownload: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
  removeDownload: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
  getFreeSpace: vi.fn().mockResolvedValue(0),
  ...overrides,
});

describe("downloaders utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("fixes only the Prowlarr link query parameter when it contains plus signs", () => {
    expect(
      fixNzbUrlEncoding(
        "http://prowlarr.local/download?apikey=secret&link=abc+def+ghi&file=my+game.torrent"
      )
    ).toBe(
      "http://prowlarr.local/download?apikey=secret&link=abc%2Bdef%2Bghi&file=my+game.torrent"
    );
    expect(fixNzbUrlEncoding("http://indexer.local/download")).toBe(
      "http://indexer.local/download"
    );
  });

  it("extracts and normalizes magnet hashes for hex and base32 inputs", () => {
    expect(extractHashFromUrl("magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(
      "abcdef1234567890abcdef1234567890abcdef12"
    );
    expect(extractHashFromUrl("magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")).toBe(
      "abcdefghijklmnopqrstuvwxyz234567"
    );
    expect(extractHashFromUrl("https://indexer.local/download.torrent")).toBeNull();
  });

  it("retries 400 responses with spaces encoded as %20", async () => {
    vi.mocked(safeFetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: { get: () => null },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
      } as Response);

    const result = await fetchWithMagnetDetection("http://indexer.local/get?file=My+Game.torrent");

    expect(result.response?.ok).toBe(true);
    expect(safeFetch).toHaveBeenNthCalledWith(
      2,
      "http://indexer.local/get?file=My%20Game.torrent",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/x-bittorrent, */*",
          "User-Agent": DOWNLOAD_CLIENT_USER_AGENT,
        }),
        method: "GET",
        redirect: "manual",
      })
    );
    expect(downloadersLogger.warn).toHaveBeenCalled();
  });

  it("returns a magnet link when a redirect points to one", async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location"
            ? "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
            : null,
      },
    } as Response);

    const result = await fetchWithMagnetDetection("http://indexer.local/redirect");

    expect(result.magnetLink).toContain("magnet:?xt=urn:btih:");
    expect(result.response).toBeUndefined();
  });

  it("throws when a redirect target is unsafe", async () => {
    vi.mocked(isSafeUrl).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location" ? "http://unsafe.local/final.torrent" : null,
      },
    } as Response);

    await expect(fetchWithMagnetDetection("http://indexer.local/start")).rejects.toThrow(
      "Unsafe URL blocked: http://unsafe.local/final.torrent"
    );
  });

  it("throws after exceeding the redirect limit", async () => {
    vi.mocked(safeFetch).mockImplementation(async (url: string) => {
      const target = new URL(url);
      const step = Number(target.searchParams.get("n") ?? "0") + 1;
      return {
        ok: false,
        status: 302,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "location" ? `http://indexer.local/next?n=${step}` : null,
        },
      } as Response;
    });

    await expect(fetchWithMagnetDetection("http://indexer.local/next?n=0", 2)).rejects.toThrow(
      "Too many redirects (max 2)"
    );
  });
});

describe("DownloaderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the expected client for each supported downloader type", () => {
    expect(DownloaderManager.createClient(baseDownloader({ type: "transmission" }))).toBeInstanceOf(
      TransmissionClient
    );
    expect(DownloaderManager.createClient(baseDownloader({ type: "rtorrent" }))).toBeInstanceOf(
      RTorrentClient
    );
    expect(DownloaderManager.createClient(baseDownloader({ type: "qbittorrent" }))).toBeInstanceOf(
      QBittorrentClient
    );
    expect(DownloaderManager.createClient(baseDownloader({ type: "sabnzbd" }))).toBeInstanceOf(
      SABnzbdClient
    );
    expect(DownloaderManager.createClient(baseDownloader({ type: "nzbget" }))).toBeInstanceOf(
      NZBGetClient
    );
    expect(DownloaderManager.createClient(baseDownloader({ type: "synology" }))).toBeInstanceOf(
      SynologyDownloadStationClient
    );
  });

  it("rejects unsupported downloader types", () => {
    expect(() =>
      DownloaderManager.createClient(baseDownloader({ type: "not-real" as Downloader["type"] }))
    ).toThrow("Unsupported downloader type: not-real");
  });

  it("filters getAllDownloads by configured category case-insensitively", async () => {
    const createClientSpy = vi.spyOn(DownloaderManager, "createClient").mockReturnValue(
      stubClient({
        getAllDownloads: vi.fn().mockResolvedValue([
          { id: "1", name: "A", status: "downloading", progress: 10, category: "Games" },
          { id: "2", name: "B", status: "paused", progress: 20, category: "movies" },
          { id: "3", name: "C", status: "seeding", progress: 100 },
        ] satisfies DownloadStatus[]),
      })
    );

    const downloads = await DownloaderManager.getAllDownloads(
      baseDownloader({ category: "games" })
    );

    expect(downloads).toHaveLength(1);
    expect(downloads[0].id).toBe("1");
    createClientSpy.mockRestore();
  });

  it("wraps client errors for test, status, details and free-space calls", async () => {
    const client = stubClient({
      testConnection: vi.fn().mockRejectedValue(new Error("boom")),
      getDownloadStatus: vi.fn().mockRejectedValue(new Error("status failed")),
      getDownloadDetails: vi.fn().mockRejectedValue(new Error("details failed")),
      getFreeSpace: vi.fn().mockRejectedValue(new Error("space failed")),
    });
    const createClientSpy = vi.spyOn(DownloaderManager, "createClient").mockReturnValue(client);
    const downloader = baseDownloader();

    await expect(DownloaderManager.testDownloader(downloader)).resolves.toEqual({
      success: false,
      message: "boom",
    });
    await expect(DownloaderManager.getDownloadStatus(downloader, "abc")).resolves.toBeNull();
    await expect(DownloaderManager.getDownloadDetails(downloader, "abc")).resolves.toBeNull();
    await expect(DownloaderManager.getFreeSpace(downloader)).resolves.toBe(0);

    createClientSpy.mockRestore();
  });

  it("returns an empty attempted list when no downloaders are available", async () => {
    await expect(
      DownloaderManager.addDownloadWithFallback([], {
        url: "magnet:?xt=urn:btih:abc",
        title: "Game",
      })
    ).resolves.toEqual({
      success: false,
      message: "No downloaders available",
      attemptedDownloaders: [],
    });
  });

  it("returns a compatibility error when no downloader matches the requested type", async () => {
    const result = await DownloaderManager.addDownloadWithFallback(
      [baseDownloader({ type: "transmission", name: "Transmission" })],
      {
        url: "http://indexer.local/game.nzb",
        title: "Game",
        downloadType: "usenet",
      }
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("No compatible downloaders found for type: usenet");
    expect(result.attemptedDownloaders).toEqual([]);
  });

  it("aggregates fallback failures and keeps attempted downloader order", async () => {
    const addDownloadSpy = vi
      .spyOn(DownloaderManager, "addDownload")
      .mockResolvedValueOnce({ success: false, message: "Primary failed" })
      .mockResolvedValueOnce({ success: false, message: "Secondary failed" });

    const result = await DownloaderManager.addDownloadWithFallback(
      [
        baseDownloader({ id: "one", name: "Primary", type: "transmission" }),
        baseDownloader({ id: "two", name: "Secondary", type: "qbittorrent" }),
      ],
      {
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Game",
        downloadType: "torrent",
      }
    );

    expect(result.success).toBe(false);
    expect(result.attemptedDownloaders).toEqual(["Primary", "Secondary"]);
    expect(result.message).toContain("Primary: Primary failed");
    expect(result.message).toContain("Secondary: Secondary failed");

    addDownloadSpy.mockRestore();
  });
});
