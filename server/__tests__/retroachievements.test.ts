import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  notify: vi.fn(),
  user: { id: "" },
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
vi.mock("../ssrf.js", () => ({ safeFetch: fixtures.safeFetch }));
vi.mock("../socket.js", () => ({ notifyUser: fixtures.notify }));
vi.mock("../apprise.js", () => ({ appriseClient: { send: vi.fn() } }));
vi.mock("../credential-crypto.js", () => ({
  encryptCredential: async (value: string) => `enc:${value}`,
  decryptCredential: async (value: string) => value.replace(/^enc:/, ""),
}));

const KEY = "abcdef0123456789abcdef0123456789";
const T0 = new Date("2026-11-24T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

const raGame = (
  gameId: number,
  title: string,
  consoleName: string,
  unlocked: number,
  total: number
) => ({
  GameID: gameId,
  Title: title,
  ConsoleName: consoleName,
  MaxPossible: total,
  NumAwarded: unlocked,
  MostRecentAwardedDate: "2026-11-20 18:30:00",
});

function answer(results: ReturnType<typeof raGame>[], status = 200) {
  fixtures.safeFetch.mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => ({ Count: results.length, Total: results.length, Results: results }),
  });
}

describe("RetroAchievements matching", () => {
  it("matches by title and console, ignoring region tags and alternative names", async () => {
    const { matchRetroAchievementsGame } = await import("../retroachievements.js");
    const games = [
      {
        gameId: 1,
        title: "Super Mario World",
        consoleName: "SNES/Super Famicom",
        total: 96,
        unlocked: 10,
        lastUnlockedAt: null,
      },
      {
        gameId: 2,
        title: "Pokemon Red | Pokemon Blue",
        consoleName: "Game Boy",
        total: 40,
        unlocked: 5,
        lastUnlockedAt: null,
      },
      {
        gameId: 3,
        title: "~Hack~ Super Mario World: Hard",
        consoleName: "SNES/Super Famicom",
        total: 10,
        unlocked: 9,
        lastUnlockedAt: null,
      },
    ];
    const snes = ["Super Nintendo Entertainment System"];
    expect(
      matchRetroAchievementsGame({ title: "Super Mario World (USA)", platforms: snes }, games)
    ).toMatchObject({ gameId: 1 });
    expect(
      matchRetroAchievementsGame({ title: "Pokémon Blue", platforms: ["Game Boy"] }, games)
    ).toMatchObject({ gameId: 2 });
    // Same title on another platform is a different game.
    expect(
      matchRetroAchievementsGame(
        { title: "Super Mario World", platforms: ["PC (Microsoft Windows)"] },
        games
      )
    ).toBeNull();
    expect(matchRetroAchievementsGame({ title: "Super Mario World", platforms: null }, games)).toBe(
      null
    );
  });

  it("keeps the set with the most progress when several match", async () => {
    const { matchRetroAchievementsGame } = await import("../retroachievements.js");
    const base = { consoleName: "Mega Drive", lastUnlockedAt: null, total: 20 };
    const best = matchRetroAchievementsGame(
      { title: "Sonic the Hedgehog", platforms: ["Sega Mega Drive/Genesis"] },
      [
        { ...base, gameId: 1, title: "Sonic the Hedgehog", unlocked: 3 },
        { ...base, gameId: 2, title: "Sonic the Hedgehog (Japan)", unlocked: 8 },
      ]
    );
    expect(best?.gameId).toBe(2);
  });
});

