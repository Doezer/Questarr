import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { store, mockStorage, safeFetchMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    mockStorage: {
      getSystemConfig: vi.fn(async (key: string) => store.get(key)),
      setSystemConfig: vi.fn(async (key: string, value: string) => void store.set(key, value)),
      setSystemConfigBatch: vi.fn(async (entries: { key: string; value: string }[]) => {
        for (const { key, value } of entries) store.set(key, value);
      }),
      getUserGames: vi.fn(),
      getAllUsers: vi.fn(),
      getGame: vi.fn(),
      updateGameStatus: vi.fn(),
    },
    safeFetchMock: vi.fn(),
  };
});

vi.mock("../storage.js", () => ({ storage: mockStorage }));
vi.mock("../ssrf.js", () => ({ safeFetch: safeFetchMock }));
vi.mock("../credential-crypto.js", () => ({
  encryptCredential: async (value: string) => `enc:${value}`,
  decryptCredential: async (value: string) => value.replace(/^enc:/, ""),
}));
vi.mock("../middleware.js", () => ({
  sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import {
  readRommSettings,
  requestRommScanAfterImport,
  rommClient,
  writeRommSettings,
} from "../romm.js";
import { runScheduledRommSync, syncFromRomm } from "../romm-sync.js";
import { rommRouter } from "../routes/romm.js";

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

async function configure(extra: Record<string, unknown> = {}) {
  await writeRommSettings({
    enabled: true,
    url: "http://romm.lan:8080/",
    apiToken: "rmm_secret",
    ...extra,
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  // By default the stored row is the one the library read returned.
  mockStorage.getGame.mockImplementation(async (id: string) => {
    const games = (await mockStorage.getUserGames()) as Array<{ id: string }> | undefined;
    return games?.find((g) => g.id === id);
  });
});

describe("RomM settings", () => {
  it("stores the token encrypted and trims the URL", async () => {
    await configure();
    expect(store.get("romm.apiToken")).toBe("enc:rmm_secret");
    const settings = await readRommSettings();
    expect(settings).toMatchObject({
      enabled: true,
      url: "http://romm.lan:8080",
      apiToken: "rmm_secret",
      platformFolders: false,
      syncEnabled: false,
      scanAfterImport: true,
    });
  });
});

describe("RomM client", () => {
  it("sends the bearer token and refuses redirects", async () => {
    await configure();
    safeFetchMock.mockResolvedValue(json([{ id: 1 }, { id: 2 }]));
    expect(await rommClient.testConnection(await readRommSettings())).toBe(2);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("http://romm.lan:8080/api/platforms");
    expect(init.headers.Authorization).toBe("Bearer rmm_secret");
    expect(init.redirect).toBe("error");
  });

  it("explains a rejected token and an unreachable server", async () => {
    await configure();
    const settings = await readRommSettings();
    safeFetchMock.mockResolvedValueOnce(json({}, 401));
    await expect(rommClient.testConnection(settings)).rejects.toThrow(/rejected the API token/);
    safeFetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(rommClient.testConnection(settings)).rejects.toThrow(/Could not reach RomM/);
  });

  it("pages through every ROM", async () => {
    await configure();
    const page = (n: number, start: number) =>
      Array.from({ length: n }, (_, i) => ({ id: start + i, name: `Rom ${start + i}` }));
    safeFetchMock
      .mockResolvedValueOnce(json({ items: page(250, 0), total: 300 }))
      .mockResolvedValueOnce(json({ items: page(50, 250), total: 300 }));
    const roms = await rommClient.listAllRoms(await readRommSettings());
    expect(roms).toHaveLength(300);
    expect(safeFetchMock.mock.calls[1][0]).toContain("offset=250");
  });

  it("asks for a rescan only when enabled, and never throws", async () => {
    await configure({ scanAfterImport: false });
    requestRommScanAfterImport();
    await vi.waitFor(() => expect(mockStorage.getSystemConfig).toHaveBeenCalled());
    expect(safeFetchMock).not.toHaveBeenCalled();

    await configure({ scanAfterImport: true });
    safeFetchMock.mockRejectedValue(new Error("down"));
    requestRommScanAfterImport();
    await vi.waitFor(() => expect(safeFetchMock).toHaveBeenCalled());
    expect(safeFetchMock.mock.calls[0][0]).toBe("http://romm.lan:8080/api/tasks/scan");
    expect(safeFetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("falls back to the scan_library task on a RomM without the scan endpoint", async () => {
    await configure();
    const settings = await readRommSettings();
    safeFetchMock.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({}, 200));
    await rommClient.triggerScan(settings);
    expect(safeFetchMock.mock.calls[1][0]).toBe("http://romm.lan:8080/api/tasks/run/scan_library");
  });

  it("treats a scan already in flight as queued", async () => {
    await configure();
    safeFetchMock.mockResolvedValueOnce(json({}, 409));
    await expect(rommClient.triggerScan(await readRommSettings())).resolves.toBeUndefined();
    safeFetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(rommClient.triggerScan(await readRommSettings())).rejects.toThrow(/HTTP 500/);
  });
});

describe("RomM sync", () => {
  const game = (id: string, title: string, status: string, igdbId: number | null = null) => ({
    id,
    title,
    status,
    igdbId,
  });

  it("marks wanted matches as owned and never downgrades", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([
      game("a", "Chrono Trigger", "wanted", 1),
      game("b", "Super Metroid", "wanted"),
      game("c", "Earthbound", "playing", 3),
      game("d", "Untouched", "wanted", 4),
    ]);
    safeFetchMock.mockResolvedValue(
      json({
        items: [
          { id: 1, name: "Chrono Trigger (USA)", igdb_id: 1 },
          { id: 2, name: "Super Metroid", igdb_id: null },
          { id: 3, name: "EarthBound", igdb_id: 3 },
          { id: 4, name: "Unknown ROM", igdb_id: 999 },
        ],
        total: 4,
      })
    );
    const summary = await syncFromRomm("user-1");
    expect(summary).toEqual({
      totalRoms: 4,
      matched: 3,
      alreadyOwned: 1,
      markedOwned: 2,
      notInLibrary: 1,
    });
    expect(mockStorage.updateGameStatus).toHaveBeenCalledTimes(2);
    expect(mockStorage.updateGameStatus).toHaveBeenCalledWith(
      "a",
      { status: "owned" },
      { preserveCurated: true }
    );
    expect(mockStorage.updateGameStatus).toHaveBeenCalledWith(
      "b",
      { status: "owned" },
      { preserveCurated: true }
    );
    expect(store.get("romm.lastSync")).toBeTruthy();
  });

  it("does not fall back to the title when the IGDB ids disagree", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([game("r", "Remake Game", "wanted", 10)]);
    safeFetchMock.mockResolvedValue(
      json({ items: [{ id: 1, name: "Remake Game", igdb_id: 20 }], total: 1 })
    );
    const summary = await syncFromRomm("user-1");
    expect(summary.matched).toBe(0);
    expect(mockStorage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("ignores a title shared by two games when the ROM has no IGDB id", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([
      game("x", "Same Title", "wanted", 1),
      game("y", "Same Title", "wanted", 2),
    ]);
    safeFetchMock.mockResolvedValue(json({ items: [{ id: 1, name: "Same Title" }], total: 1 }));
    const summary = await syncFromRomm("user-1");
    expect(summary.matched).toBe(0);
    expect(mockStorage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("keeps a title match to the chosen target platform", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([
      { ...game("z", "Cross Platform", "wanted"), targetPlatformId: 19 },
    ]);
    safeFetchMock.mockResolvedValue(
      json({ items: [{ id: 1, name: "Cross Platform", platform_slug: "psx" }], total: 1 })
    );
    expect((await syncFromRomm("user-1")).matched).toBe(0);
    safeFetchMock.mockResolvedValue(
      json({ items: [{ id: 1, name: "Cross Platform", platform_slug: "snes" }], total: 1 })
    );
    expect((await syncFromRomm("user-1")).matched).toBe(1);
  });

  it("keeps an IGDB id match to the chosen target platform too", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([
      { ...game("z", "Cross Platform", "wanted"), igdbId: 77, targetPlatformId: 19 },
    ]);
    safeFetchMock.mockResolvedValue(
      json({
        items: [{ id: 1, name: "Cross Platform", igdb_id: 77, platform_slug: "psx" }],
        total: 1,
      })
    );
    expect((await syncFromRomm("user-1")).matched).toBe(0);
    safeFetchMock.mockResolvedValue(
      json({
        items: [{ id: 1, name: "Cross Platform", igdb_id: 77, platform_slug: "snes" }],
        total: 1,
      })
    );
    expect((await syncFromRomm("user-1")).matched).toBe(1);
  });

  it("keeps an IGDB id match when the target platform has no RomM slug", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([
      { ...game("z", "Odd Platform", "wanted"), igdbId: 78, targetPlatformId: 999999 },
    ]);
    safeFetchMock.mockResolvedValue(
      json({ items: [{ id: 1, name: "Odd Platform", igdb_id: 78, platform_slug: "x" }], total: 1 })
    );
    expect((await syncFromRomm("user-1")).matched).toBe(1);
  });

  it("leaves a game alone when it stopped being wanted during the sync", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([game("d", "Racing Game", "wanted", 55)]);
    mockStorage.getGame.mockResolvedValue({ ...game("d", "Racing Game", "downloading", 55) });
    safeFetchMock.mockResolvedValue(
      json({ items: [{ id: 1, name: "Racing Game", igdb_id: 55 }], total: 1 })
    );
    const summary = await syncFromRomm("user-1");
    expect(summary.markedOwned).toBe(0);
    expect(mockStorage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("survives a ROM without a name", async () => {
    await configure();
    mockStorage.getUserGames.mockResolvedValue([game("n", "Named", "wanted")]);
    safeFetchMock.mockResolvedValue(
      json({
        items: [
          { id: 1, name: null },
          { id: 2, name: "Named" },
        ],
        total: 2,
      })
    );
    const summary = await syncFromRomm("user-1");
    expect(summary.matched).toBe(1);
  });

  it("walks every page up to the reported total", async () => {
    await configure();
    const page = (from: number, n: number) =>
      json({
        items: Array.from({ length: n }, (_, i) => ({ id: from + i, name: `G${from + i}` })),
        total: 300,
      });
    safeFetchMock.mockResolvedValueOnce(page(0, 250)).mockResolvedValueOnce(page(250, 50));
    const roms = await rommClient.listAllRoms(await readRommSettings());
    expect(roms).toHaveLength(300);
  });

  it("refuses to run without a configuration", async () => {
    await expect(syncFromRomm("user-1")).rejects.toThrow(/not configured/);
  });

  it("the scheduled run fetches the RomM library once for all users", async () => {
    await configure({ syncEnabled: true });
    mockStorage.getAllUsers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mockStorage.getUserGames.mockResolvedValue([]);
    safeFetchMock.mockResolvedValue(json({ items: [], total: 0 }));
    await runScheduledRommSync();
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("the scheduled run needs auto-sync switched on", async () => {
    await configure();
    await runScheduledRommSync();
    expect(mockStorage.getAllUsers).not.toHaveBeenCalled();

    await configure({ syncEnabled: true });
    mockStorage.getAllUsers.mockResolvedValue([{ id: "u1" }]);
    mockStorage.getUserGames.mockResolvedValue([]);
    safeFetchMock.mockResolvedValue(json({ items: [], total: 0 }));
    await runScheduledRommSync();
    expect(mockStorage.getUserGames).toHaveBeenCalledWith("u1", true);
  });
});

describe("RomM routes", () => {
  const app = (withUser = true) => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      if (withUser) (req as { user?: unknown }).user = { id: "user-1" };
      next();
    });
    a.use("/api/settings/romm", rommRouter);
    return a;
  };

  it("requires authentication", async () => {
    expect((await request(app(false)).get("/api/settings/romm")).status).toBe(401);
  });

  it("masks the token and keeps it when the placeholder comes back", async () => {
    await configure();
    const res = await request(app()).get("/api/settings/romm");
    expect(res.body.apiToken).toBe("********");
    expect(JSON.stringify(res.body)).not.toContain("rmm_secret");

    const save = await request(app())
      .post("/api/settings/romm")
      .send({ url: "http://romm.lan:8080/", apiToken: "********", platformFolders: true });
    expect(save.status).toBe(200);
    expect(store.get("romm.apiToken")).toBe("enc:rmm_secret");
    expect(store.get("romm.platformFolders")).toBe("true");

    // A new URL needs a new token: the saved one is never sent to another host.
    const moved = await request(app())
      .post("/api/settings/romm")
      .send({ url: "https://romm.example", apiToken: "********" });
    expect(moved.status).toBe(400);
    expect(store.get("romm.url")).toBe("http://romm.lan:8080");
  });

  it("rejects a non-http URL and unknown fields", async () => {
    const bad = await request(app()).post("/api/settings/romm").send({ url: "file:///etc/passwd" });
    expect(bad.status).toBe(400);
    const extra = await request(app()).post("/api/settings/romm").send({ foo: 1 });
    expect(extra.status).toBe(400);
  });

  it("reports the outcome of a connection test and a sync", async () => {
    await configure();
    safeFetchMock.mockResolvedValueOnce(json([{ id: 1 }]));
    const ok = await request(app()).post("/api/settings/romm/test");
    expect(ok.body).toEqual({ success: true, platforms: 1 });

    // Candidate values are tried as typed, and are not saved.
    safeFetchMock.mockResolvedValueOnce(json([]));
    await request(app())
      .post("/api/settings/romm/test")
      .send({ url: "http://other:1/", apiToken: "rmm_typo" });
    const [url, init] = safeFetchMock.mock.calls.at(-1)!;
    expect(url).toBe("http://other:1/api/platforms");
    expect(init.headers.Authorization).toBe("Bearer rmm_typo");
    expect(store.get("romm.url")).toBe("http://romm.lan:8080");
    expect(store.get("romm.apiToken")).toBe("enc:rmm_secret");

    // The saved token never goes to another URL.
    safeFetchMock.mockClear();
    const leak = await request(app())
      .post("/api/settings/romm/test")
      .send({ url: "http://attacker:1", apiToken: "********" });
    expect(leak.status).toBe(400);
    expect(safeFetchMock).not.toHaveBeenCalled();

    safeFetchMock.mockResolvedValueOnce(json({}, 401));
    const denied = await request(app()).post("/api/settings/romm/test");
    expect(denied.status).toBe(502);
    expect(denied.body.error).toMatch(/token/);

    mockStorage.getUserGames.mockResolvedValue([]);
    safeFetchMock.mockResolvedValueOnce(json({ items: [], total: 0 }));
    const sync = await request(app()).post("/api/settings/romm/sync");
    expect(sync.body.summary.totalRoms).toBe(0);
  });
});
