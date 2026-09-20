/**
 * Tests for the HTTP credential policy enforced by downloaderAllowsCredentials().
 *
 * Policy summary:
 *  - Credentials must not be sent over plain HTTP unless the user explicitly
 *    opts in via allowInsecureLan.
 *  - The decision is based on the *actual scheme of the resolved request URL*,
 *    not the downloader's `useSsl` config flag -- a downloader configured
 *    `useSsl: true` whose `url` field still literally starts with `http://`
 *    must still be denied, since that's what actually goes out on the wire.
 *  - An HTTPS resolved URL always permits credentials regardless of allowInsecureLan.
 *  - An HTTP resolved URL with allowInsecureLan=true permits credentials.
 *  - An HTTP resolved URL with allowInsecureLan=false (default) must throw before
 *    any credential is included in a network request.
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
  it("returns true when the resolved URL is https regardless of allowInsecureLan", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ allowInsecureLan: false }), "https://host")
    ).toBe(true);
    expect(
      downloaderAllowsCredentials(makeDownloader({ allowInsecureLan: true }), "https://host")
    ).toBe(true);
  });

  it("returns false when the resolved URL is http and allowInsecureLan=false", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ allowInsecureLan: false }), "http://host")
    ).toBe(false);
  });

  it("returns true when the resolved URL is http and allowInsecureLan=true", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ allowInsecureLan: true }), "http://host")
    ).toBe(true);
  });

  it("treats a malformed resolved URL as not HTTPS", () => {
    expect(
      downloaderAllowsCredentials(makeDownloader({ allowInsecureLan: false }), "not a url")
    ).toBe(false);
    expect(
      downloaderAllowsCredentials(makeDownloader({ allowInsecureLan: true }), "not a url")
    ).toBe(true);
  });

  it("ignores useSsl=true when the resolved URL still literally starts with http:// (the core bug)", () => {
    // A downloader can be configured useSsl: true while its `url` field is still
    // literally http:// -- each client's base-URL builder keeps whatever scheme is
    // literally present, so the guard must key off the resolved URL, not the flag.
    expect(
      downloaderAllowsCredentials(
        makeDownloader({ useSsl: true, allowInsecureLan: false }),
        "http://host"
      )
    ).toBe(false);
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

  it("sends the password when HTTP and allowInsecureLan=true", async () => {
    const jsonResponse = (result: unknown) => ({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ result, error: null, id: 1 }),
      text: async () => JSON.stringify({ result, error: null, id: 1 }),
    });

    // auth.login -> web.connected -> daemon.get_version
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse(true))
      .mockResolvedValueOnce(jsonResponse("2.1.1"));

    const client = new DelugeClient(
      makeDownloader({ type: "deluge", allowInsecureLan: true, password: "secret" })
    );
    const result = await client.testConnection();

    expect(result.success).toBe(true);
    // The first request is auth.login, carrying the password in its JSON-RPC body.
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string).params).toEqual(["secret"]);
  });
});

describe("qBittorrent HTTP credential policy (allow)", () => {
  it("sends the password when HTTP and allowInsecureLan=true", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: { getSetCookie: () => [], get: () => null },
        text: async () => "Ok.",
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        text: async () => "v4.3.9",
      });

    const client = new QBittorrentClient(
      makeDownloader({
        type: "qbittorrent",
        allowInsecureLan: true,
        username: "admin",
        password: "adminadmin",
      })
    );
    const result = await client.testConnection();

    expect(result.success).toBe(true);
    // The first request is the login, carrying username/password as form data.
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body as string).toContain("password=adminadmin");
  });
});

// Regression test for the bug this guard was fixed to close: a downloader configured
// useSsl: true (which permitted credentials unconditionally under the old
// flag-only check) whose `url` field still literally starts with http:// -- each
// client's base-URL builder keeps whatever scheme is literally present in `url`, so
// the real request still goes out in cleartext. The guard must key off the resolved
// request URL's actual scheme, not the useSsl flag, and reject this case.
describe("useSsl=true with a literal http:// url is rejected (resolved-URL regression)", () => {
  it.each([
    ["Deluge", (d: Downloader) => new DelugeClient(d), { type: "deluge" }],
    ["qBittorrent", (d: Downloader) => new QBittorrentClient(d), { type: "qbittorrent" }],
    ["Transmission", (d: Downloader) => new TransmissionClient(d), { type: "transmission" }],
  ] as const)("%s", async (_name, makeClient, overrides) => {
    const client = makeClient(
      makeDownloader({ ...overrides, useSsl: true, url: "http://localhost:9091" })
    );
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/refusing to send .* over unencrypted HTTP/);
    expect(fetchMock).not.toHaveBeenCalled();
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
