import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Downloader } from "../../shared/schema.js";

const safeFetchMock = vi.fn();

vi.mock("../logger.js", () => ({
  downloadersLogger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

const { RealDebridClient, STAGING_MARKER } = await import("../downloaders/realdebrid.js");
const { parseRealDebridCredentials } = await import("../downloaders/realdebrid-auth.js");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let stagingRoot: string;

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader =>
  ({
    id: "rd-1",
    name: "Real-Debrid",
    type: "realdebrid",
    url: "https://api.real-debrid.com",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: true,
    urlPath: null,
    username: null,
    password: "private-token",
    downloadPath: stagingRoot,
    category: "games",
    label: "Questarr",
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    allowSelfSignedCertificate: false,
    allowInsecureLan: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Downloader;

beforeEach(async () => {
  safeFetchMock.mockReset();
  stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rd-staging-"));
});

afterEach(async () => {
  await fs.rm(stagingRoot, { recursive: true, force: true });
});

describe("parseRealDebridCredentials", () => {
  it("accepts a bare token and the device-flow JSON", () => {
    expect(parseRealDebridCredentials("abc")).toEqual({ accessToken: "abc" });
    expect(
      parseRealDebridCredentials(JSON.stringify({ accessToken: "t", refreshToken: "r" }))
    ).toMatchObject({ accessToken: "t", refreshToken: "r" });
    expect(parseRealDebridCredentials("{not json")).toBeNull();
    expect(parseRealDebridCredentials("")).toBeNull();
  });
});

describe("RealDebridClient", () => {
  it("adds a magnet and selects all files", async () => {
    safeFetchMock
      .mockResolvedValueOnce(json({ id: "TID" }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await new RealDebridClient(createDownloader()).addDownload({
      url: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
      title: "Game",
    });
    expect(result).toMatchObject({ success: true, id: "TID" });
    const [url, init] = safeFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/torrents/addMagnet");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer private-token");
  });

  it("refuses to add without a staging path", async () => {
    const result = await new RealDebridClient(createDownloader({ downloadPath: null })).addDownload(
      {
        url: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
        title: "Game",
      }
    );
    expect(result.success).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("maps Real-Debrid phases to a status", async () => {
    safeFetchMock.mockResolvedValueOnce(
      json({ id: "A", filename: "g", bytes: 1000, progress: 40, status: "downloading", speed: 5 })
    );
    const status = await new RealDebridClient(createDownloader()).getDownloadStatus("A");
    expect(status).toMatchObject({ status: "downloading", progress: 20, category: "games" });

    safeFetchMock.mockResolvedValueOnce(
      json({ id: "B", filename: "g", bytes: 1, progress: 0, status: "virus" })
    );
    expect(await new RealDebridClient(createDownloader()).getDownloadStatus("B")).toMatchObject({
      status: "error",
    });
  });

  it("returns null on 404 and throws on request when asked to", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await new RealDebridClient(createDownloader()).getDownloadStatus("X")).toBeNull();

    safeFetchMock.mockRejectedValueOnce(new Error("network"));
    await expect(
      new RealDebridClient(createDownloader()).getDownloadStatus("X", { throwOnError: true })
    ).rejects.toThrow("network");
  });

  it("stages a downloaded torrent locally before reporting it completed", async () => {
    const torrent = {
      id: "T1",
      filename: "Game",
      bytes: 5,
      progress: 100,
      status: "downloaded",
      files: [
        { id: 1, path: "/Game/data/a.bin", bytes: 5, selected: 1 },
        { id: 2, path: "/Game/skip.txt", bytes: 1, selected: 0 },
      ],
      links: ["https://real-debrid.com/d/ABC"],
    };
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/torrents/info/T1")) return json(torrent);
      if (url.includes("/unrestrict/link")) {
        return json({ filename: "a.bin", filesize: 5, download: "https://cdn.example/a.bin" });
      }
      if (url === "https://cdn.example/a.bin") return new Response("hello");
      throw new Error(`unexpected ${url}`);
    });

    const client = new RealDebridClient(createDownloader());
    const first = await client.getDownloadStatus("T1");
    expect(first?.status).toBe("downloading");

    await vi.waitFor(async () => {
      await fs.access(path.join(stagingRoot, "T1", STAGING_MARKER));
    });
    expect(await fs.readFile(path.join(stagingRoot, "T1", "Game", "data", "a.bin"), "utf8")).toBe(
      "hello"
    );

    const details = await client.getDownloadDetails("T1");
    expect(details).toMatchObject({
      status: "completed",
      downloadDir: path.join(stagingRoot, "T1"),
    });
    expect(details?.files.map((f) => f.name)).toEqual(["Game/data/a.bin"]);
  });

  it("never writes outside the staging folder", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/torrents/info/T2")) {
        return json({
          id: "T2",
          filename: "Evil",
          bytes: 1,
          progress: 100,
          status: "downloaded",
          files: [{ id: 1, path: "/../../escape.txt", bytes: 1, selected: 1 }],
          links: ["https://real-debrid.com/d/X"],
        });
      }
      if (url.includes("/unrestrict/link")) {
        return json({ filename: "escape.txt", filesize: 1, download: "https://cdn.example/e" });
      }
      return new Response("x");
    });
    const client = new RealDebridClient(createDownloader());
    await client.getDownloadStatus("T2");
    await vi.waitFor(async () => {
      expect((await client.getDownloadStatus("T2"))?.status).not.toBe("downloading");
    });
    await expect(fs.access(path.join(stagingRoot, "..", "escape.txt"))).rejects.toThrow();
  });

  it("removes the torrent and its staged files", async () => {
    await fs.mkdir(path.join(stagingRoot, "T3"));
    safeFetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await new RealDebridClient(createDownloader()).removeDownload("T3", true);
    expect(result.success).toBe(true);
    await expect(fs.access(path.join(stagingRoot, "T3"))).rejects.toThrow();
  });

  it("refreshes an expired token and keeps the new one", async () => {
    const stored = JSON.stringify({
      accessToken: "old",
      refreshToken: "r",
      clientId: "c",
      clientSecret: "s",
      expiresAt: Date.now() - 1000,
    });
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/oauth/v2/token")) {
        return json({
          access_token: "new",
          refresh_token: "r2",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return json({ username: "vin", type: "premium" });
    });
    const result = await new RealDebridClient(
      createDownloader({ password: stored })
    ).testConnection();
    expect(result.success).toBe(true);
    const apiCall = safeFetchMock.mock.calls.find(([u]) => String(u).includes("/rest/1.0/user"));
    expect(((apiCall?.[1] as RequestInit).headers as Record<string, string>).Authorization).toBe(
      "Bearer new"
    );
  });
});
