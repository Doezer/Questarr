import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SteamLibraryJobView } from "../../shared/steam-library.js";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  owned: vi.fn(),
  mappings: vi.fn(),
  game: vi.fn(),
  notify: vi.fn(),
  steam: { isConfigured: true, apiKey: "test-key" as string | undefined },
  user: { id: "", steamId64: "76561198000000000" as string | null },
}));
vi.mock("../auth.js", () => ({
  authenticateToken: (req: Request, res: Response, next: NextFunction) => {
    if (!fixtures.user.id) return res.sendStatus(401);
    req.user = fixtures.user;
    return next();
  },
}));
vi.mock("../config.js", () => ({ config: { steam: fixtures.steam } }));
vi.mock("../steam.js", () => ({ steamService: { getOwnedGames: fixtures.owned } }));
vi.mock("../socket.js", () => ({ notifyUser: fixtures.notify }));
vi.mock("../igdb.js", () => ({
  igdbClient: {
    getGameIdsBySteamAppIds: fixtures.mappings,
    getGamesByIds: (ids: number[]) => Promise.all(ids.map((id) => fixtures.game(id))),
    formatGameData: (game: { id: number; name: string; isAdultContent?: boolean }) => ({
      igdbId: game.id,
      title: game.name,
      isAdultContent: game.isAdultContent ?? false,
      isAgeRestricted: false,
      platforms: ["PC"],
      genres: [],
      themes: [],
    }),
  },
}));

