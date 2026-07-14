import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  TransmissionClient,
  RTorrentClient,
  QBittorrentClient,
  SABnzbdClient,
  NZBGetClient,
} from "../downloaders.js";
import { Downloader } from "../../shared/schema";

// Mock dependencies
vi.mock("../logger.js", () => ({
  downloadersLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We will mock isSafeUrl differently in each test
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn(),
  safeFetch: vi.fn((url, options) => fetch(url, options)),
}));

import { isSafeUrl } from "../ssrf.js";

describe("Downloader SSRF Protection", () => {
  const mockDownloader: Downloader = {
    id: "test-dl",
    name: "Test Downloader",
    type: "transmission", // will be overridden
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    port: 8080,
    useSsl: false,
    urlPath: "/rpc",
    username: "user",
    password: "password",
    category: null,
    downloadPath: "/downloads",
    label: "test",
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default to unsafe for these tests to verify blocking
    (isSafeUrl as Mock).mockResolvedValue(false);
  });

  describe("TransmissionClient", () => {
    it("should bypass isSafeUrl for magnet links (no hostname to validate)", async () => {
      // Magnet URIs have no hostname, so isSafeUrl is intentionally skipped for them.
      // The BitTorrent client handles tracker URL validation internally.
      const client = new TransmissionClient({ ...mockDownloader, type: "transmission" });
      await client.addDownload({
        url: "magnet:?xt=urn:btih:abc123",
        title: "Magnet Link",
      });

      expect(isSafeUrl).not.toHaveBeenCalledWith("magnet:?xt=urn:btih:abc123");
    });

    it("should block unsafe URL in addDownload (http)", async () => {
      const client = new TransmissionClient({ ...mockDownloader, type: "transmission" });
      const result = await client.addDownload({
        url: "http://unsafe.com/file.torrent",
        title: "Unsafe Torrent",
      });

      expect(isSafeUrl).toHaveBeenCalledWith("http://unsafe.com/file.torrent");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unsafe URL blocked");
    });
  });

  describe("RTorrentClient", () => {
    it("should block unsafe URL in addDownload", async () => {
      const client = new RTorrentClient({ ...mockDownloader, type: "rtorrent" });
      const result = await client.addDownload({
        url: "http://unsafe.com/file.torrent",
        title: "Unsafe Torrent",
      });

      expect(isSafeUrl).toHaveBeenCalledWith("http://unsafe.com/file.torrent");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unsafe URL blocked");
    });
  });

  describe("QBittorrentClient", () => {
    it("should block unsafe URL in addDownload", async () => {
      const client = new QBittorrentClient({ ...mockDownloader, type: "qbittorrent" });
      // Authenticate first (mocked)
      // Actually addDownload calls authenticate internally
      // We need to mock fetch to avoid actual network calls if isSafeUrl fails
      // But isSafeUrl check is BEFORE fetch, so fetch shouldn't be called.
      // However, addDownload calls authenticate() first.
      // Let's mock fetch just in case authentication is attempted.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "Ok.",
        headers: { getSetCookie: () => [] },
      });

      const result = await client.addDownload({
        url: "http://unsafe.com/file.torrent",
        title: "Unsafe Torrent",
      });

      // QBittorrent authenticate doesn't take URL arg, so it's fine.
      // Then it checks request.url
      expect(isSafeUrl).toHaveBeenCalledWith("http://unsafe.com/file.torrent");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unsafe URL blocked");
    });

    it("should block unsafe redirect target inside fetchWithMagnetDetection fallback", async () => {
      // The initial URL passes isSafeUrl, so addDownload proceeds past the entry check
      // and falls back to downloading the .torrent file via fetchWithMagnetDetection,
      // which re-validates the URL before fetching. Simulate that re-check failing
      // (e.g. a redirect to an internal address) to prove the internal guard works too.
      (isSafeUrl as Mock).mockResolvedValueOnce(true).mockResolvedValue(false);

      const jsonHeaders = { get: () => null, entries: () => [] };
      global.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/v2/auth/login")) {
          return {
            ok: true,
            text: async () => "Ok.",
            headers: { getSetCookie: () => [], get: () => null },
          } as unknown as Response;
        }
        if (url.includes("/api/v2/torrents/add")) {
          return {
            ok: true,
            status: 200,
            text: async () => "Fails.",
            headers: jsonHeaders,
          } as unknown as Response;
        }
        if (url.includes("/api/v2/torrents/info")) {
          return { ok: true, json: async () => [], headers: jsonHeaders } as unknown as Response;
        }
        return { ok: true, text: async () => "", headers: jsonHeaders } as unknown as Response;
      });

      const client = new QBittorrentClient({ ...mockDownloader, type: "qbittorrent" });
      const result = await client.addDownload({
        url: "http://redirect-source.com/file.torrent",
        title: "Redirected Torrent",
      });

      expect(isSafeUrl).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unsafe URL blocked");
    });
  });

  describe("SABnzbdClient", () => {
    it("should block unsafe URL in addDownload", async () => {
      const client = new SABnzbdClient({ ...mockDownloader, type: "sabnzbd" });
      const result = await client.addDownload({
        url: "http://unsafe.com/file.nzb",
        title: "Unsafe NZB",
      });

      expect(isSafeUrl).toHaveBeenCalledWith("http://unsafe.com/file.nzb");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unsafe URL blocked");
    });
  });

  describe("NZBGetClient", () => {
    it("should block unsafe URL in addDownload", async () => {
      const client = new NZBGetClient({ ...mockDownloader, type: "nzbget" });
      const result = await client.addDownload({
        url: "http://unsafe.com/file.nzb",
        title: "Unsafe NZB",
      });

      expect(isSafeUrl).toHaveBeenCalledWith("http://unsafe.com/file.nzb");
      expect(result.success).toBe(false);
      // NZBGet client catches the error and returns success:false
      expect(result.message).toContain("Unsafe URL blocked");
    });
  });
});
