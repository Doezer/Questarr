import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Indexer } from "@shared/schema";

vi.mock("../db.js", () => ({ pool: {}, db: {} }));
vi.mock("../logger.js", () => ({
  torznabLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../ssrf.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ssrf.js")>()),
  isSafeUrl: vi.fn(),
  safeFetch: vi.fn(),
}));

const { TorznabClient } = await import("../torznab.js");
const { torznabLogger } = await import("../logger.js");
const { isSafeUrl, safeFetch } = await import("../ssrf.js");

const mockIsSafeUrl = vi.mocked(isSafeUrl);
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

function makeCapsXml(version = "1.2.3", title = "Test Torznab"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="${title}" version="${version}" />
</caps>`;
}

describe("TorznabClient — download link rewriting", () => {
  let client: InstanceType<typeof TorznabClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TorznabClient();
  });

  /** Search a Prowlarr-backed indexer that returns `enclosure`, and parse the rewritten link. */
  async function searchProwlarrLink(indexerUrl: string, enclosure: string): Promise<URL> {
    mockFetchResponse(makeTorznabXml(enclosure));
    const indexer = makeIndexer({ url: indexerUrl, apiKey: "prowlarr-api-key" });

    const result = await client.searchGames(indexer, { query: "game" });

    return new URL(result.items[0].link);
  }

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

  it("does not double-wrap Prowlarr proxy URL when only host aliases differ", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "http://localhost:9696/5/api",
      apiKey: "prowlarr-api-key",
    });
    const prowlarrProxyUrlFromAlias =
      "http://127.0.0.1:9696/5/download?file=Some+Game&link=aHR0cHM6Ly9leGFtcGxlLmNvbS90b3JyZW50L2Rvd25sb2FkP2lkPTE%3D&apikey=prowlarr-api-key";
    mockFetchResponse(makeTorznabXml(prowlarrProxyUrlFromAlias));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });

    const rewritten = new URL(result.items[0].link);
    expect(rewritten.hostname).toBe("localhost");
    expect(rewritten.pathname).toBe("/5/download");
    expect(rewritten.searchParams.get("apikey")).toBe("prowlarr-api-key");
    expect(rewritten.searchParams.get("link")).toBe(
      "aHR0cHM6Ly9leGFtcGxlLmNvbS90b3JyZW50L2Rvd25sb2FkP2lkPTE="
    );
  });

  // Prowlarr builds its download links from the address the request arrived on, so its
  // /{id}/download proxy links come back on whatever alias reached it: the container IP
  // behind a Docker service name, or the internal address behind a reverse proxy.
  // Re-wrapping one nests Prowlarr's own token a level too deep and it answers
  // "Failed to normalize provided link" (500). See issue #812.
  const proxyToken = "cHJvd2xhcnItdG9rZW4=";
  const aliasedProxyCases = [
    {
      alias: "the container IP behind a Docker service name",
      indexerUrl: "http://prowlarr:9696/39/api",
      enclosure: `http://172.19.0.8:9696/39/download?apikey=prowlarr-api-key&link=${proxyToken}&file=Sunderfolk`,
      expectedOrigin: "http://prowlarr:9696",
      expectedPath: "/39/download",
    },
    {
      // The configured URL terminates TLS on 443 while Prowlarr answers HTTP on 9696
      // internally, so scheme and port both differ from the link Prowlarr returns.
      alias: "the internal address behind a reverse proxy",
      indexerUrl: "https://prowlarr.example.com/5/api",
      enclosure: `http://10.1.2.3:9696/5/download?apikey=prowlarr-api-key&link=${proxyToken}&file=Sunderfolk`,
      expectedOrigin: "https://prowlarr.example.com",
      expectedPath: "/5/download",
    },
    {
      // TLS terminated in front of Prowlarr: it sees plain HTTP and reflects http://
      // back on the same host and port, so only the scheme differs from the configured
      // URL — the link still has to be normalized onto the configured endpoint.
      alias: "the same private address under a plain-HTTP scheme",
      indexerUrl: "https://172.19.0.8:9696/39/api",
      enclosure: `http://172.19.0.8:9696/39/download?apikey=prowlarr-api-key&link=${proxyToken}&file=Sunderfolk`,
      expectedOrigin: "https://172.19.0.8:9696",
      expectedPath: "/39/download",
    },
  ];

  it.each(aliasedProxyCases)(
    "does not double-wrap a Prowlarr proxy URL returned on $alias",
    async ({ indexerUrl, enclosure, expectedOrigin, expectedPath }) => {
      const link = await searchProwlarrLink(indexerUrl, enclosure);

      expect(link.origin).toBe(expectedOrigin);
      expect(link.pathname).toBe(expectedPath);
      expect(link.searchParams.get("apikey")).toBe("prowlarr-api-key");
      // Prowlarr's own token survives verbatim rather than being nested one level down
      expect(link.searchParams.get("link")).toBe(proxyToken);
      expect(link.searchParams.get("file")).toBe("Sunderfolk");
    }
  );

  const wrappedCases = [
    {
      kind: "a raw external download URL",
      indexerUrl: "http://prowlarr:9696/39/api",
      enclosure: "https://tracker.example/torrents/download/42.torrent",
      expectedHost: "prowlarr:9696",
    },
    {
      // Same host and shape, but the numeric id belongs to another indexer, so this is
      // not the proxy URL for the indexer we queried.
      kind: "a proxy-shaped link carrying a different Prowlarr indexer id",
      indexerUrl: "http://prowlarr:9696/39/api",
      enclosure: "http://172.19.0.8:9696/40/download?apikey=prowlarr-api-key&link=dG9rZW4%3D",
      expectedHost: "prowlarr:9696",
    },
    {
      // Prowlarr itself addressed by container IP, the workaround from issue #812. A
      // public host that mimics the proxy path is still an external link Prowlarr has
      // to fetch for us, so it must be wrapped and given the API key — the configured
      // host being private proves nothing about where the link points.
      kind: "a public proxy-shaped link for this indexer id when Prowlarr is addressed by IP",
      indexerUrl: "http://172.19.0.8:9696/39/api",
      enclosure: "https://tracker.example/39/download?file=Some+Game&link=dG9rZW4%3D",
      expectedHost: "172.19.0.8:9696",
    },
  ];

  it.each(wrappedCases)("still wraps $kind", async ({ indexerUrl, enclosure, expectedHost }) => {
    const link = await searchProwlarrLink(indexerUrl, enclosure);

    expect(link.host).toBe(expectedHost);
    expect(link.pathname).toBe("/39/download");
    expect(link.searchParams.get("apikey")).toBe("prowlarr-api-key");
    expect(Buffer.from(link.searchParams.get("link")!, "base64").toString()).toBe(enclosure);
  });

  it("re-wraps external URLs that mimic Prowlarr proxy path/query on a different host", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "http://localhost:9696/5/api",
      apiKey: "prowlarr-api-key",
    });
    const fakeProxyFromExternalHost =
      "https://tracker.example/5/download?file=Some+Game&link=aHR0cHM6Ly9leGFtcGxlLmNvbQ%3D%3D";
    mockFetchResponse(makeTorznabXml(fakeProxyFromExternalHost));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });
    const rewritten = new URL(result.items[0].link);

    expect(rewritten.hostname).toBe("localhost");
    expect(rewritten.pathname).toBe("/5/download");
    expect(rewritten.searchParams.get("apikey")).toBe("prowlarr-api-key");

    const nestedEncoded = rewritten.searchParams.get("link");
    expect(nestedEncoded).not.toBeNull();
    const decoded = Buffer.from(nestedEncoded!, "base64").toString("utf-8");
    expect(decoded).toBe(fakeProxyFromExternalHost);
  });

  it("does not double-wrap Prowlarr proxy URLs when Prowlarr uses a UrlBase", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "http://localhost:9696/prowlarr/5/api",
      apiKey: "prowlarr-api-key",
    });
    const prowlarrProxyUrlFromAlias =
      "http://127.0.0.1:9696/prowlarr/5/download?file=Some+Game&link=aHR0cHM6Ly9leGFtcGxlLmNvbS90b3JyZW50L2Rvd25sb2FkP2lkPTI%3D&apikey=prowlarr-api-key";
    mockFetchResponse(makeTorznabXml(prowlarrProxyUrlFromAlias));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });

    const rewritten = new URL(result.items[0].link);
    expect(rewritten.hostname).toBe("localhost");
    expect(rewritten.pathname).toBe("/prowlarr/5/download");
    expect(rewritten.searchParams.get("apikey")).toBe("prowlarr-api-key");
    expect(rewritten.searchParams.get("link")).toBe(
      "aHR0cHM6Ly9leGFtcGxlLmNvbS90b3JyZW50L2Rvd25sb2FkP2lkPTI="
    );
  });

  it("preserves UrlBase when building a Prowlarr proxy URL for raw external links", async () => {
    const prowlarrIndexer = makeIndexer({
      url: "https://prowlarr:9696/prowlarr/12/api",
      apiKey: "secret",
    });
    const rawUrl = "https://external-indexer.org/torrents/download/99999.torrent";
    mockFetchResponse(makeTorznabXml(rawUrl));

    const result = await client.searchGames(prowlarrIndexer, { query: "game" });

    const link = result.items[0].link;
    expect(link).toMatch(/^https:\/\/prowlarr:9696\/prowlarr\/12\/download\?/);

    const parsed = new URL(link);
    expect(parsed.searchParams.get("apikey")).toBe("secret");
    const decoded = Buffer.from(parsed.searchParams.get("link")!, "base64").toString();
    expect(decoded).toBe(rawUrl);
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

  it("logs torznab server version from caps", async () => {
    mockIsSafeUrl.mockResolvedValue(true);
    mockFetchResponse(makeCapsXml("2.4.0", "My Torznab"));

    await client.logVersionInfo(makeIndexer());

    expect(mockIsSafeUrl).toHaveBeenCalledWith(
      "http://indexer.example.com/api/?t=caps&apikey=testkey"
    );
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "http://indexer.example.com/api/?t=caps&apikey=testkey",
      expect.objectContaining({
        headers: { "User-Agent": "Questarr/1.0" },
      })
    );

    expect(torznabLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        indexer: "Test Indexer",
        protocol: "torznab",
        serverTitle: "My Torznab",
        serverVersion: "2.4.0",
      }),
      "Indexer version probe completed"
    );
  });

  it("logs torznab server version from the api caps endpoint when the configured URL omits it", async () => {
    mockIsSafeUrl.mockResolvedValue(true);
    mockFetchResponse(makeCapsXml("2.4.0", "My Torznab"));

    await client.logVersionInfo(makeIndexer({ url: "http://indexer.example.com/5" }));

    expect(mockIsSafeUrl).toHaveBeenCalledWith(
      "http://indexer.example.com/5/api/?t=caps&apikey=testkey"
    );
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "http://indexer.example.com/5/api/?t=caps&apikey=testkey",
      expect.objectContaining({
        headers: { "User-Agent": "Questarr/1.0" },
      })
    );
  });
});

