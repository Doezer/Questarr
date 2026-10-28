import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const fixtures = vi.hoisted(() => ({
  owned: vi.fn(),
  mappings: vi.fn(),
  game: vi.fn(),
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
vi.mock("../igdb.js", () => ({
  igdbClient: {
    getGameIdsBySteamAppIds: fixtures.mappings,
    getGameById: fixtures.game,
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
    const { steamLibraryRoutes } = await import("../steam-library-routes.js");
    app = express();
    app.use(express.json());
    app.use(steamLibraryRoutes);
  }, 60_000);
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
    fixtures.game.mockRejectedValueOnce(new Error("IGDB unavailable"));
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
});