describe.each(activeTestDialects())("Steam owned-library (%s)", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let userId: string;
  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const user = await ctx.storage.registerSetupUser({ username: "owner", passwordHash: "hash" });
    userId = user.id;
    await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    const { steamLibraryRoutes } = await import("../steam-library-routes.js");
    app = express();
    app.use(express.json());
    app.use(steamLibraryRoutes);
  }, 60_000);
  async function waitForJob(): Promise<SteamLibraryJobView> {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const response = await request(app).get("/api/steam/library/import/jobs/current");
      expect(response.status).toBe(200);
      const job = response.body.job as SteamLibraryJobView;
      if (job && job.state !== "queued" && job.state !== "running") return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Background import did not finish");
  }
  afterAll(async () => {
    await ctx?.teardown();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.user.id = userId;
    fixtures.user.steamId64 = "76561198000000000";
    fixtures.steam.isConfigured = true;
    fixtures.owned.mockResolvedValue([
      { steamAppId: 10, title: "First" },
      { steamAppId: 20, title: "Second" },
    ]);
    fixtures.mappings.mockResolvedValue(
      new Map([
        [10, 100],
        [20, 200],
      ])
    );
    fixtures.game.mockImplementation(async (id: number) => ({ id, name: `Game ${id}` }));
  });
  it("requires authentication, configuration and the linked ID", async () => {
    fixtures.user.id = "";
    expect((await request(app).get("/api/steam/library")).status).toBe(401);
    fixtures.user.id = userId;
    fixtures.steam.isConfigured = false;
    expect((await request(app).get("/api/steam/library")).status).toBe(400);
    fixtures.steam.isConfigured = true;
    fixtures.user.steamId64 = null;
    expect((await request(app).get("/api/steam/library")).status).toBe(400);
    expect(fixtures.owned).not.toHaveBeenCalled();
  });
  it("previews without writing, imports exact matches and preserves existing progress on retry", async () => {
    const before = await ctx.storage.getUserGames(userId, true);
    const preview = await request(app).get("/api/steam/library");
    expect(preview.status).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.body.games[0]).toMatchObject({ steamAppId: 10, alreadyTracked: false });
    expect(await ctx.storage.getUserGames(userId, true)).toEqual(before);
    const result = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [10, 10] });
    expect(result.body.results).toEqual([{ steamAppId: 10, title: "First", outcome: "added" }]);
    const added = (await ctx.storage.getUserGames(userId, true)).find(
      (game) => game.igdbId === 100
    )!;
    expect(added).toMatchObject({ steamAppId: 10, source: "steam", status: "owned" });
    await ctx.storage.updateGame(added.id, { status: "completed", userRating: 9 });
    const again = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [10] });
    expect(again.body.results[0].outcome).toBe("duplicate");
    expect(await ctx.storage.getGame(added.id)).toMatchObject({
      status: "completed",
      userRating: 9,
    });
    expect((await request(app).get("/api/steam/library")).body.games[0].alreadyTracked).toBe(true);
  });
  it("rejects unowned IDs and invalid or excessive selections before any write", async () => {
    for (const appIds of [[], [-1], ["10"], Array.from({ length: 51 }, (_, i) => i + 1)]) {
      expect((await request(app).post("/api/steam/library/import").send({ appIds })).status).toBe(
        400
      );
    }
    expect(
      (
        await request(app)
          .post("/api/steam/library/import")
          .send({ appIds: [999] })
      ).status
    ).toBe(400);
    expect(fixtures.mappings).not.toHaveBeenCalled();
  });
  it("skips unmapped and content-filtered games without guessing by title", async () => {
    fixtures.mappings.mockResolvedValueOnce(new Map());
    let result = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [20] });
    expect(result.body.results[0].outcome).toBe("not_found");
    fixtures.game.mockResolvedValueOnce({ id: 200, name: "Filtered", isAdultContent: true });
    result = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [20] });
    expect(result.body.results[0].outcome).toBe("not_found");
    expect((await ctx.storage.getUserGames(userId, true)).some((game) => game.igdbId === 200)).toBe(
      false
    );
  });
  it("reports upstream errors without leaking their message and releases the import lock", async () => {
    fixtures.owned.mockRejectedValueOnce(new Error("URL with secret"));
    const failed = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [10] });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("secret");
    expect(
      (
        await request(app)
          .post("/api/steam/library/import")
          .send({ appIds: [10] })
      ).status
    ).toBe(200);
  });

  it("keeps duplicate rows when another row fails and lets failed rows retry", async () => {
    const add = vi.spyOn(ctx.storage, "addGame").mockRejectedValueOnce(new Error("Database busy"));
    const response = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [10, 20] });
    expect(response.status).toBe(200);
    expect(response.body.results.map((row: { outcome: string }) => row.outcome)).toEqual([
      "duplicate",
      "failed",
    ]);
    expect(
      (
        await request(app)
          .post("/api/steam/library/import")
          .send({ appIds: [20] })
      ).body.results[0].outcome
    ).toBe("added");
    add.mockRestore();
  });

  it("links an existing IGDB entry so future previews recognize it without changing progress", async () => {
    const legacy = await ctx.storage.addGame({
      userId,
      igdbId: 300,
      title: "Legacy",
      status: "playing",
      userRating: 8,
    });
    await ctx.storage.updateGame(legacy.id, { userRating: 8 });
    fixtures.owned.mockResolvedValue([{ steamAppId: 30, title: "Legacy" }]);
    fixtures.mappings.mockResolvedValue(new Map([[30, 300]]));
    expect(
      (
        await request(app)
          .post("/api/steam/library/import")
          .send({ appIds: [30] })
      ).body.results[0].outcome
    ).toBe("duplicate");
    expect(await ctx.storage.getGame(legacy.id)).toMatchObject({
      steamAppId: 30,
      status: "playing",
      userRating: 8,
    });
    expect((await request(app).get("/api/steam/library")).body.games[0].alreadyTracked).toBe(true);
    expect(fixtures.game).not.toHaveBeenCalled();
  });

  it("batches metadata and loads the library once, deduplicating IDs added in the same batch", async () => {
    fixtures.owned.mockResolvedValue([
      { steamAppId: 40, title: "Edition A" },
      { steamAppId: 50, title: "Edition B" },
    ]);
    fixtures.mappings.mockResolvedValue(
      new Map([
        [40, 400],
        [50, 400],
      ])
    );
    const reads = vi.spyOn(ctx.storage, "getUserGames");
    const result = await request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [40, 50] });
    expect(result.body.results.map((row: { outcome: string }) => row.outcome)).toEqual([
      "added",
      "duplicate",
    ]);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(fixtures.game).toHaveBeenCalledTimes(1);
    reads.mockRestore();
  });

  it("rejects a simultaneous import for the same account", async () => {
    let release!: (games: Array<{ steamAppId: number; title: string }>) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fixtures.owned.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const first = request(app)
      .post("/api/steam/library/import")
      .send({ appIds: [10] })
      .then((response) => response);
    await started;
    expect(
      (
        await request(app)
          .post("/api/steam/library/import")
          .send({ appIds: [10] })
      ).status
    ).toBe(409);
    release([{ steamAppId: 10, title: "First" }]);
    expect((await first).status).toBe(200);
  });
  it("imports 1,000 games from one request, reads Steam once and bounds metadata batches", async () => {
    const owned = Array.from({ length: 1000 }, (_, i) => ({
      steamAppId: 2000 + i,
      title: `Bulk ${i}`,
    }));
    fixtures.owned.mockResolvedValue(owned);
    fixtures.mappings.mockImplementation(
      async (ids: number[]) => new Map(ids.map((id) => [id, id + 10_000]))
    );
    const response = await request(app)
      .post("/api/steam/library/import/jobs")
      .send({ appIds: owned.map((game) => game.steamAppId) });
    expect(response.status).toBe(202);
    expect(response.body.job.total).toBe(1000);
    const job = await waitForJob();
    expect(job).toMatchObject({
      state: "completed",
      processed: 1000,
      added: 1000,
      failed: 0,
      skipped: 0,
      canRetry: false,
    });
    expect(fixtures.owned).toHaveBeenCalledTimes(1);
    expect(fixtures.mappings).toHaveBeenCalledTimes(20);
    expect(fixtures.notify).toHaveBeenCalledTimes(20);
    for (const call of fixtures.notify.mock.calls) {
      expect(call).toEqual(["gameUpdated", expect.any(String), userId]);
    }
    for (const [ids] of fixtures.mappings.mock.calls) expect(ids.length).toBeLessThanOrEqual(50);
    expect(job.recentResults).toHaveLength(10);
    const hiddenPayload = (await request(app).get("/api/steam/library/import/jobs/current")).body
      .job;
    expect(hiddenPayload).not.toHaveProperty("steamId");
    expect(hiddenPayload).not.toHaveProperty("appIds");
  }, 60_000);

  it("rejects concurrent jobs and keeps status scoped to the account", async () => {
    let release!: (games: Array<{ steamAppId: number; title: string }>) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fixtures.owned.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    expect(
      (
        await request(app)
          .post("/api/steam/library/import/jobs")
          .send({ appIds: [10] })
      ).status
    ).toBe(202);
    await started;
    try {
      expect(
        (
          await request(app)
            .post("/api/steam/library/import/jobs")
            .send({ appIds: [10] })
        ).status
      ).toBe(409);
      expect(
        (
          await request(app)
            .post("/api/steam/library/import")
            .send({ appIds: [10] })
        ).status
      ).toBe(409);
      fixtures.user.id = "another-account";
      expect(
        (await request(app).get("/api/steam/library/import/jobs/current")).body.job
      ).toBeNull();
    } finally {
      fixtures.user.id = userId;
      release([{ steamAppId: 10, title: "First" }]);
    }
    expect((await waitForJob()).state).toBe("completed");
  });

  it("resumes a persisted checkpoint after restart without replaying completed batches", async () => {
    const { resumeSteamLibraryImports } = await import("../steam-library-jobs.js");
    await ctx.storage.setSystemConfig(
      `steam.library.import.${userId}`,
      JSON.stringify({
        id: randomUUID(),
        userId,
        steamId: fixtures.user.steamId64,
        appIds: [10, 6000, 6001],
        results: [{ steamAppId: 10, title: "First", outcome: "duplicate" }],
        state: "running",
      })
    );
    fixtures.owned.mockResolvedValue([
      { steamAppId: 6000, title: "Resume A" },
      { steamAppId: 6001, title: "Resume B" },
    ]);
    fixtures.mappings.mockImplementation(
      async (ids: number[]) => new Map(ids.map((id) => [id, id + 10_000]))
    );
    await resumeSteamLibraryImports();
    await resumeSteamLibraryImports();
    expect(await waitForJob()).toMatchObject({
      total: 3,
      processed: 3,
      added: 2,
      duplicates: 1,
      state: "completed",
    });
    expect(fixtures.owned).toHaveBeenCalledTimes(1);
    expect(fixtures.mappings).toHaveBeenCalledWith([6000, 6001]);
  });

  it("retries unfinished games after a later batch fails, preserving successful writes", async () => {
    const owned = Array.from({ length: 65 }, (_, i) => ({
      steamAppId: 7000 + i,
      title: `Retry ${i}`,
    }));
    fixtures.owned.mockResolvedValue(owned);
    let batches = 0;
    fixtures.mappings.mockImplementation(async (ids: number[]) => {
      if (++batches === 2) throw new Error("Provider URL with secret");
      return new Map(ids.map((id) => [id, id + 10_000]));
    });
    await request(app)
      .post("/api/steam/library/import/jobs")
      .send({ appIds: owned.map((game) => game.steamAppId) });
    const failed = await waitForJob();
    expect(failed).toMatchObject({
      state: "failed",
      total: 65,
      processed: 50,
      added: 50,
      canRetry: true,
    });
    expect(JSON.stringify(failed)).not.toContain("secret");
    fixtures.mappings.mockImplementation(
      async (ids: number[]) => new Map(ids.map((id) => [id, id + 10_000]))
    );
    expect((await request(app).post("/api/steam/library/import/jobs/retry").send({})).status).toBe(
      202
    );
    expect(await waitForJob()).toMatchObject({
      state: "completed",
      total: 15,
      processed: 15,
      added: 15,
      canRetry: false,
    });
    expect(
      (await ctx.storage.getUserGames(userId, true)).filter(
        (game) => (game.steamAppId ?? 0) >= 7000
      )
    ).toHaveLength(65);
    expect((await request(app).post("/api/steam/library/import/jobs/retry").send({})).status).toBe(
      400
    );
  });

  it("fails an unowned selection before writing and rejects malformed bulk requests", async () => {
    for (const appIds of [[], [-1], ["10"], Array.from({ length: 20001 }, () => 10)]) {
      expect(
        (await request(app).post("/api/steam/library/import/jobs").send({ appIds })).status
      ).toBe(400);
    }
    const writes = vi.spyOn(ctx.storage, "addGame");
    await request(app)
      .post("/api/steam/library/import/jobs")
      .send({ appIds: [999999] });
    expect(await waitForJob()).toMatchObject({ state: "failed", processed: 0, canRetry: true });
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
  it("offers a retry after a failed checkpoint write instead of showing stale running progress", async () => {
    fixtures.owned.mockResolvedValue([{ steamAppId: 8000, title: "Checkpoint" }]);
    fixtures.mappings.mockResolvedValue(new Map([[8000, 18000]]));
    const save = ctx.storage.setSystemConfig.bind(ctx.storage);
    let writes = 0;
    const broken = vi
      .spyOn(ctx.storage, "setSystemConfig")
      .mockImplementation(async (key, value) => {
        if (++writes >= 3) throw new Error("Temporary storage failure");
        return save(key, value);
      });
    await request(app)
      .post("/api/steam/library/import/jobs")
      .send({ appIds: [8000] });
    try {
      expect(await waitForJob()).toMatchObject({ state: "failed", processed: 0, canRetry: true });
    } finally {
      broken.mockRestore();
    }
    expect((await request(app).post("/api/steam/library/import/jobs/retry").send({})).status).toBe(
      202
    );
    expect(await waitForJob()).toMatchObject({
      state: "completed",
      processed: 1,
      duplicates: 1,
      added: 0,
    });
    expect(
      (await ctx.storage.getUserGames(userId, true)).filter((game) => game.steamAppId === 8000)
    ).toHaveLength(1);
  });

  it("keeps progress readable if the Steam configuration is removed", async () => {
    fixtures.steam.isConfigured = false;
    expect((await request(app).get("/api/steam/library/import/jobs/current")).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/steam/library/import/jobs")
          .send({ appIds: [10] })
      ).status
    ).toBe(400);
  });
  it("treats unmapped and content-filtered games as finished skips, not retryable failures", async () => {
    fixtures.owned.mockResolvedValue([
      { steamAppId: 8100, title: "Unmapped" },
      { steamAppId: 8101, title: "Filtered" },
    ]);
    fixtures.mappings.mockResolvedValue(new Map([[8101, 18101]]));
    fixtures.game.mockResolvedValue({ id: 18101, name: "Filtered", isAdultContent: true });
    await request(app)
      .post("/api/steam/library/import/jobs")
      .send({ appIds: [8100, 8101] });
    expect(await waitForJob()).toMatchObject({
      state: "completed",
      total: 2,
      processed: 2,
      skipped: 2,
      failed: 0,
      canRetry: false,
    });
    expect((await request(app).post("/api/steam/library/import/jobs/retry").send({})).status).toBe(
      400
    );
    expect(fixtures.owned).toHaveBeenCalledTimes(1);
    expect(fixtures.notify).not.toHaveBeenCalled();
    expect(
      (await request(app).get("/api/steam/library/import/jobs/current")).body.job
    ).toMatchObject({ total: 2, processed: 2 });
  });
});
