import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  achievements: vi.fn(),
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
vi.mock("../middleware.js", () => ({
  sensitiveEndpointLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../config.js", () => ({ config: { steam: fixtures.steam } }));
vi.mock("../socket.js", () => ({ notifyUser: fixtures.notify }));
vi.mock("../apprise.js", () => ({ appriseClient: { send: vi.fn() } }));
vi.mock("../steam.js", () => ({
  steamService: { getPlayerAchievements: fixtures.achievements },
}));

const T0 = new Date("2026-11-22T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

const entry = (name: string, achieved: boolean, globalPercent: number | null, unlockedAt = 0) => ({
  apiName: name,
  displayName: name.toUpperCase(),
  description: null,
  icon: "",
  iconGray: "",
  hidden: false,
  achieved,
  unlockedAt: achieved ? unlockedAt : null,
  globalPercent,
});

describe.each(activeTestDialects())("Steam achievements sync (%s)", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let userId: string;
  let gameId: string;
  let sync: typeof import("../steam-achievements.js");

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const user = await ctx.storage.registerSetupUser({ username: "owner", passwordHash: "hash" });
    userId = user.id;
    await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    sync = await import("../steam-achievements.js");
    const { steamAchievementsRoutes } = await import("../steam-achievements-routes.js");
    app = express();
    app.use(express.json());
    app.use(steamAchievementsRoutes);
  }, 60_000);
  afterAll(async () => {
    await ctx?.teardown();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    fixtures.user.id = userId;
    fixtures.steam.isConfigured = true;
    for (const game of await ctx.storage.getUserGames(userId, true)) {
      await ctx.storage.removeGame(game.id);
    }
    const game = await ctx.storage.addGame({
      userId,
      igdbId: Math.floor(Math.random() * 1e9),
      title: "Hades",
      status: "playing",
      steamAppId: 1145360,
    });
    gameId = game.id;
    await sync.setSteamAchievementsEnabled(userId, false);
    await sync.setSteamAchievementsEnabled(userId, true);
  });

  it("stores totals and the rarest unlock, without notifying on the first sync", async () => {
    fixtures.achievements.mockResolvedValue([
      entry("a", true, 50, 1_700_000_000),
      entry("b", true, 2.5, 1_700_100_000),
      entry("c", false, 10),
    ]);
    const result = await sync.syncSteamAchievements(userId, { now: T0 });
    expect(result).toEqual({ gamesSynced: 1, newUnlocks: 0 });
    const [row] = await ctx.storage.getUserAchievementProgress(userId);
    expect(row).toMatchObject({
      gameId,
      provider: "steam",
      unlocked: 2,
      total: 3,
      rarestName: "B",
      rarestPercent: 2.5,
    });
    expect(row!.lastUnlockedAt!.getTime()).toBe(1_700_100_000);
    expect(await ctx.storage.getNotifications(userId)).toHaveLength(0);
  });

  it("notifies once when the unlocked count goes up and replaces the row", async () => {
    fixtures.achievements.mockResolvedValue([entry("a", true, 50), entry("b", false, 5)]);
    await sync.syncSteamAchievements(userId, { now: T0 });
    fixtures.achievements.mockResolvedValue([entry("a", true, 50), entry("b", true, 5)]);
    const result = await sync.syncSteamAchievements(userId, { now: hours(13) });
    expect(result).toEqual({ gamesSynced: 1, newUnlocks: 1 });
    const rows = await ctx.storage.getUserAchievementProgress(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unlocked: 2, total: 2, rarestPercent: 5 });
    expect(fixtures.notify).toHaveBeenCalledWith(
      "achievementsUpdated",
      { source: "steam" },
      userId
    );
    const notes = await ctx.storage.getNotifications(userId);
    expect(notes.filter((n) => n.title === "Achievements unlocked")).toHaveLength(1);
  });

  it("skips games without achievements and survives a failing game", async () => {
    fixtures.achievements.mockResolvedValueOnce([]);
    expect(await sync.syncSteamAchievements(userId, { now: T0 })).toEqual({
      gamesSynced: 0,
      newUnlocks: 0,
    });
    fixtures.achievements.mockRejectedValueOnce(new Error("boom"));
    expect(await sync.syncSteamAchievements(userId, { force: true, now: hours(1) })).toEqual({
      gamesSynced: 0,
      newUnlocks: 0,
    });
    expect((await sync.getSteamAchievementsStatus(userId)).lastError).toMatch(/Steam achievements/);
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(0);
  });

  it("drops the stored progress when the linked Steam account changes", async () => {
    fixtures.achievements.mockResolvedValue([entry("a", true, 1)]);
    await sync.syncSteamAchievements(userId, { now: T0 });
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
    await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
    await ctx.storage.updateUserSteamId(userId, "76561198000000001");
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(0);
    await ctx.storage.updateUserSteamId(userId, "76561198000000000");
  });

  it("keeps the other games when one fails to save", async () => {
    const other = await ctx.storage.addGame({
      userId,
      igdbId: Math.floor(Math.random() * 1e9),
      title: "Celeste",
      status: "owned",
      steamAppId: 504230,
    });
    fixtures.achievements.mockImplementation(async (_key, _id, appId: number) => {
      if (appId === 1145360) {
        await ctx.storage.removeGame(gameId);
      }
      return [entry("a", true, 1)];
    });
    const result = await sync.syncSteamAchievements(userId, { now: T0 });
    expect(result.gamesSynced).toBe(1);
    const rows = await ctx.storage.getUserAchievementProgress(userId);
    expect(rows.map((r) => r.gameId)).toEqual([other.id]);
  });

  it("respects the minimum gap unless forced", async () => {
    fixtures.achievements.mockResolvedValue([entry("a", true, 1)]);
    await sync.syncSteamAchievements(userId, { now: T0 });
    fixtures.achievements.mockClear();
    await sync.syncSteamAchievements(userId, { now: new Date(T0.getTime() + 60_000) });
    expect(fixtures.achievements).not.toHaveBeenCalled();
    await sync.syncSteamAchievements(userId, { force: true, now: new Date(T0.getTime() + 60_000) });
    expect(fixtures.achievements).toHaveBeenCalledTimes(1);
  });

  it("serves status, toggle, manual sync and the progress summary over HTTP", async () => {
    await request(app).put("/api/steam/achievements").send({ enabled: false }).expect(200);
    await request(app).post("/api/steam/achievements/sync").expect(400);
    await request(app).put("/api/steam/achievements").send({ enabled: "x" }).expect(400);
    await request(app).put("/api/steam/achievements").send({ enabled: true }).expect(200);
    fixtures.achievements.mockResolvedValue([entry("a", true, 4), entry("b", false, 9)]);
    const synced = await request(app).post("/api/steam/achievements/sync").expect(200);
    expect(synced.body.result).toEqual({ gamesSynced: 1, newUnlocks: 0 });
    const progress = await request(app).get("/api/achievements/progress").expect(200);
    expect(progress.body.summary).toMatchObject({
      games: 1,
      completedGames: 0,
      unlocked: 1,
      total: 2,
      completionRate: 50,
      rarest: { gameId, name: "A", percent: 4 },
    });
    expect(progress.body.progress[0]).toMatchObject({ gameId, title: "Hades", unlocked: 1 });
  });
});
