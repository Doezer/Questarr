/**
 * Tests for the HTTP credential policy enforced by downloaderAllowsCredentials().
 *
 * Policy summary:
 *  - Credentials must not be sent over plain HTTP unless the user explicitly
 *    opts in via allowInsecureLan.
 *  - HTTPS (useSsl=true) always permits credentials regardless of allowInsecureLan.
 *  - HTTP with allowInsecureLan=true permits credentials.
 *  - HTTP with allowInsecureLan=false (default) must throw before any credential
 *    is included in a network request.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Downloader } from "../../shared/schema.js";
import { downloaderAllowsCredentials } from "../downloaders/utils.js";

// ─── helper ──────────────────────────────────────────────────────────────────

const makeDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "policy-test",
    name: "Test",
    type: "transmission",
    url: "http://localhost:9091",
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
    allowSelfSignedCertificate: false,
    allowInsecureLan: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

// ─── downloaderAllowsCredentials unit tests ──────────────────────────────────

describe("downloaderAllowsCredentials", () => {
  it("returns true when useSsl=true regardless of allowInsecureLan", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ useSsl: true, allowInsecureLan: false }))
    ).toBe(true);
    expect(
      downloaderAllowsCredentials(makeDownloader({ useSsl: true, allowInsecureLan: true }))
    ).toBe(true);
  });

  it("returns false when useSsl=false and allowInsecureLan=false", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ useSsl: false, allowInsecureLan: false }))
    ).toBe(false);
  });

  it("returns true when useSsl=false and allowInsecureLan=true", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ useSsl: false, allowInsecureLan: true }))
    ).toBe(true);
  });

  it("treats null/undefined useSsl as falsy", () => {
    expect(
      downloaderAllowsCredentials(
        makeDownloader({ useSsl: null as unknown as boolean, allowInsecureLan: false })
      )
    ).toBe(false);
    expect(
      downloaderAllowsCredentials(
        makeDownloader({ useSsl: null as unknown as boolean, allowInsecureLan: true })
      )
    ).toBe(true);
  });
});

// ─── per-client integration tests ────────────────────────────────────────────

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
  isSafeUrl: vi.fn().mockReturnValue(true),
  resolveSafeAddress: vi.fn(),
}));

import { safeFetch } from "../ssrf.js";
const fetchMock = safeFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
});

import { SABnzbdClient } from "../downloaders/sabnzbd.js";
import { TransmissionClient } from "../downloaders/transmission.js";
import { NZBGetClient } from "../downloaders/nzbget.js";
import { QBittorrentClient } from "../downloaders/qbittorrent.js";
import { DelugeClient } from "../downloaders/deluge.js";
import { RTorrentClient } from "../downloaders/rtorrent.js";
import { SynologyDownloadStationClient } from "../downloaders/synology.js";

interface DenyCase {
  client: string;
  downloader: Partial<Downloader>;
  expectedMessageFragment: string;
  makeClient: (downloader: Downloader) => {
    testConnection(): Promise<{ success: boolean; message: string }>;
  };
}

// Every client refuses to put a credential on the wire before it's asked to send
// one over plain HTTP without the insecure-LAN opt-in -- same guard, same shape
// of assertion, so the case is driven from one table instead of one block per client.
const denyCases: DenyCase[] = [
  {
    client: "SABnzbd",
    downloader: { type: "sabnzbd", username: "mykey" },
    expectedMessageFragment: "SABnzbd: refusing to send API key over unencrypted HTTP",
    makeClient: (d) => new SABnzbdClient(d),
  },
  {
    client: "Transmission",
    downloader: { type: "transmission" },
    expectedMessageFragment: "Transmission: refusing to send credentials over unencrypted HTTP",
    makeClient: (d) => new TransmissionClient(d),
  },
  {
    client: "NZBGet",
    downloader: { type: "nzbget" },
    expectedMessageFragment: "NZBGet: refusing to send credentials over unencrypted HTTP",
    makeClient: (d) => new NZBGetClient(d),
  },
  {
    client: "qBittorrent",
    downloader: { type: "qbittorrent" },
    expectedMessageFragment: "qBittorrent: refusing to send credentials over unencrypted HTTP",
    makeClient: (d) => new QBittorrentClient(d),
  },
  {
    client: "Deluge",
    downloader: { type: "deluge" },
    expectedMessageFragment: "Deluge: refusing to send password over unencrypted HTTP",
    makeClient: (d) => new DelugeClient(d),
  },
  {
    client: "rTorrent",
    downloader: { type: "rtorrent" },
    expectedMessageFragment: "rTorrent: refusing to send credentials over unencrypted HTTP",
    makeClient: (d) => new RTorrentClient(d),
  },
  {
    client: "Synology",
    downloader: { type: "synology" },
    expectedMessageFragment: "Synology: refusing to send credentials over unencrypted HTTP",
    makeClient: (d) => new SynologyDownloadStationClient(d),
  },
];

describe.each(denyCases)(
  "$client HTTP credential policy (deny)",
  ({ downloader, expectedMessageFragment, makeClient }) => {
    it("throws when HTTP and allowInsecureLan=false and credentials set", async () => {
      const client = makeClient(makeDownloader(downloader));
      const result = await client.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain(expectedMessageFragment);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
);

// Each client's opt-in path is asserted separately below, since what "the
// credential made it onto the wire" looks like differs per client: a URL query
// param, an Authorization header, or (Synology) simply reaching the network.

describe("SABnzbd HTTP credential policy (allow)", () => {
  const versionResponse = {
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify({ version: "4.0.0" }),
    json: async () => ({ version: "4.0.0" }),
  };

  it.each([
    [
      "HTTP and allowInsecureLan=true",
      { type: "sabnzbd", username: "mykey", allowInsecureLan: true },
    ],
    [
      "HTTPS (useSsl=true)",
      { type: "sabnzbd", username: "mykey", useSsl: true, url: "https://localhost:9090" },
    ],
  ] as const)("sends apikey when %s", async (_label, overrides) => {
    fetchMock.mockResolvedValueOnce(versionResponse);
    const client = new SABnzbdClient(makeDownloader(overrides));
    await client.testConnection();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("apikey=mykey");
  });
});

// Transmission, NZBGet and rTorrent all authenticate the same way once the
// policy permits it -- a Basic Authorization header -- so their opt-in cases
// share one table instead of three near-identical describe/it pairs.
const rtorrentVersionResponse = {
  ok: true,
  headers: { get: () => "text/xml" },
  text: async () =>
    '<?xml version="1.0"?><methodResponse><params><param><value><string>0.9.8</string></value></param></params></methodResponse>',
};

describe("Basic-Auth-header credential policy (allow)", () => {
  it.each([
    [
      "Transmission: HTTP and allowInsecureLan=true",
      (d: Downloader) => new TransmissionClient(d),
      { type: "transmission", allowInsecureLan: true },
      {
        ok: true,
        headers: { get: () => null, getSetCookie: () => [] },
        text: async () => JSON.stringify({ arguments: { fields: [] }, result: "success" }),
        json: async () => ({ arguments: { fields: [] }, result: "success" }),
      },
    ],
    [
      "NZBGet: HTTP and allowInsecureLan=true",
      (d: Downloader) => new NZBGetClient(d),
      { type: "nzbget", allowInsecureLan: true },
      {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ result: { version: "21" }, id: 1, error: null }),
      },
    ],
    [
      "rTorrent: HTTP and allowInsecureLan=true",
      (d: Downloader) => new RTorrentClient(d),
      { type: "rtorrent", allowInsecureLan: true },
      rtorrentVersionResponse,
    ],
    [
      "rTorrent: HTTPS (useSsl=true)",
      (d: Downloader) => new RTorrentClient(d),
      { type: "rtorrent", useSsl: true, url: "https://localhost:9091" },
      rtorrentVersionResponse,
    ],
  ] as const)("%s", async (_name, makeClient, overrides, response) => {
    fetchMock.mockResolvedValueOnce(response);
    const client = makeClient(makeDownloader(overrides));
    await client.testConnection();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toMatch(/^Basic /);
  });
});

describe("Deluge HTTP credential policy (allow)", () => {
  it("does not throw when no password configured", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ result: true, error: null, id: 1 }),
      text: async () => JSON.stringify({ result: true, error: null, id: 1 }),
    });
    const client = new DelugeClient(makeDownloader({ type: "deluge", password: null }));
    // With no password, should proceed (empty string password with allowInsecureLan=false
    // is allowed because the guard only fires when password is truthy)
    await expect(client.testConnection()).resolves.not.toThrow();
  });
});

describe("Synology HTTP credential policy (allow)", () => {
  it("proceeds past the transport guard when HTTP and allowInsecureLan=true", async () => {
    // No credentials-policy error this time -- the request now reaches the network
    // and fails for an unrelated (mocked) reason instead.
    fetchMock.mockRejectedValue(new Error("network unreachable"));
    const client = new SynologyDownloadStationClient(
      makeDownloader({ type: "synology", allowInsecureLan: true })
    );
    const result = await client.testConnection();
    expect(result.message).not.toContain("refusing to send credentials");
    expect(fetchMock).toHaveBeenCalled();
  });
});
