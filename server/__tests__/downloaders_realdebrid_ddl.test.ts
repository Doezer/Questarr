import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DdlJob, Downloader } from "../../shared/schema.js";

const safeFetchMock = vi.fn();

vi.mock("../logger.js", () => ({
  downloadersLogger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

const jobs = new Map<string, DdlJob>();
vi.mock("../storage.js", () => ({
  storage: {
    getDownloadingGameDownloads: vi.fn().mockResolvedValue([]),
    updateDownloader: vi.fn(),
    addDdlJob: async (job: Omit<DdlJob, "createdAt"> & { createdAt?: Date }) => {
      const created = { ...job, password: job.password ?? null, createdAt: new Date() } as DdlJob;
      jobs.set(created.id, created);
      return created;
    },
    getDdlJob: async (id: string) => jobs.get(id),
    getDdlJobsByDownloader: async (downloaderId: string) =>
      [...jobs.values()].filter((j) => j.downloaderId === downloaderId),
    deleteDdlJob: async (id: string) => void jobs.delete(id),
  },
}));

const { RealDebridClient, STAGING_MARKER, isDdlJobId } =
  await import("../downloaders/realdebrid.js");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let stagingRoot: string;

const createDownloader = (): Downloader =>
  ({
    id: "rd-1",
    name: "Real-Debrid",
    type: "realdebrid",
    url: "https://api.real-debrid.com",
    enabled: true,
    priority: 1,
    password: "private-token",
    downloadPath: stagingRoot,
    category: "games",
  }) as Downloader;

const FILES: Record<string, { name: string; body: string }> = {
  "https://host.example/a": { name: "game.part1.rar", body: "AAAA" },
  "https://host.example/b": { name: "game.part2.rar", body: "BBBBBB" },
};

/** Mock Real-Debrid: unrestrict/link answers from FILES, direct URLs serve the body. */
function mockRealDebrid(overrides: Record<string, () => Response> = {}) {
  safeFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (overrides[url]) return overrides[url]();
    if (url.includes("/torrents?")) return new Response(null, { status: 204 });
    if (url.endsWith("/unrestrict/link")) {
      const link = new URLSearchParams(String(init?.body)).get("link") ?? "";
      const file = FILES[link];
      if (!file) return json({ error: "hoster_unavailable", error_code: 19 }, 503);
      return json({
        filename: file.name,
        filesize: file.body.length,
        download: `https://dl.example/${file.name}`,
      });
    }
    if (url.startsWith("https://dl.example/")) {
      const file = Object.values(FILES).find((f) => url.endsWith(f.name));
      return new Response(file?.body ?? "", { status: file ? 200 : 404 });
    }
    return json({}, 404);
  });
}

async function waitFor<T>(fn: () => Promise<T | null | false>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
}

beforeEach(async () => {
  safeFetchMock.mockReset();
  jobs.clear();
  stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rd-ddl-"));
});

afterEach(async () => {
  await fs.rm(stagingRoot, { recursive: true, force: true });
});

describe("Real-Debrid direct links", () => {
  it("fetches every part into staging and reports completion", async () => {
    mockRealDebrid();
    const client = new RealDebridClient(createDownloader());
    const added = await client.addLinks({
      gameId: "g1",
      title: "Some Game",
      links: Object.keys(FILES),
      password: "secret",
    });
    expect(added.success).toBe(true);
    expect(isDdlJobId(added.id ?? "")).toBe(true);

    const status = await waitFor(async () => {
      const s = await client.getDownloadStatus(added.id!);
      return s?.status === "completed" ? s : null;
    });
    expect(status).toMatchObject({ name: "Some Game", progress: 100, size: 10 });

    const dir = path.join(stagingRoot, added.id!);
    expect(await fs.readFile(path.join(dir, "game.part1.rar"), "utf8")).toBe("AAAA");
    expect(await fs.readFile(path.join(dir, "game.part2.rar"), "utf8")).toBe("BBBBBB");
    const marker = JSON.parse(await fs.readFile(path.join(dir, STAGING_MARKER), "utf8"));
    expect(marker).toMatchObject({ parts: 2, bytes: 10, archivePassword: "secret" });

    const details = await client.getDownloadDetails(added.id!);
    expect(details?.downloadDir).toBe(dir);
    expect(details?.files?.map((f) => f.name).sort()).toEqual(["game.part1.rar", "game.part2.rar"]);
    expect((await client.getAllDownloads()).map((d) => d.id)).toContain(added.id);
  });

  it("names the failing part and never publishes completion for a partial copy", async () => {
    mockRealDebrid();
    const client = new RealDebridClient(createDownloader());
    const added = await client.addLinks({
      gameId: "g1",
      title: "Broken",
      links: ["https://host.example/a", "https://host.example/dead"],
    });
    // Let the job fail, then it sits in its retry backoff: still "downloading", never completed.
    await new Promise((r) => setTimeout(r, 100));
    const status = await client.getDownloadStatus(added.id!);
    expect(status?.status).toBe("downloading");
    await expect(fs.access(path.join(stagingRoot, added.id!, STAGING_MARKER))).rejects.toBeTruthy();
  });

  it("backs off and retries when Real-Debrid answers 429", async () => {
    let calls = 0;
    mockRealDebrid();
    const inner = safeFetchMock.getMockImplementation()!;
    safeFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/unrestrict/check") && calls++ < 2) return json({}, 429);
      if (url.endsWith("/unrestrict/check")) {
        return json({ host: "host.example", filename: "a.rar", filesize: 4, supported: 1 });
      }
      return inner(url, init);
    });
    const client = new RealDebridClient(createDownloader());
    const [check] = await client.checkLinks(["https://host.example/a"]);
    expect(calls).toBe(3);
    expect(check).toMatchObject({ supported: true, filename: "a.rar", filesize: 4 });
  });

  it("reports unsupported and unreachable links without throwing", async () => {
    safeFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const link = new URLSearchParams(String(init?.body)).get("link");
      return link === "https://nope.example/x"
        ? json({ host: "nope.example", supported: 0 })
        : json({ error: "unknown_ressource", error_code: 7 }, 404);
    });
    const client = new RealDebridClient(createDownloader());
    const results = await client.checkLinks(["https://nope.example/x", "https://gone.example/y"]);
    expect(results[0]).toMatchObject({
      supported: false,
      error: expect.stringContaining("not supported"),
    });
    expect(results[1]).toMatchObject({ supported: false, error: expect.stringContaining("404") });
  });

  it("expands hoster folders and DLC containers into plain links", async () => {
    safeFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/hosts/regexFolder"))
        return json(["/^https:\\/\\/folder\\.example\\/.+$/"]);
      if (url.endsWith("/unrestrict/folder")) {
        return json(["https://host.example/a", "https://host.example/b"]);
      }
      if (url.endsWith("/unrestrict/containerFile")) {
        expect(init?.method).toBe("PUT");
        return json(["https://host.example/b", "https://host.example/c"]);
      }
      return json({}, 404);
    });
    const client = new RealDebridClient(createDownloader());
    const links = await client.expandLinks(
      ["https://folder.example/xyz", "https://host.example/z"],
      Buffer.from("DLC")
    );
    expect(links).toEqual([
      "https://host.example/a",
      "https://host.example/b",
      "https://host.example/z",
      "https://host.example/c",
    ]);
  });

  it("removing a job stops it, forgets it and deletes the staged files on request", async () => {
    mockRealDebrid();
    const client = new RealDebridClient(createDownloader());
    const added = await client.addLinks({ gameId: "g1", title: "X", links: Object.keys(FILES) });
    await waitFor(async () => (await client.getDownloadStatus(added.id!))?.status === "completed");
    const removed = await client.removeDownload(added.id!, true);
    expect(removed.success).toBe(true);
    expect(await client.getDownloadStatus(added.id!)).toBeNull();
    await expect(fs.access(path.join(stagingRoot, added.id!))).rejects.toBeTruthy();
  });
});
