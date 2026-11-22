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

const getDownloadingMock = vi.fn();
vi.mock("../storage.js", () => ({
  storage: {
    getDownloadingGameDownloads: (...args: unknown[]) => getDownloadingMock(...args),
  },
}));

const { TorBoxClient } = await import("../downloaders/torbox.js");
const { STAGING_MARKER } = await import("../downloaders/debrid-staging.js");

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, error: null, detail: "ok", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const failure = (error: string, detail: string, status = 400) =>
  new Response(JSON.stringify({ success: false, error, detail, data: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let stagingRoot: string;

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader =>
  ({
    id: "tb-1",
    name: "TorBox",
    type: "torbox",
    url: "https://api.torbox.app",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: true,
    urlPath: null,
    username: null,
    password: "secret-key",
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

const torrent = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  hash: "0123456789abcdef0123456789abcdef01234567",
  name: "My Game",
  size: 1000,
  progress: 0.4,
  download_state: "downloading",
  download_finished: false,
  download_present: false,
  download_speed: 5,
  seeds: 3,
  files: [],
  ...overrides,
});

const MAGNET = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

beforeEach(async () => {
  safeFetchMock.mockReset();
  getDownloadingMock.mockReset();
  getDownloadingMock.mockResolvedValue(
    ["7", "8", "9"].map((downloadHash) => ({ downloaderId: "tb-1", downloadHash }))
  );
  stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tb-staging-"));
});

afterEach(async () => {
  await fs.rm(stagingRoot, { recursive: true, force: true });
});

describe("TorBoxClient", () => {
  it("adds a magnet with the API key as a bearer token", async () => {
    safeFetchMock.mockResolvedValueOnce(reply({ torrent_id: 7 }));
    const result = await new TorBoxClient(createDownloader()).addDownload({
      url: MAGNET,
      title: "Game",
    });
    expect(result).toMatchObject({ success: true, id: "7" });
    const [url, init] = safeFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.torbox.app/v1/api/torrents/createtorrent");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect((init.body as FormData).get("magnet")).toBe(MAGNET);
    expect((init.body as FormData).get("as_queued")).toBe("false");
  });

  it("reports a queued torrent as not started", async () => {
    safeFetchMock.mockResolvedValueOnce(reply({ queued_id: 3 }));
    const result = await new TorBoxClient(createDownloader()).addDownload({
      url: MAGNET,
      title: "Game",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/queued/);
  });

  it("surfaces TorBox's own error text", async () => {
    safeFetchMock.mockResolvedValueOnce(failure("ACTIVE_LIMIT", "You have too many downloads"));
    const result = await new TorBoxClient(createDownloader()).addDownload({
      url: MAGNET,
      title: "Game",
    });
    expect(result).toMatchObject({ success: false });
    expect(result.message).toContain("You have too many downloads");
  });

  it("refuses to add without a staging path or an API key", async () => {
    const noPath = await new TorBoxClient(createDownloader({ downloadPath: null })).addDownload({
      url: MAGNET,
      title: "Game",
    });
    const noKey = await new TorBoxClient(createDownloader({ password: "" })).addDownload({
      url: MAGNET,
      title: "Game",
    });
    expect(noPath.success).toBe(false);
    expect(noKey.success).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("tests the connection and reports a rejected key", async () => {
    safeFetchMock.mockResolvedValueOnce(reply({ email: "x@example.com", plan: 2 }));
    expect(await new TorBoxClient(createDownloader()).testConnection()).toMatchObject({
      success: true,
    });
    // The account's e-mail address is never echoed.
    safeFetchMock.mockResolvedValueOnce(reply({ email: "x@example.com" }));
    expect((await new TorBoxClient(createDownloader()).testConnection()).message).not.toContain(
      "example.com"
    );

    safeFetchMock.mockResolvedValueOnce(failure("BAD_TOKEN", "bad", 403));
    const rejected = await new TorBoxClient(createDownloader()).testConnection();
    expect(rejected).toMatchObject({ success: false });
    expect(rejected.message).toMatch(/API key/);
  });

  it("maps TorBox states to a status", async () => {
    safeFetchMock.mockResolvedValueOnce(reply(torrent()));
    expect(await new TorBoxClient(createDownloader()).getDownloadStatus("7")).toMatchObject({
      status: "downloading",
      progress: 20,
      category: "games",
    });

    safeFetchMock.mockResolvedValueOnce(reply(torrent({ id: 8, download_state: "error" })));
    expect(await new TorBoxClient(createDownloader()).getDownloadStatus("8")).toMatchObject({
      status: "error",
    });

    safeFetchMock.mockResolvedValueOnce(reply(torrent({ id: 9, download_state: "paused" })));
    expect(await new TorBoxClient(createDownloader()).getDownloadStatus("9")).toMatchObject({
      status: "paused",
    });
  });

  it("returns null for a torrent TorBox does not have", async () => {
    safeFetchMock.mockResolvedValueOnce(failure("ITEM_NOT_FOUND", "not found", 404));
    expect(await new TorBoxClient(createDownloader()).getDownloadStatus("7")).toBeNull();
    // A server error is not "not found".
    safeFetchMock.mockResolvedValueOnce(new Response("boom", { status: 502 }));
    await expect(
      new TorBoxClient(createDownloader()).getDownloadStatus("7", { throwOnError: true })
    ).rejects.toThrow(/HTTP 502/);
  });

  it("copies the files locally and only then reports completion", async () => {
    const finished = torrent({
      download_state: "completed",
      download_finished: true,
      download_present: true,
      progress: 1,
      size: 11,
      files: [
        { id: 1, name: "My Game/setup.exe", short_name: "setup.exe", size: 5 },
        { id: 2, name: "My Game/data/pack.bin", short_name: "pack.bin", size: 6 },
      ],
    });
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/torrents/mylist")) return reply(finished);
      if (url.includes("/torrents/requestdl")) {
        const fileId = new URL(url).searchParams.get("file_id");
        return reply(`https://cdn.example/file-${fileId}`);
      }
      return new Response(url.endsWith("file-1") ? "12345" : "123456", { status: 200 });
    });

    const client = new TorBoxClient(createDownloader());
    const first = await client.getDownloadStatus("7");
    expect(first?.status).toBe("downloading");

    await vi.waitFor(() => fs.access(path.join(stagingRoot, "7", STAGING_MARKER)));
    const done = await client.getDownloadStatus("7");
    expect(done).toMatchObject({ status: "completed", progress: 100 });
    expect(await fs.readFile(path.join(stagingRoot, "7", "My Game", "setup.exe"), "utf8")).toBe(
      "12345"
    );
    expect(
      await fs.readFile(path.join(stagingRoot, "7", "My Game", "data", "pack.bin"), "utf8")
    ).toBe("123456");

    const details = await client.getDownloadDetails("7");
    expect(details?.downloadDir).toBe(path.join(stagingRoot, "7"));
    expect(details?.files.map((file) => file.name)).toEqual([
      "My Game/setup.exe",
      "My Game/data/pack.bin",
    ]);

    // The key goes in the query of requestdl only, never into a later request's URL.
    const requestdl = safeFetchMock.mock.calls
      .map(([url]) => url as string)
      .find((url) => url.includes("/torrents/requestdl"));
    expect(new URL(requestdl as string).searchParams.get("token")).toBe("secret-key");
  });

  it("never publishes completion for a short copy", async () => {
    const finished = torrent({
      id: 8,
      download_finished: true,
      download_present: true,
      progress: 1,
      size: 5,
      files: [{ id: 1, name: "g/a.bin", size: 5 }],
    });
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/torrents/mylist")) return reply(finished);
      if (url.includes("/torrents/requestdl")) return reply("https://cdn.example/f");
      return new Response("123", { status: 200 });
    });
    const client = new TorBoxClient(createDownloader());
    await client.getDownloadStatus("8");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(fs.access(path.join(stagingRoot, "8", STAGING_MARKER))).rejects.toThrow();
    expect((await client.getDownloadStatus("8"))?.status).toBe("downloading");
  });

  it("does not copy torrents Questarr never added", async () => {
    getDownloadingMock.mockResolvedValue([]);
    safeFetchMock.mockResolvedValue(
      reply(torrent({ download_finished: true, download_present: true, progress: 1 }))
    );
    const status = await new TorBoxClient(createDownloader()).getDownloadStatus("7");
    expect(status?.status).toBe("paused");
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists every torrent of the account", async () => {
    safeFetchMock.mockResolvedValueOnce(reply([torrent(), torrent({ id: 8, name: "Other" })]));
    const all = await new TorBoxClient(createDownloader()).getAllDownloads();
    expect(all.map((d) => d.id)).toEqual(["7", "8"]);
    const url = new URL(safeFetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/v1/api/torrents/mylist");
  });

  it("retries after a rate limit", async () => {
    safeFetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(reply(torrent()));
    const status = await new TorBoxClient(createDownloader()).getDownloadStatus("7");
    expect(status?.status).toBe("downloading");
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes a torrent and its staged copy, and treats an unknown one as removed", async () => {
    await fs.mkdir(path.join(stagingRoot, "7"), { recursive: true });
    safeFetchMock.mockResolvedValueOnce(reply(null));
    const removed = await new TorBoxClient(createDownloader()).removeDownload("7", true);
    expect(removed.success).toBe(true);
    const [, init] = safeFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ operation: "delete", torrent_id: 7 });
    await expect(fs.access(path.join(stagingRoot, "7"))).rejects.toThrow();

    safeFetchMock.mockResolvedValueOnce(failure("ITEM_NOT_FOUND", "gone", 404));
    expect((await new TorBoxClient(createDownloader()).removeDownload("8")).success).toBe(true);

    expect((await new TorBoxClient(createDownloader()).removeDownload("../etc")).success).toBe(
      false
    );
  });

  it("cannot pause or resume", async () => {
    const client = new TorBoxClient(createDownloader());
    expect((await client.pauseDownload("7")).success).toBe(false);
    expect((await client.resumeDownload("7")).success).toBe(false);
  });
});
