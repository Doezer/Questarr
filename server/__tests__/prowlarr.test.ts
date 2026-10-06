import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { prowlarrClient } from "../prowlarr.js";

// Mock logger
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn((url, options) => fetch(url, options)) as Mock,
}));

vi.mock("../logger.js", () => ({
  torznabLogger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ProwlarrClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const mockProwlarrIndexers = [
    {
      id: 1,
      name: "Torrent Indexer",
      protocol: "torrent",
      enable: true,
      priority: 1,
      appProfileId: 1,
      indexerUrls: ["http://prowlarr:9696/1/api"],
    },
    {
      id: 2,
      name: "Usenet Indexer",
      protocol: "usenet",
      enable: true,
      priority: 2,
      appProfileId: 1,
      indexerUrls: ["http://prowlarr:9696/2/api"],
    },
    {
      id: 3,
      name: "Unsupported Indexer",
      protocol: "something_else",
      enable: true,
      priority: 3,
      appProfileId: 1,
      indexerUrls: ["http://prowlarr:9696/3/api"],
    },
  ];

  it("should fetch and map indexers correctly", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProwlarrIndexers,
    });

    const indexers = await prowlarrClient.getIndexers("http://prowlarr:9696", "apikey123");

    expect(indexers).toHaveLength(2); // Should filter out "Unsupported Indexer"

    const torrentIndexer = indexers.find((i) => i.name === "Torrent Indexer");
    expect(torrentIndexer).toBeDefined();
    expect(torrentIndexer?.protocol).toBe("torznab");
    expect(torrentIndexer?.url).toBe("http://prowlarr:9696/1/api");
    expect(torrentIndexer?.apiKey).toBe("apikey123");

    const usenetIndexer = indexers.find((i) => i.name === "Usenet Indexer");
    expect(usenetIndexer).toBeDefined();
    expect(usenetIndexer?.protocol).toBe("newznab");
    expect(usenetIndexer?.url).toBe("http://prowlarr:9696/2/api");
  });

  it("should handle Prowlarr API errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      statusText: "Unauthorized",
    });

    await expect(prowlarrClient.getIndexers("http://prowlarr:9696", "bad_key")).rejects.toThrow(
      "Failed to fetch indexers from Prowlarr: Unauthorized"
    );
  });

  it("should normalize Prowlarr URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await prowlarrClient.getIndexers("prowlarr:9696/", "key"); // Missing http, trailing slash

    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl).toBe("http://prowlarr:9696/api/v1/indexer");
  });

  // The key must never go over HTTP on an inferred opt-in (see shared/schema.ts):
  // only the dialog's explicit choice sets the flag, otherwise it is left out
  // so an existing indexer keeps its own setting.
  it("does not infer the insecure LAN opt-in from an HTTP Prowlarr URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockProwlarrIndexers });

    const indexers = await prowlarrClient.getIndexers("http://prowlarr:9696", "apikey123");

    expect(indexers.every((i) => !("allowInsecureLan" in i))).toBe(true);
  });

  it("applies an explicit insecure LAN opt-in to every indexer", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockProwlarrIndexers });

    const indexers = await prowlarrClient.getIndexers("http://prowlarr:9696", "apikey123", {
      allowInsecureLan: true,
    });

    expect(indexers.map((i) => i.allowInsecureLan)).toEqual([true, true]);
  });

  it("applies the sync dialog's global settings to every indexer", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockProwlarrIndexers });

    const indexers = await prowlarrClient.getIndexers("http://prowlarr:9696", "apikey123", {
      allowInsecureLan: false,
      priority: 7,
      categories: ["4050"],
    });

    for (const indexer of indexers) {
      expect(indexer.allowInsecureLan).toBe(false);
      expect(indexer.priority).toBe(7);
      expect(indexer.categories).toEqual(["4050"]);
    }
  });

  it("leaves categories out when none were chosen, so a re-sync keeps them", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockProwlarrIndexers });

    const indexers = await prowlarrClient.getIndexers("http://prowlarr:9696", "apikey123");

    expect(indexers.every((i) => !("categories" in i))).toBe(true);
    expect(indexers.map((i) => i.priority)).toEqual([1, 2]);
  });
});