describe.each(activeTestDialects())("RetroAchievements sync (%s)", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let userId: string;
  let gameId: string;
  let sync: typeof import("../retroachievements-sync.js");

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const user = await ctx.storage.registerSetupUser({ username: "owner", passwordHash: "hash" });
    userId = user.id;
    sync = await import("../retroachievements-sync.js");
    const { retroAchievementsRoutes } = await import("../retroachievements-routes.js");
    app = express();
    app.use(express.json());
    app.use(retroAchievementsRoutes);
  }, 60_000);
  afterAll(async () => {
    await ctx?.teardown();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    fixtures.user.id = userId;
    for (const game of await ctx.storage.getUserGames(userId, true)) {
      await ctx.storage.removeGame(game.id);
    }
    const game = await ctx.storage.addGame({
      userId,
      igdbId: Math.floor(Math.random() * 1e9),
      title: "Super Mario World",
      status: "playing",
      platforms: ["Super Nintendo Entertainment System"],
    });
    gameId = game.id;
    await sync.clearRetroAchievements(userId);
    answer([raGame(1, "Super Mario World", "SNES/Super Famicom", 10, 96)]);
    await sync.saveRetroAchievementsCredentials(userId, { username: "Mario", apiKey: KEY });
    await sync.setRetroAchievementsEnabled(userId, true);
    fixtures.safeFetch.mockClear();
  });

  it("stores the progress of matched games without notifying on the first sync", async () => {
    answer([
      raGame(1, "Super Mario World", "SNES/Super Famicom", 10, 96),
      raGame(2, "Sonic the Hedgehog", "Mega Drive", 5, 20), // not in the library
    ]);
    const result = await sync.syncRetroAchievements(userId, { now: T0 });
    expect(result).toEqual({ gamesSynced: 1, newUnlocks: 0 });
    const [row] = await ctx.storage.getUserAchievementProgress(userId);
    expect(row).toMatchObject({
      gameId,
      provider: "retroachievements",
      unlocked: 10,
      total: 96,
      rarestName: null,
    });
    expect(row!.lastUnlockedAt!.toISOString()).toBe("2026-11-20T18:30:00.000Z");
    expect(await ctx.storage.getNotifications(userId)).toHaveLength(0);
    // The key travels in the URL only, never in logs or errors; the user is the account name.
    const url = String(fixtures.safeFetch.mock.calls[0]![0]);
    expect(url).toContain("API_GetUserCompletionProgress.php");
    expect(url).toContain("u=Mario");
  });

  it("notifies when the unlocked count goes up", async () => {
    await sync.syncRetroAchievements(userId, { now: T0 });
    answer([raGame(1, "Super Mario World", "SNES/Super Famicom", 14, 96)]);
    const result = await sync.syncRetroAchievements(userId, { now: hours(13) });
    expect(result).toEqual({ gamesSynced: 1, newUnlocks: 4 });
    expect(fixtures.notify).toHaveBeenCalledWith(
      "achievementsUpdated",
      { source: "retroachievements" },
      userId
    );
    const notes = await ctx.storage.getNotifications(userId);
    expect(notes.filter((n) => n.title === "Achievements unlocked")).toHaveLength(1);
  });

  it("ignores a library game on another platform", async () => {
    await ctx.storage.removeGame(gameId);
    await ctx.storage.addGame({
      userId,
      igdbId: Math.floor(Math.random() * 1e9),
      title: "Super Mario World",
      status: "playing",
      platforms: ["PC (Microsoft Windows)"],
    });
    expect(await sync.syncRetroAchievements(userId, { now: T0 })).toEqual({
      gamesSynced: 0,
      newUnlocks: 0,
    });
  });

  it("reports rejected credentials as a sync error", async () => {
    answer([], 401);
    expect(await sync.syncRetroAchievements(userId, { now: T0 })).toEqual({
      gamesSynced: 0,
      newUnlocks: 0,
    });
    expect((await sync.getRetroAchievementsStatus(userId)).lastError).toMatch(/RetroAchievements/);
  });

  it("starts again from a baseline when the account changes, keeping the saved key", async () => {
    await sync.syncRetroAchievements(userId, { now: T0 });
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
    await sync.saveRetroAchievementsCredentials(userId, { username: "Luigi" });
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(0);
    expect(await sync.getRetroAchievementsCredentials(userId)).toEqual({
      username: "Luigi",
      apiKey: KEY,
    });
  });

  it("serves status, credentials, toggle and manual sync over HTTP, never returning the key", async () => {
    const status = await request(app).get("/api/retroachievements");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ available: true, enabled: true, username: "Mario" });
    expect(JSON.stringify(status.body)).not.toContain(KEY);

    const synced = await request(app).post("/api/retroachievements/sync");
    expect(synced.status).toBe(200);
    expect(synced.body.result).toEqual({ gamesSynced: 1, newUnlocks: 0 });

    const bad = await request(app)
      .put("/api/retroachievements/credentials")
      .send({ username: "not valid!", apiKey: "short" });
    expect(bad.status).toBe(400);

    answer([], 401);
    const rejected = await request(app)
      .put("/api/retroachievements/credentials")
      .send({ username: "Mario", apiKey: KEY });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/rejected/);

    const off = await request(app).put("/api/retroachievements").send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    expect((await request(app).post("/api/retroachievements/sync")).status).toBe(400);

    const removed = await request(app).delete("/api/retroachievements/credentials");
    expect(removed.body).toMatchObject({ available: false, enabled: false, username: null });
    expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(0);
  });

  it("requires a key for the first save", async () => {
    await sync.clearRetroAchievements(userId);
    const response = await request(app)
      .put("/api/retroachievements/credentials")
      .send({ username: "Mario" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Web API key/);
  });
});