describe("TorznabClient — testConnection", () => {
  let client: InstanceType<typeof TorznabClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TorznabClient();
  });

  it("reports success when the search succeeds", async () => {
    mockIsSafeUrl.mockResolvedValue(true);
    mockFetchResponse(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test</title></channel></rss>`
    );

    const result = await client.testConnection(makeIndexer());
    expect(result.success).toBe(true);
    expect(result.message).toContain("Successfully connected");
  });

  it("reports failure with the underlying error message", async () => {
    mockSafeFetch.mockRejectedValue(new Error("connection refused"));

    const result = await client.testConnection(makeIndexer());
    expect(result.success).toBe(false);
    expect(result.message).toContain("connection refused");
  });
});

describe("TorznabClient — getCategories", () => {
  let client: InstanceType<typeof TorznabClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TorznabClient();
  });

  it("throws when the indexer is disabled", async () => {
    await expect(client.getCategories(makeIndexer({ enabled: false }))).rejects.toThrow(
      "is disabled"
    );
  });

  it("parses a single category from the caps response", async () => {
    mockFetchResponse(
      `<?xml version="1.0"?><caps><categories><category id="2000" name="Movies"/></categories></caps>`
    );

    const categories = await client.getCategories(makeIndexer());
    expect(categories).toEqual([{ id: "2000", name: "Movies" }]);
  });

  it("parses multiple categories and falls back to a default name", async () => {
    mockFetchResponse(
      `<?xml version="1.0"?><caps><categories>` +
        `<category id="2000" name="Movies"/>` +
        `<category id="3000"/>` +
        `</categories></caps>`
    );

    const categories = await client.getCategories(makeIndexer());
    expect(categories).toEqual([
      { id: "2000", name: "Movies" },
      { id: "3000", name: "Category 3000" },
    ]);
  });

  it("returns an empty array when there are no categories", async () => {
    mockFetchResponse(`<?xml version="1.0"?><caps></caps>`);

    const categories = await client.getCategories(makeIndexer());
    expect(categories).toEqual([]);
  });

  it("throws a descriptive error when the response is not ok", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    } as Response);

    await expect(client.getCategories(makeIndexer())).rejects.toThrow("Failed to get categories");
  });
});
