import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  playtimes: vi.fn(),
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
vi.mock("../steam.js", () => ({ steamService: { getOwnedPlaytimes: fixtures.playtimes } }));

const T0 = new Date("2026-11-08T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const minutesLater = (n: number) => new Date(T0.getTime() + n * 60_000);

describe.each(activeTestDialects())("Steam play-time sync (%s)", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let userId: string;
  let gameId: string;
  let sync: typeof import("../steam-playtime.js");

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const user = await ctx.storage.registerSetupUser({ username: "owner", passwordHash: "hash" });
    userId = user.id;
    await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    sync = await import("../steam-playtime.js");
    const { steamPlaytimeRoutes } = await import("../steam-playtime-routes.js");
    app = express();
    app.use(express.json());
    app.use(steamPlaytimeRoutes);
  }, 60_000);
  afterAll(async () => {
    await ctx?.teardown();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    fixtures.user.id = userId;
    fixtures.user.steamId64 = "76561198000000000";
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
    // Fresh state: off, then on, so the baselines start empty.
    await sync.setSteamPlaytimeEnabled(userId, false);
    await sync.setSteamPlaytimeEnabled(userId, true);
  });

  const owned = (minutes: number) =>
    fixtures.playtimes.mockResolvedValue(new Map([[1145360, minutes]]));
  const steamSessions = async () =>
    (await ctx.storage.getGamePlaySessions(gameId, userId)).filter((s) => s.source === "steam");

  it("records a baseline on the first sync and no session", async () => {
    owned(600);
    const result = await sync.syncSteamPlaytime(userId, { now: T0 });
    expect(result).toEqual({ sessionsAdded: 0, minutesAdded: 0, baselined: 1 });
    expect(await steamSessions()).toHaveLength(0);
  });

  it("turns growth into one estimated session ending at sync time", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    owned(690);
    const result = await sync.syncSteamPlaytime(userId, { now: hours(2) });
    expect(result).toMatchObject({ sessionsAdded: 1, minutesAdded: 90 });
    const [session] = await steamSessions();
    expect(session!.endedAt!.getTime()).toBe(hours(2).getTime());
    expect(session!.startedAt.getTime()).toBe(hours(2).getTime() - 90 * 60_000);
    // Nothing new on the next sync.
    expect(await sync.syncSteamPlaytime(userId, { now: hours(4) })).toMatchObject({
      sessionsAdded: 0,
    });
    expect(await steamSessions()).toHaveLength(1);
  });

  it("subtracts manual, timer and Playnite minutes recorded since the last sync", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(30),
      endedAt: minutesLater(60),
      source: "manual",
    });
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(70),
      endedAt: minutesLater(90),
      source: "playnite",
    });
    owned(600 + 80);
    const result = await sync.syncSteamPlaytime(userId, { now: hours(3) });
    expect(result).toMatchObject({ sessionsAdded: 1, minutesAdded: 30 });
  });

  it("adds nothing when the recorded sessions already cover the growth", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(10),
      endedAt: minutesLater(70),
      source: "manual",
    });
    owned(650);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(3) })).toMatchObject({
      sessionsAdded: 0,
    });
    // The baseline moved on, so the same minutes are not claimed later.
    expect(await sync.syncSteamPlaytime(userId, { now: hours(5) })).toMatchObject({
      sessionsAdded: 0,
    });
  });

  it("leaves a game with a running timer for the next sync", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    const timer = await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: hours(1),
      endedAt: null,
      source: "timer",
    });
    owned(660);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(2) })).toMatchObject({
      sessionsAdded: 0,
    });
    await ctx.storage.stopGamePlaySession(timer.id, userId, hours(2));
    // The timer's 60 minutes cover the whole growth; none is counted twice.
    expect(await sync.syncSteamPlaytime(userId, { now: hours(3) })).toMatchObject({
      sessionsAdded: 0,
    });
  });

  it("follows a total that Steam lowers without creating a session", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    owned(500);
    await sync.syncSteamPlaytime(userId, { now: hours(2) });
    owned(530);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(4) })).toMatchObject({
      sessionsAdded: 1,
      minutesAdded: 30,
    });
  });

  it("baselines a game added to the library later instead of importing its history", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    const late = await ctx.storage.addGame({
      userId,
      igdbId: Math.floor(Math.random() * 1e9),
      title: "Celeste",
      status: "owned",
      steamAppId: 504230,
    });
    fixtures.playtimes.mockResolvedValue(
      new Map([
        [1145360, 600],
        [504230, 4000],
      ])
    );
    const result = await sync.syncSteamPlaytime(userId, { now: hours(2) });
    expect(result).toMatchObject({ sessionsAdded: 0, baselined: 1 });
    expect(await ctx.storage.getGamePlaySessions(late.id, userId)).toHaveLength(0);
  });

  it("skips a run inside the minimum gap unless forced", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    owned(700);
    expect(await sync.syncSteamPlaytime(userId, { now: minutesLater(5) })).toMatchObject({
      sessionsAdded: 0,
    });
    expect(fixtures.playtimes).toHaveBeenCalledTimes(1);
    expect(
      await sync.syncSteamPlaytime(userId, { now: minutesLater(5), force: true })
    ).toMatchObject({ sessionsAdded: 1, minutesAdded: 100 });
  });

  it("starts again from fresh baselines when the sync is turned back on", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    await sync.setSteamPlaytimeEnabled(userId, false);
    await sync.setSteamPlaytimeEnabled(userId, true);
    owned(5000);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(48) })).toMatchObject({
      sessionsAdded: 0,
      baselined: 1,
    });
  });

  it("remembers a Steam failure without leaking its message", async () => {
    fixtures.playtimes.mockRejectedValueOnce(new Error("https://x/?key=secret"));
    await expect(sync.syncSteamPlaytime(userId, { now: T0 })).rejects.toThrow(/Steam play time/);
    const status = await sync.getSteamPlaytimeStatus(userId);
    expect(status.lastError).toMatch(/Steam play time/);
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  describe("routes", () => {
    it("requires authentication", async () => {
      fixtures.user.id = "";
      expect((await request(app).get("/api/steam/playtime")).status).toBe(401);
    });

    it("reports, enables and disables the sync", async () => {
      const off = await request(app).put("/api/steam/playtime").send({ enabled: false });
      expect(off.body).toMatchObject({ available: true, enabled: false });
      const on = await request(app).put("/api/steam/playtime").send({ enabled: true });
      expect(on.body.enabled).toBe(true);
      expect((await request(app).put("/api/steam/playtime").send({ enabled: "yes" })).status).toBe(
        400
      );
    });

    it("syncs on demand and refuses while the sync is off", async () => {
      owned(600);
      const done = await request(app).post("/api/steam/playtime/sync");
      expect(done.status).toBe(200);
      expect(done.body.result.baselined).toBe(1);
      expect(done.body.status.lastSyncAt).not.toBeNull();
      await request(app).put("/api/steam/playtime").send({ enabled: false });
      expect((await request(app).post("/api/steam/playtime/sync")).status).toBe(400);
    });

    it("answers 400 without a Steam key or ID and 502 on a Steam failure", async () => {
      fixtures.steam.isConfigured = false;
      expect((await request(app).post("/api/steam/playtime/sync")).status).toBe(400);
      expect((await request(app).get("/api/steam/playtime")).body.available).toBe(false);
      fixtures.steam.isConfigured = true;
      fixtures.playtimes.mockRejectedValueOnce(new Error("boom"));
      const failed = await request(app).post("/api/steam/playtime/sync");
      expect(failed.status).toBe(502);
      expect(failed.body.status.lastError).toBeTruthy();
    });
  });
});
