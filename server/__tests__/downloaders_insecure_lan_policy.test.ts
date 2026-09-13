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

// SABnzbd
import { SABnzbdClient } from "../downloaders/sabnzbd.js";

describe("SABnzbd HTTP credential policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("throws when HTTP and allowInsecureLan=false and apikey is set", async () => {
    const client = new SABnzbdClient(makeDownloader({ type: "sabnzbd", username: "mykey" }));
    await expect(client.testConnection()).rejects.toThrow(
      "SABnzbd: refusing to send API key over unencrypted HTTP"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends apikey when HTTP and allowInsecureLan=true", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ version: "4.0.0" }),
      json: async () => ({ version: "4.0.0" }),
    });
    const client = new SABnzbdClient(
      makeDownloader({ type: "sabnzbd", username: "mykey", allowInsecureLan: true })
    );
    await client.testConnection();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("apikey=mykey");
  });

  it("sends apikey when HTTPS (useSsl=true)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ version: "4.0.0" }),
      json: async () => ({ version: "4.0.0" }),
    });
    const client = new SABnzbdClient(
      makeDownloader({
        type: "sabnzbd",
        username: "mykey",
        useSsl: true,
        url: "https://localhost:9090",
      })
    );
    await client.testConnection();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("apikey=mykey");
  });
});

// Transmission
import { TransmissionClient } from "../downloaders/transmission.js";

describe("Transmission HTTP credential policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("throws when HTTP and allowInsecureLan=false and credentials set", async () => {
    const client = new TransmissionClient(makeDownloader({ type: "transmission" }));
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain(
      "Transmission: refusing to send credentials over unencrypted HTTP"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not throw when HTTP and allowInsecureLan=true", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => JSON.stringify({ arguments: { fields: [] }, result: "success" }),
      json: async () => ({ arguments: { fields: [] }, result: "success" }),
    });
    const client = new TransmissionClient(
      makeDownloader({ type: "transmission", allowInsecureLan: true })
    );
    await expect(client.testConnection()).resolves.not.toThrow();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toMatch(/^Basic /);
  });
});

// NZBGet
import { NZBGetClient } from "../downloaders/nzbget.js";

describe("NZBGet HTTP credential policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("throws when HTTP and allowInsecureLan=false and credentials set", async () => {
    const client = new NZBGetClient(makeDownloader({ type: "nzbget" }));
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain("NZBGet: refusing to send credentials over unencrypted HTTP");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends Authorization header when HTTP and allowInsecureLan=true", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ result: { version: "21" }, id: 1, error: null }),
    });
    const client = new NZBGetClient(makeDownloader({ type: "nzbget", allowInsecureLan: true }));
    await client.testConnection();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toMatch(/^Basic /);
  });
});

// qBittorrent
import { QBittorrentClient } from "../downloaders/qbittorrent.js";

describe("qBittorrent HTTP credential policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("throws when HTTP and allowInsecureLan=false and credentials set", async () => {
    const client = new QBittorrentClient(makeDownloader({ type: "qbittorrent" }));
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain(
      "qBittorrent: refusing to send credentials over unencrypted HTTP"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Deluge
import { DelugeClient } from "../downloaders/deluge.js";

describe("Deluge HTTP credential policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("throws when HTTP and allowInsecureLan=false and password set", async () => {
    const client = new DelugeClient(makeDownloader({ type: "deluge" }));
    const result = await client.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Deluge: refusing to send password over unencrypted HTTP");
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
