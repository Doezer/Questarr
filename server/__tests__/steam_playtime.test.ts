import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  playtimes: vi.fn(),
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
    // Each finished sync tells the user's open pages to refresh.
    expect(fixtures.notify).toHaveBeenCalledWith(
      "playSessionsUpdated",
      { source: "steam" },
      userId
    );
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

  it("keeps the window open when a timer runs before Steam reports its minutes", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    const timer = await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(30),
      endedAt: null,
      source: "timer",
    });
    // Steam has not caught up yet: no growth while the timer runs.
    await sync.syncSteamPlaytime(userId, { now: hours(1) });
    await ctx.storage.stopGamePlaySession(timer.id, userId, hours(1));
    // Steam now reports the 30 minutes played; the timer already covers them.
    owned(630);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(2) })).toMatchObject({
      sessionsAdded: 0,
    });
  });

  it("closes the window after a day when Steam never reports the timer's minutes", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    const timer = await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(30),
      endedAt: null,
      source: "timer",
    });
    await sync.syncSteamPlaytime(userId, { now: hours(1) });
    await ctx.storage.stopGamePlaySession(timer.id, userId, hours(1));
    // Days pass with no Steam growth (a copy Steam does not track), then real Steam play.
    await sync.syncSteamPlaytime(userId, { now: hours(60) });
    owned(660);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(70) })).toMatchObject({
      sessionsAdded: 1,
      minutesAdded: 60,
    });
  });

  it("keeps the window open for a finished session Steam has not reported yet", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(10),
      endedAt: minutesLater(40),
      source: "manual",
    });
    // Steam has not caught up at this sync, then reports the 30 minutes at the next one.
    await sync.syncSteamPlaytime(userId, { now: hours(1) });
    owned(630);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(2) })).toMatchObject({
      sessionsAdded: 0,
    });
  });

  it("keeps the window open when recorded time exceeds the first Steam growth", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(10),
      endedAt: minutesLater(70),
      source: "manual",
    });
    // Steam reports 30 of the 60 recorded minutes, then the other 30 at the next sync.
    owned(630);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(2) })).toMatchObject({
      sessionsAdded: 0,
    });
    owned(660);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(4) })).toMatchObject({
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

  it("drops a run's result when the sync is turned off while it runs", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    fixtures.playtimes.mockImplementationOnce(async () => {
      await sync.setSteamPlaytimeEnabled(userId, false);
      return new Map([[1145360, 700]]);
    });
    await sync.syncSteamPlaytime(userId, { now: hours(2) });
    // Nothing is recorded for a run the user switched off.
    expect(await steamSessions()).toHaveLength(0);
    const status = await sync.getSteamPlaytimeStatus(userId);
    expect(status.enabled).toBe(false);
    expect(status.lastSyncAt).toBeNull();
    // Turning it back on starts from fresh baselines, not the stale ones of the dropped run.
    await sync.setSteamPlaytimeEnabled(userId, true);
    owned(900);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(4) })).toMatchObject({
      sessionsAdded: 0,
      baselined: 1,
    });
  });

  it("does not insert the same minutes twice when saving the state failed", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    owned(690);
    const save = vi
      .spyOn(ctx.storage, "setSystemConfig")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(sync.syncSteamPlaytime(userId, { now: hours(2) })).rejects.toThrow("disk full");
    } finally {
      save.mockRestore();
    }
    expect(await steamSessions()).toHaveLength(1);
    // The retry finds the first run's session and adds nothing on top of it.
    await sync.syncSteamPlaytime(userId, { now: hours(3) });
    expect(await steamSessions()).toHaveLength(1);
    owned(720);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(4) })).toMatchObject({
      sessionsAdded: 1,
      minutesAdded: 30,
    });
  });

  it("keeps a toggle made while a failing run is in flight", async () => {
    fixtures.playtimes.mockImplementationOnce(async () => {
      await sync.setSteamPlaytimeEnabled(userId, false);
      throw new Error("boom");
    });
    await expect(sync.syncSteamPlaytime(userId, { now: T0 })).rejects.toThrow();
    expect(await sync.getSteamPlaytimeStatus(userId)).toMatchObject({
      enabled: false,
      lastError: null,
    });
  });

  it("starts from fresh baselines when another Steam account is linked", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    await ctx.storage.updateUserSteamId(userId, "76561198000000001");
    try {
      owned(5000);
      expect(await sync.syncSteamPlaytime(userId, { now: hours(2) })).toMatchObject({
        sessionsAdded: 0,
        baselined: 1,
      });
      owned(5060);
      expect(await sync.syncSteamPlaytime(userId, { now: hours(4) })).toMatchObject({
        sessionsAdded: 1,
        minutesAdded: 60,
      });
    } finally {
      await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    }
  });

  it("subtracts only the part of a session that falls inside the sync window", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    // Started 30 min before the previous sync: only its last 10 minutes belong to this window.
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(-30),
      endedAt: minutesLater(10),
      source: "manual",
    });
    owned(640);
    expect(await sync.syncSteamPlaytime(userId, { now: hours(2) })).toMatchObject({
      sessionsAdded: 1,
      minutesAdded: 30,
    });
  });

  it("does not subtract the part of a session that ends after the sync time", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    // Ends 20 minutes after the next sync: only its first 40 minutes belong to this window.
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: minutesLater(80),
      endedAt: minutesLater(140),
      source: "manual",
    });
    owned(660);
    expect(await sync.syncSteamPlaytime(userId, { now: minutesLater(120) })).toMatchObject({
      sessionsAdded: 1,
      minutesAdded: 20,
    });
  });

  it("drops a run whose Steam account was replaced while it was in flight", async () => {
    owned(600);
    await sync.syncSteamPlaytime(userId, { now: T0 });
    fixtures.playtimes.mockImplementationOnce(async () => {
      await ctx.storage.updateUserSteamId(userId, "76561198000000001");
      return new Map([[1145360, 700]]);
    });
    try {
      await sync.syncSteamPlaytime(userId, { now: hours(2) });
      expect(await steamSessions()).toHaveLength(0);
    } finally {
      await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    }
  });

  it("remembers a Steam failure without leaking its message", async () => {
    fixtures.playtimes.mockRejectedValueOnce(new Error("https://x/?key=secret"));
    await expect(sync.syncSteamPlaytime(userId, { now: T0 })).rejects.toThrow(/Steam play time/);
    const status = await sync.getSteamPlaytimeStatus(userId);
    expect(status.lastError).toMatch(/Steam play time/);
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  describe("scheduled run", () => {
    it("syncs users who turned it on, skips the others and survives a failure", async () => {
      owned(600);
      await sync.runScheduledSteamPlaytimeSync();
      expect((await sync.getSteamPlaytimeStatus(userId)).lastSyncAt).not.toBeNull();
      expect(fixtures.playtimes).toHaveBeenCalledTimes(1);

      await sync.setSteamPlaytimeEnabled(userId, false);
      await sync.runScheduledSteamPlaytimeSync();
      expect(fixtures.playtimes).toHaveBeenCalledTimes(1);

      await sync.setSteamPlaytimeEnabled(userId, true);
      fixtures.playtimes.mockRejectedValueOnce(new Error("boom"));
      await expect(sync.runScheduledSteamPlaytimeSync()).resolves.toBeUndefined();
      expect((await sync.getSteamPlaytimeStatus(userId)).lastError).toBeTruthy();
    });

    it("does nothing without a Steam API key", async () => {
      fixtures.steam.isConfigured = false;
      await sync.runScheduledSteamPlaytimeSync();
      expect(fixtures.playtimes).not.toHaveBeenCalled();
    });
  });

  it("starts again from fresh baselines when the stored state is damaged", async () => {
    await ctx.storage.setSystemConfig(`steam.playtime.${userId}`, "{not json");
    expect((await sync.getSteamPlaytimeStatus(userId)).enabled).toBe(false);
    await sync.setSteamPlaytimeEnabled(userId, true);
    owned(600);
    expect(await sync.syncSteamPlaytime(userId, { now: T0 })).toMatchObject({ baselined: 1 });
  });

  it("refuses a second sync while one is running", async () => {
    let release: () => void = () => undefined;
    fixtures.playtimes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Map([[1145360, 600]]));
        })
    );
    const first = sync.syncSteamPlaytime(userId, { now: T0 });
    await vi.waitFor(() => expect(fixtures.playtimes).toHaveBeenCalled());
    await expect(sync.syncSteamPlaytime(userId, { now: T0 })).rejects.toBeInstanceOf(
      sync.SteamPlaytimeBusyError
    );
    release();
    await first;
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

    it("answers 409 while a sync is running and 500 when the state cannot be read", async () => {
      let release: () => void = () => undefined;
      fixtures.playtimes.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(new Map([[1145360, 600]]));
          })
      );
      const first = request(app)
        .post("/api/steam/playtime/sync")
        .then((response) => response);
      await vi.waitFor(() => expect(fixtures.playtimes).toHaveBeenCalled());
      expect((await request(app).post("/api/steam/playtime/sync")).status).toBe(409);
      release();
      expect((await first).status).toBe(200);

      const read = vi.spyOn(ctx.storage, "getSystemConfig").mockRejectedValue(new Error("db"));
      try {
        expect((await request(app).get("/api/steam/playtime")).status).toBe(500);
        expect((await request(app).put("/api/steam/playtime").send({ enabled: true })).status).toBe(
          500
        );
      } finally {
        read.mockRestore();
      }
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

    it("answers 500 with a fixed message for a non-Steam failure", async () => {
      const read = vi
        .spyOn(ctx.storage, "getUserGames")
        .mockRejectedValueOnce(new Error("db path"));
      try {
        const failed = await request(app).post("/api/steam/playtime/sync");
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toContain("db path");
      } finally {
        read.mockRestore();
      }
    });
  });
});
