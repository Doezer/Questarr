// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Downloader } from "../../shared/schema.js";
import {
  DelugeClient,
  SABnzbdClient,
  NZBGetClient,
  TransmissionClient,
  RTorrentClient,
  SynologyDownloadStationClient,
  QBittorrentClient,
} from "../downloaders.js";
import { DownloaderManager } from "../downloaders/manager.js";

// Mock dependencies
vi.mock("../logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: { child: vi.fn(() => mockLogger) },
    igdbLogger: mockLogger,
    routesLogger: mockLogger,
    expressLogger: mockLogger,
    downloadersLogger: mockLogger,
    torznabLogger: mockLogger,
    searchLogger: mockLogger,
  };
});

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const createDownloader = (type: string, overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "dl-1",
    name: "Test Downloader",
    type,
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

describe("DownloaderManager.findDownloadByTag — static resolver", () => {
  it("is a static async function on DownloaderManager", () => {
    expect(typeof DownloaderManager.findDownloadByTag).toBe("function");
  });

  it("propagates a lookup failure from the qBittorrent client", async () => {
    const qbDownloader = createDownloader("qbittorrent");
    // No qBittorrent server is reachable here, so the lookup rejects instead of
    // being swallowed as a "torrent not visible yet" null. Cron relies on this
    // to skip the cycle rather than burning a retry.
    await expect(
      DownloaderManager.findDownloadByTag(qbDownloader, "questarr-add-test")
    ).rejects.toThrow();
  });

  it("dispatches to non-qBittorrent client and returns null", async () => {
    for (const type of ["deluge", "sabnzbd", "nzbget", "transmission", "rtorrent", "synology"]) {
      const d = createDownloader(type);
      const result = await DownloaderManager.findDownloadByTag(d, "questarr-add-test");
      expect(result).toBeNull();
    }
  });
});

describe("Non-qBittorrent downloaders — findTorrentByTag returns null (no-op)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DelugeClient.findTorrentByTag returns null", async () => {
    const client = new DelugeClient(createDownloader("deluge"));
    const result = await client.findTorrentByTag("questarr-add-any");
    expect(result).toBeNull();
  });

  it("SABnzbdClient.findTorrentByTag returns null", async () => {
    const client = new SABnzbdClient(createDownloader("sabnzbd"));
    const result = await client.findTorrentByTag("questarr-add-any");
    expect(result).toBeNull();
  });

  it("NZBGetClient.findTorrentByTag returns null", async () => {
    const client = new NZBGetClient(createDownloader("nzbget"));
    const result = await client.findTorrentByTag("questarr-add-any");
    expect(result).toBeNull();
  });

  it("TransmissionClient.findTorrentByTag returns null", async () => {
    const client = new TransmissionClient(createDownloader("transmission"));
    const result = await client.findTorrentByTag("questarr-add-any");
    expect(result).toBeNull();
  });

  it("RTorrentClient.findTorrentByTag returns null", async () => {
    const client = new RTorrentClient(createDownloader("rtorrent"));
    const result = await client.findTorrentByTag("questarr-add-any");
    expect(result).toBeNull();
  });

  it("SynologyDownloadStationClient.findTorrentByTag returns null", async () => {
    const client = new SynologyDownloadStationClient(createDownloader("synology"));
    const result = await client.findTorrentByTag("questarr-add-any");
    expect(result).toBeNull();
  });
});
