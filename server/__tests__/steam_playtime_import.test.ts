import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  detailed: vi.fn(),
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
vi.mock("../steam.js", () => ({
  steamService: {
    getOwnedPlaytimesDetailed: fixtures.detailed,
    getOwnedPlaytimes: fixtures.playtimes,
  },
}));

const NOW = new Date("2026-11-19T10:00:00Z");
const LAST = new Date("2026-10-01T20:00:00Z");

describe.each(activeTestDialects())("Steam play-time history import (%s)", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let userId: string;
  let gameId: string;
  let mod: typeof import("../steam-playtime.js");

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const user = await ctx.storage.registerSetupUser({ username: "owner", passwordHash: "hash" });
    userId = user.id;
    await ctx.storage.updateUserSteamId(userId, "76561198000000000");
    mod = await import("../steam-playtime.js");
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
    await mod.setSteamPlaytimeEnabled(userId, false);
  });

  const owned = (minutes: number, lastPlayedAt: Date | null = LAST) =>
    fixtures.detailed.mockResolvedValue(
      new Map([[1145360, { title: "Hades", minutes, lastPlayedAt }]])
    );
  const sessions = () => ctx.storage.getGamePlaySessions(gameId, userId);

  it("previews the missing minutes without writing anything", async () => {
    owned(600);
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: new Date("2026-11-10T10:00:00Z"),
      endedAt: new Date("2026-11-10T11:00:00Z"),
      source: "manual",
    });
    const preview = await mod.previewSteamPlaytimeImport(userId);
    expect(preview.candidates).toEqual([
      expect.objectContaining({
        gameId,
        steamMinutes: 600,
        recordedMinutes: 60,
        importMinutes: 540,
        lastPlayedAt: LAST.toISOString(),
      }),
    ]);
    expect(await sessions()).toHaveLength(1);
  });

  it("imports one steam_import session ending at the last-played time, once", async () => {
    owned(600);
    const result = await mod.importSteamPlaytime(userId, undefined, NOW);
    expect(result).toEqual({ sessionsAdded: 1, minutesAdded: 600 });
    const [session] = await sessions();
    expect(session!.source).toBe("steam_import");
    expect(session!.endedAt!.getTime()).toBe(LAST.getTime());
    expect(session!.startedAt.getTime()).toBe(LAST.getTime() - 600 * 60_000);
    expect(fixtures.notify).toHaveBeenCalledWith(
      "playSessionsUpdated",
      { source: "steam" },
      userId
    );
    // A second run finds the game already imported.
    expect(await mod.importSteamPlaytime(userId, undefined, NOW)).toEqual({
      sessionsAdded: 0,
      minutesAdded: 0,
    });
    expect((await mod.previewSteamPlaytimeImport(userId)).skipped).toBe(1);
    expect(await sessions()).toHaveLength(1);
  });

  it("falls back to the import time when Steam has no last-played date", async () => {
    owned(300, null);
    await mod.importSteamPlaytime(userId, undefined, NOW);
    const [session] = await sessions();
    expect(session!.endedAt!.getTime()).toBe(NOW.getTime());
  });

  it("ignores gaps under ten minutes and games outside the chosen list", async () => {
    owned(605);
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: new Date("2026-11-10T00:00:00Z"),
      endedAt: new Date("2026-11-10T10:00:00Z"),
      source: "timer",
    });
    expect((await mod.previewSteamPlaytimeImport(userId)).candidates).toHaveLength(0);
    owned(900);
    expect(await mod.importSteamPlaytime(userId, ["another-game"], NOW)).toEqual({
      sessionsAdded: 0,
      minutesAdded: 0,
    });
    expect(await sessions()).toHaveLength(1);
  });

  it("leaves a game with a running timer alone", async () => {
    owned(600);
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: new Date("2026-11-19T09:00:00Z"),
      endedAt: null,
      source: "timer",
    });
    expect((await mod.previewSteamPlaytimeImport(userId)).candidates).toHaveLength(0);
  });

  it("moves the live sync's baseline so the next sync does not add the minutes again", async () => {
    await mod.setSteamPlaytimeEnabled(userId, true);
    fixtures.playtimes.mockResolvedValue(new Map([[1145360, 600]]));
    await mod.syncSteamPlaytime(userId, { now: new Date("2026-11-19T08:00:00Z") });
    // Steam grew to 700 since that sync; the import takes everything not yet recorded.
    owned(700);
    await mod.importSteamPlaytime(userId, undefined, NOW);
    fixtures.playtimes.mockResolvedValue(new Map([[1145360, 700]]));
    const result = await mod.syncSteamPlaytime(userId, { force: true, now: NOW });
    expect(result.sessionsAdded).toBe(0);
    expect((await sessions()).filter((s) => s.source === "steam")).toHaveLength(0);
  });

  it("starts a fresh sync window at the import, so earlier timer sessions are not counted twice", async () => {
    await mod.setSteamPlaytimeEnabled(userId, true);
    fixtures.playtimes.mockResolvedValue(new Map([[1145360, 600]]));
    await mod.syncSteamPlaytime(userId, { now: new Date("2026-11-19T08:00:00Z") });
    // A 60 minute timer session after that sync, then Steam reports it (660) and the import runs.
    await ctx.storage.addGamePlaySession({
      gameId,
      userId,
      startedAt: new Date("2026-11-19T08:00:00Z"),
      endedAt: new Date("2026-11-19T09:00:00Z"),
      source: "timer",
    });
    owned(660);
    await mod.importSteamPlaytime(userId, undefined, NOW);
    // 30 more minutes played on Steam only: the next sync must add them.
    fixtures.playtimes.mockResolvedValue(new Map([[1145360, 690]]));
    const later = new Date("2026-11-19T12:00:00Z");
    const result = await mod.syncSteamPlaytime(userId, { force: true, now: later });
    expect(result.sessionsAdded).toBe(1);
    expect(result.minutesAdded).toBe(30);
  });

  describe("routes", () => {
    it("serves the preview and imports the chosen games", async () => {
      owned(600);
      const preview = await request(app).get("/api/steam/playtime/import/preview");
      expect(preview.status).toBe(200);
      expect(preview.body.candidates).toHaveLength(1);
      const done = await request(app)
        .post("/api/steam/playtime/import")
        .send({ gameIds: [gameId] });
      expect(done.status).toBe(200);
      expect(done.body).toEqual({ sessionsAdded: 1, minutesAdded: 600 });
    });

    it("rejects a malformed body and reports Steam trouble without leaking it", async () => {
      expect(
        (await request(app).post("/api/steam/playtime/import").send({ gameIds: 5 })).status
      ).toBe(400);
      fixtures.detailed.mockRejectedValue(new Error("https://x?key=SECRET"));
      const failed = await request(app).get("/api/steam/playtime/import/preview");
      expect(failed.status).toBe(502);
      expect(JSON.stringify(failed.body)).not.toContain("SECRET");
    });

    it("asks to set Steam up first", async () => {
      fixtures.steam.isConfigured = false;
      expect((await request(app).get("/api/steam/playtime/import/preview")).status).toBe(400);
    });
  });
});
