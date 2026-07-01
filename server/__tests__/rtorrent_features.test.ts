import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { RTorrentClient } from "../downloaders";
import type { Downloader } from "@shared/schema";

// Mock parse-torrent
vi.mock("parse-torrent", () => ({
  default: vi.fn((_buffer) => ({
    infoHash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    name: "Test Game",
  })),
}));

// Mock ssrf — allow all URLs and pass through to global fetch
vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: vi.fn((url: string, options: RequestInit) => fetch(url, options)),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock;

const testDownloader: Downloader = {
  id: "rtorrent-id",
  name: "Test rTorrent",
  type: "rtorrent",
  url: "http://localhost/RPC2",
  enabled: true,
  priority: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// rTorrent uses XML-RPC; build a minimal success response
const xmlRpcSuccess = `<?xml version="1.0"?>
<methodResponse><params><param><value><int>0</int></value></param></params></methodResponse>`;

describe("RTorrentClient - magnet link handling", () => {
  let client: RTorrentClient;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    client = new RTorrentClient(testDownloader);
  });

  it("should add a direct magnet link via load.start", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlRpcSuccess,
      headers: { get: () => null },
    });

    const result = await client.addDownload({
      url: "magnet:?xt=urn:btih:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef&dn=Test+Game",
      title: "Test Game",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

    // The XML-RPC call should use load.start with the magnet URI
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain("load.start");
    expect(body).toContain("magnet:");
  });

  it("should detect a magnet redirect and add via load.start", async () => {
    const magnetUri =
      "magnet:?xt=urn:btih:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef&dn=Redirected+Game";

    // Mock 1: indexer redirects to magnet
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: { get: (name: string) => (name === "location" ? magnetUri : null) },
    });

    // Mock 2: XML-RPC load.start
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlRpcSuccess,
      headers: { get: () => null },
    });

    const result = await client.addDownload({
      url: "http://indexer.com/download/game.torrent",
      title: "Redirected Game",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

    // First call: the torrent file fetch (returns redirect)
    expect(fetchMock.mock.calls[0][0]).toBe("http://indexer.com/download/game.torrent");

    // Second call: XML-RPC load.start with the magnet URI
    const body = fetchMock.mock.calls[1][1].body as string;
    expect(body).toContain("load.start");
    expect(body).toContain("magnet:");
  });

  it("should download a torrent file and add via load.raw_start", async () => {
    // Mock 1: successful torrent file download
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("mock torrent content"),
      headers: { get: () => null },
    });

    // Mock 2: XML-RPC load.raw_start
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlRpcSuccess,
      headers: { get: () => null },
    });

    const result = await client.addDownload({
      url: "http://indexer.com/download/game.torrent",
      title: "Normal Game",
    });

    expect(result.success).toBe(true);

    // Second call should use load.raw_start
    const body = fetchMock.mock.calls[1][1].body as string;
    expect(body).toContain("load.raw_start");
  });

  it("should use load.normal (not load.start) when addStopped is true", async () => {
    const stoppedDownloader: Downloader = { ...testDownloader, addStopped: true };
    const stoppedClient = new RTorrentClient(stoppedDownloader);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlRpcSuccess,
      headers: { get: () => null },
    });

    const result = await stoppedClient.addDownload({
      url: "magnet:?xt=urn:btih:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      title: "Stopped Game",
    });

    expect(result.success).toBe(true);
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain("load.normal");
  });
});

describe("RTorrentClient - digest auth header computation", () => {
  let client: RTorrentClient & {
    computeDigestHeader(
      method: string,
      uri: string,
      authHeader: string,
      username: string,
      password: string
    ): string;
  };

  beforeEach(() => {
    client = new RTorrentClient(testDownloader) as typeof client;
  });

  it("falls back to MD5 for a classic RFC 2617 challenge with no algorithm", () => {
    const authHeader = 'Digest realm="rtorrent", nonce="abc123", qop="auth"';
    const auth = client.computeDigestHeader("POST", "/RPC2", authHeader, "user", "pass");

    expect(auth).toContain('algorithm="MD5"');

    const ha1 = crypto.createHash("md5").update("user:rtorrent:pass").digest("hex");
    const ha2 = crypto.createHash("md5").update("POST:/RPC2").digest("hex");
    const responseMatch = auth.match(/response="([a-f0-9]+)"/);
    const cnonceMatch = auth.match(/cnonce="([a-f0-9]+)"/);
    expect(responseMatch).not.toBeNull();
    expect(cnonceMatch).not.toBeNull();
    const nc = "00000001";
    const expectedResponse = crypto
      .createHash("md5")
      .update(`${ha1}:abc123:${nc}:${cnonceMatch![1]}:auth:${ha2}`)
      .digest("hex");
    expect(responseMatch![1]).toBe(expectedResponse);
  });

  it("uses SHA-256 when the server's challenge declares algorithm=SHA-256 (RFC 7616)", () => {
    const authHeader = 'Digest realm="rtorrent", nonce="abc123", qop="auth", algorithm="SHA-256"';
    const auth = client.computeDigestHeader("POST", "/RPC2", authHeader, "user", "pass");

    expect(auth).toContain('algorithm="SHA-256"');

    const ha1 = crypto.createHash("sha256").update("user:rtorrent:pass").digest("hex");
    const ha2 = crypto.createHash("sha256").update("POST:/RPC2").digest("hex");
    const responseMatch = auth.match(/response="([a-f0-9]+)"/);
    const cnonceMatch = auth.match(/cnonce="([a-f0-9]+)"/);
    expect(responseMatch).not.toBeNull();
    expect(cnonceMatch).not.toBeNull();
    const nc = "00000001";
    const expectedResponse = crypto
      .createHash("sha256")
      .update(`${ha1}:abc123:${nc}:${cnonceMatch![1]}:auth:${ha2}`)
      .digest("hex");
    expect(responseMatch![1]).toBe(expectedResponse);
  });
});
