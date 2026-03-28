import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "@shared/schema";

vi.mock("../db.js", () => ({ pool: {}, db: {} }));
vi.mock("../logger.js", () => ({
  torznabLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../ssrf.js", () => ({ safeFetch: vi.fn() }));

const { TorznabClient } = await import("../torznab.js");
const { safeFetch } = await import("../ssrf.js");

const mockSafeFetch = vi.mocked(safeFetch);

function makeIndexer(overrides: Partial<Indexer> = {}): Indexer {
  return {
    id: "idx-1",
    name: "Test Indexer",
    url: "http://indexer.example.com/api",
    apiKey: "testkey",
    protocol: "torznab",
    enabled: true,
    priority: 1,
    categories: [],
    rssEnabled: true,
    autoSearchEnabled: true,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeTorznabXml(enclosureUrl: string, link?: string): string {
  const linkEl = link ? `<link>${link}</link>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Test</title>
    <item>
      <title>Some Game</title>
      ${linkEl}
      <guid>https://limetorrents.info/some-game-torrent-1234.html</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      <enclosure url="${enclosureUrl}" length="1000000" type="application/x-bittorrent"/>
    </item>
  </channel>
</rss>`;
}

function mockFetchResponse(xml: string) {
  mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => xml,
  } as Response);
}

describe("TorznabClient — download link rewriting", () => {
  let client: InstanceType<typeof TorznabClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TorznabClient();
  });

  it("leaves the link unchanged when it already points to the indexer host", async () => {
    const indexer = makeIndexer({ url: "http://indexer.example.com/api" });
    const expectedLink = "http://indexer.example.com/download/file.torrent";
    mockFetchResponse(makeTorznabXml(expectedLink));

    const result = await client.searchGames(indexer, { query: "game" });

    expect(result.items[0].link).toBe(expectedLink);
  });

  it("applies standard host rewrite for non-Prowlarr indexers returning an internal URL", async () => {
    const indexer = makeIndexer({ url: "https://my-indexer.com/api" });
    // Indexer returns its internal hostname in the download URL
    mockFetchResponse(makeTorznabXml("https://internal-host:8080/download/file.torrent"));

    const result = await client.searchGames(indexer, { query: "game" });

    // Host is rewritten to the configured host; port from the internal URL is preserved
    expect(result.items[0].link).toBe("https://my-indexer.com:8080/download/file.torrent");
  });

  it("builds a Prowlarr proxy URL when a Prowlarr indexer returns a raw external download URL", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "https://prowlarr:9696/5/api",
      apiKey: "prowlarr-api-key",
    });
    const rawExternalUrl = "https://limetorrents.info/download/8/some-game.torrent";
    mockFetchResponse(makeTorznabXml(rawExternalUrl));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });

    const link = result.items[0].link;
    const parsed = new URL(link);

    // Must point to Prowlarr, not the external indexer
    expect(parsed.hostname).toBe("prowlarr");
    expect(parsed.port).toBe("9696");
    expect(parsed.pathname).toBe("/5/download");

    // Must include apikey matching the indexer config
    expect(parsed.searchParams.get("apikey")).toBe("prowlarr-api-key");

    // The 'link' param must be the base64-encoded original URL
    const encodedLink = parsed.searchParams.get("link");
    expect(encodedLink).not.toBeNull();
    const decoded = Buffer.from(encodedLink!, "base64").toString("utf-8");
    expect(decoded).toBe(rawExternalUrl);
  });

  it("uses Prowlarr proxy URL format when Prowlarr indexer has numeric ID in URL path", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "https://192.168.1.100:9696/12/api",
      apiKey: "secret",
    });
    const rawUrl = "https://external-indexer.org/torrents/download/99999.torrent";
    mockFetchResponse(makeTorznabXml(rawUrl));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });

    const link = result.items[0].link;
    expect(link).toMatch(/^https:\/\/192\.168\.1\.100:9696\/12\/download\?/);

    const parsed = new URL(link);
    expect(parsed.searchParams.get("apikey")).toBe("secret");
    const decoded = Buffer.from(parsed.searchParams.get("link")!, "base64").toString();
    expect(decoded).toBe(rawUrl);
  });

  it("leaves Prowlarr proxy URLs unchanged when Prowlarr already returned its own proxy URL", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "https://prowlarr:9696/5/api",
      apiKey: "prowlarr-api-key",
    });
    // Prowlarr already generated its own proxy URL — must not be double-encoded
    const prowlarrProxyUrl =
      "https://prowlarr:9696/5/download?file=Some+Game&link=aHR0cHM6Ly9leGFtcGxlLmNvbQ%3D%3D&apikey=prowlarr-api-key";
    mockFetchResponse(makeTorznabXml(prowlarrProxyUrl));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });

    expect(result.items[0].link).toBe(prowlarrProxyUrl);
  });

  it("falls back to standard host rewrite for Prowlarr-style URL path but missing apiKey", async () => {
    const indexer = makeIndexer({
      url: "https://prowlarr:9696/5/api",
      apiKey: "",
    });
    mockFetchResponse(makeTorznabXml("https://external.com/download/game.torrent"));

    const result = await client.searchGames(indexer, { query: "game" });

    // No apiKey → falls through to standard host rewrite
    const link = result.items[0].link;
    expect(new URL(link).host).toBe("prowlarr:9696");
  });
});
