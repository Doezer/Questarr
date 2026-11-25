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

const NPSSO = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6";
const XBL_KEY = "abcd1234-ef56-7890-abcd-ef1234567890";
const T0 = new Date("2026-11-24T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => null },
  json: async () => body,
});

const trophySet = (
  id: string,
  name: string,
  platform: string,
  earned: number,
  defined: number
) => ({
  npCommunicationId: id,
  trophyTitleName: name,
  trophyTitlePlatform: platform,
  definedTrophies: { bronze: defined - 2, silver: 1, gold: 1, platinum: 0 },
  earnedTrophies: { bronze: earned, silver: 0, gold: 0, platinum: 0 },
  lastUpdatedDateTime: "2026-11-20T18:30:00Z",
});

/** The PlayStation sign-in and trophy endpoints answer by URL. */
function answerPsn(
  titles: ReturnType<typeof trophySet>[],
  { code = "v3.code", tokenStatus = 200 }: { code?: string | null; tokenStatus?: number } = {}
) {
  fixtures.safeFetch.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/oauth/authorize")) {
      return {
        ok: false,
        status: 302,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "location"
              ? code
                ? `com.scee.psxandroid.scecompcall://redirect/?code=${code}&cid=1`
                : "com.scee.psxandroid.scecompcall://redirect/?error=login_required"
              : null,
        },
        json: async () => ({}),
      };
    }
    if (u.includes("/oauth/token")) return json({ access_token: "access-token" }, tokenStatus);
    if (u.includes("/trophySummary")) return json({ accountId: "4242424242", trophyLevel: 12 });
    if (u.includes("/trophyTitles")) {
      return json({ trophyTitles: titles, totalItemCount: titles.length });
    }
    return json({}, 404);
  });
}

const xboxTitle = (
  titleId: string,
  name: string,
  devices: string[],
  current: number,
  total: number
) => ({
  titleId,
  name,
  devices,
  achievement: { currentAchievements: current, totalAchievements: total },
  titleHistory: { lastTimePlayed: "2026-11-20T18:30:00Z" },
});

/** The OpenXBL endpoints answer by URL; `pages` are returned one per continuation token. */
function answerXbox(pages: ReturnType<typeof xboxTitle>[][], status = 200) {
  fixtures.safeFetch.mockImplementation(async (url: string) => {
    const u = String(url);
    if (status >= 400) return json({ code: "ERROR" }, status);
    if (u.endsWith("/account")) {
      return json({
        profileUsers: [{ id: "1", settings: [{ id: "Gamertag", value: "MasterChief" }] }],
      });
    }
    const token = /continuationToken=(\d+)/.exec(u)?.[1];
    const index = token ? Number(token) : 0;
    return json({
      titles: pages[index] ?? [],
      pagingInfo: { continuationToken: index + 1 < pages.length ? String(index + 1) : null },
    });
  });
}

describe("PlayStation matching", () => {
  const set = (title: string, platforms: string[], unlocked = 1) => ({
    id: title,
    title,
    platforms,
    total: 40,
    unlocked,
    lastUpdatedAt: null,
  });

  it("matches the title on the platform of the library copy", async () => {
    const { matchPsnGame } = await import("../psn.js");
    const game = {
      title: "God of War Ragnarök",
      platforms: ["PlayStation 4", "PlayStation 5"],
      targetPlatformName: "PlayStation 5",
    };
    const ps4 = set("God of War Ragnarök™", ["PS4"], 30);
    const ps5 = set("God of War Ragnarök", ["PS5"], 5);
    expect(matchPsnGame(game, [ps4, ps5])).toBe(ps5);
    expect(matchPsnGame({ ...game, targetPlatformName: null }, [ps4, ps5])).toBe(ps4);
  });

  it("does not match another platform or title", async () => {
    const { matchPsnGame } = await import("../psn.js");
    const game = { title: "Hades", platforms: ["Nintendo Switch"], targetPlatformName: null };
    expect(matchPsnGame(game, [set("Hades", ["PS5"])])).toBeNull();
    expect(
      matchPsnGame({ ...game, platforms: ["PlayStation 5"] }, [set("Hades II", ["PS5"])])
    ).toBeNull();
  });

  it("reads a set that lists several platforms", async () => {
    const { psnPlatformMatches } = await import("../psn.js");
    expect(psnPlatformMatches(set("X", ["PS3", "PSVITA"]), ["PlayStation Vita"])).toBe(true);
    expect(psnPlatformMatches(set("X", ["PS3"]), ["PlayStation 4"])).toBe(false);
  });
});

describe("Xbox matching", () => {
  const title = (name: string, devices: string[], unlocked = 1) => ({
    titleId: name,
    title: name,
    devices,
    total: 50,
    unlocked,
    lastPlayedAt: null,
  });

  it("matches the title on a device of the library copy", async () => {
    const { matchXboxGame } = await import("../xbox.js");
    const game = {
      title: "Halo Infinite",
      platforms: ["Xbox One", "Xbox Series X|S", "PC (Microsoft Windows)"],
      targetPlatformName: "Xbox Series X|S",
    };
    const series = title("Halo Infinite", ["XboxSeries", "XboxOne"], 10);
    expect(matchXboxGame(game, [series])).toBe(series);
    expect(matchXboxGame({ ...game, targetPlatformName: "Xbox 360" }, [series])).toBeNull();
    expect(matchXboxGame({ ...game, targetPlatformName: "Xbox One" }, [series])).toBe(series);
  });
});

describe.each(activeTestDialects())("PlayStation and Xbox sync (%s)", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let userId: string;
  let psnGameId: string;
  let xboxGameId: string;
  let psn: typeof import("../psn-sync.js");
  let xbox: typeof import("../xbox-sync.js");

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const user = await ctx.storage.registerSetupUser({ username: "owner", passwordHash: "hash" });
    userId = user.id;
    psn = await import("../psn-sync.js");
    xbox = await import("../xbox-sync.js");
    const { psnRoutes } = await import("../psn-routes.js");
    const { xboxRoutes } = await import("../xbox-routes.js");
    app = express();
    app.use(express.json());
    app.use(psnRoutes);
    app.use(xboxRoutes);
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
    psnGameId = (
      await ctx.storage.addGame({
        userId,
        igdbId: Math.floor(Math.random() * 1e9),
        title: "Astro Bot",
        status: "playing",
        platforms: ["PlayStation 5"],
      })
    ).id;
    xboxGameId = (
      await ctx.storage.addGame({
        userId,
        igdbId: Math.floor(Math.random() * 1e9),
        title: "Halo Infinite",
        status: "owned",
        platforms: ["Xbox Series X|S"],
      })
    ).id;
    await psn.psnAccount.clearAccount(userId);
    await xbox.xboxAccount.clearAccount(userId);
  });

  describe("PlayStation", () => {
    beforeEach(async () => {
      answerPsn([trophySet("NPWR1", "Astro Bot", "PS5", 12, 40)]);
      await psn.psnAccount.saveAccount(userId, { secret: NPSSO });
      await psn.psnAccount.setEnabled(userId, true);
      fixtures.safeFetch.mockClear();
    });

    it("stores trophies of matched games and notifies on new ones", async () => {
      answerPsn([
        trophySet("NPWR1", "Astro Bot", "PS5", 12, 40),
        trophySet("NPWR2", "Not in the library", "PS5", 3, 30),
      ]);
      expect(await psn.psnAccount.sync(userId, { now: T0 })).toEqual({
        gamesSynced: 1,
        newUnlocks: 0,
      });
      const [row] = await ctx.storage.getUserAchievementProgress(userId);
      expect(row).toMatchObject({ gameId: psnGameId, provider: "psn", unlocked: 12, total: 40 });
      expect(await ctx.storage.getNotifications(userId)).toHaveLength(0);

      answerPsn([trophySet("NPWR1", "Astro Bot", "PS5", 15, 40)]);
      expect(await psn.psnAccount.sync(userId, { now: hours(13) })).toEqual({
        gamesSynced: 1,
        newUnlocks: 3,
      });
      expect(fixtures.notify).toHaveBeenCalledWith(
        "achievementsUpdated",
        { source: "psn" },
        userId
      );
    });

    it("sends the token as a cookie only, never in a URL", async () => {
      await psn.psnAccount.sync(userId, { now: T0 });
      const calls = fixtures.safeFetch.mock.calls;
      const authorize = calls.find(([url]) => String(url).includes("/oauth/authorize"));
      expect(authorize![1].headers.Cookie).toBe(`npsso=${NPSSO}`);
      for (const [url] of calls) expect(String(url)).not.toContain(NPSSO);
    });

    it("drops the row of a game that no longer matches", async () => {
      await psn.psnAccount.sync(userId, { now: T0 });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
      answerPsn([]);
      await psn.psnAccount.sync(userId, { now: hours(13) });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(0);
    });

    it("keeps the stored progress when the answer has an unexpected shape", async () => {
      await psn.psnAccount.sync(userId, { now: T0 });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
      answerPsn([{ npCommunicationId: "NPWR1", trophyTitleName: "Astro Bot" } as never]);
      await psn.psnAccount.sync(userId, { now: hours(13) });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
    });

    it("reports a refused token as a sync error without the token", async () => {
      answerPsn([], { code: null });
      expect(await psn.psnAccount.sync(userId, { now: T0 })).toEqual({
        gamesSynced: 0,
        newUnlocks: 0,
      });
      const status = await psn.psnAccount.getStatus(userId);
      expect(status.lastError).toMatch(/PlayStation/);
      expect(JSON.stringify(status)).not.toContain(NPSSO);
    });

    it("saves, shows and removes the account over HTTP", async () => {
      await psn.psnAccount.clearAccount(userId);
      answerPsn([]);
      const bad = await request(app).put("/api/psn-achievements/credentials").send({ npsso: "no" });
      expect(bad.status).toBe(400);

      const saved = await request(app)
        .put("/api/psn-achievements/credentials")
        .send({ npsso: NPSSO });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ available: true, username: "4242424242" });
      expect(JSON.stringify(saved.body)).not.toContain(NPSSO);

      answerPsn([], { code: null });
      const refused = await request(app)
        .put("/api/psn-achievements/credentials")
        .send({ npsso: NPSSO });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/NPSSO/);

      const removed = await request(app).delete("/api/psn-achievements/credentials");
      expect(removed.body).toMatchObject({ available: false, enabled: false, username: null });
    });

    it("needs a saved token to sync and refuses a key-less first save", async () => {
      await psn.psnAccount.clearAccount(userId);
      const first = await request(app).put("/api/psn-achievements/credentials").send({});
      expect(first.status).toBe(400);
      expect(first.body.error).toMatch(/NPSSO/);
      const res = await request(app).post("/api/psn-achievements/sync");
      expect(res.status).toBe(400);
    });
  });

  describe("Xbox", () => {
    beforeEach(async () => {
      answerXbox([[xboxTitle("1", "Halo Infinite", ["XboxSeries"], 20, 119)]]);
      await xbox.xboxAccount.saveAccount(userId, { secret: XBL_KEY });
      await xbox.xboxAccount.setEnabled(userId, true);
      fixtures.safeFetch.mockClear();
    });

    it("stores progress across pages and notifies on new unlocks", async () => {
      answerXbox([
        [xboxTitle("9", "Not in the library", ["XboxOne"], 1, 10)],
        [xboxTitle("1", "Halo Infinite", ["XboxSeries", "XboxOne"], 20, 119)],
      ]);
      expect(await xbox.xboxAccount.sync(userId, { now: T0 })).toEqual({
        gamesSynced: 1,
        newUnlocks: 0,
      });
      const [row] = await ctx.storage.getUserAchievementProgress(userId);
      expect(row).toMatchObject({ gameId: xboxGameId, provider: "xbox", unlocked: 20, total: 119 });

      answerXbox([[xboxTitle("1", "Halo Infinite", ["XboxSeries"], 25, 119)]]);
      expect(await xbox.xboxAccount.sync(userId, { now: hours(13) })).toEqual({
        gamesSynced: 1,
        newUnlocks: 5,
      });
    });

    it("sends the key in a header only, never in a URL", async () => {
      await xbox.xboxAccount.sync(userId, { now: T0 });
      for (const [url, init] of fixtures.safeFetch.mock.calls) {
        expect(String(url)).not.toContain(XBL_KEY);
        expect(init.headers["X-Authorization"]).toBe(XBL_KEY);
      }
    });

    it("saves the gamertag and refuses a rejected key", async () => {
      await xbox.xboxAccount.clearAccount(userId);
      const saved = await request(app)
        .put("/api/xbox-achievements/credentials")
        .send({ apiKey: XBL_KEY });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ available: true, username: "MasterChief" });
      expect(JSON.stringify(saved.body)).not.toContain(XBL_KEY);

      answerXbox([], 401);
      const refused = await request(app)
        .put("/api/xbox-achievements/credentials")
        .send({ apiKey: XBL_KEY });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/OpenXBL/);
    });

    it("falls back to the account id when there is no gamertag, and refuses a nameless key", async () => {
      await xbox.xboxAccount.clearAccount(userId);
      fixtures.safeFetch.mockImplementation(async () =>
        json({ profileUsers: [{ id: "2535400000000001", settings: [] }] })
      );
      await xbox.xboxAccount.saveAccount(userId, { secret: XBL_KEY });
      expect((await xbox.xboxAccount.getStatus(userId)).username).toBe("Xbox 2535400000000001");

      await xbox.xboxAccount.clearAccount(userId);
      fixtures.safeFetch.mockImplementation(async () => json({ profileUsers: [] }));
      await expect(xbox.xboxAccount.saveAccount(userId, { secret: XBL_KEY })).rejects.toThrow(
        /which account/
      );
      expect((await xbox.xboxAccount.getStatus(userId)).available).toBe(false);
    });

    it("keeps the stored progress when the answer has an unexpected shape", async () => {
      await xbox.xboxAccount.sync(userId, { now: T0 });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
      fixtures.safeFetch.mockImplementation(async () =>
        json({ titles: [{ titleId: "1", name: "Halo Infinite", progress: 20 }] })
      );
      await xbox.xboxAccount.sync(userId, { now: hours(13) });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(1);
      expect((await xbox.xboxAccount.getStatus(userId)).lastError).toMatch(/Xbox/);
    });

    it("reports a rate limit as an upstream failure", async () => {
      await xbox.xboxAccount.clearAccount(userId);
      answerXbox([], 429);
      const res = await request(app)
        .put("/api/xbox-achievements/credentials")
        .send({ apiKey: XBL_KEY });
      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/rate limit/);
    });

    it("keeps the other provider's progress when this account is removed", async () => {
      await xbox.xboxAccount.sync(userId, { now: T0 });
      answerPsn([trophySet("NPWR1", "Astro Bot", "PS5", 12, 40)]);
      await psn.psnAccount.saveAccount(userId, { secret: NPSSO });
      await psn.psnAccount.setEnabled(userId, true);
      await psn.psnAccount.sync(userId, { now: T0 });
      expect(await ctx.storage.getUserAchievementProgress(userId)).toHaveLength(2);
      await xbox.xboxAccount.clearAccount(userId);
      const rows = await ctx.storage.getUserAchievementProgress(userId);
      expect(rows.map((r) => r.provider)).toEqual(["psn"]);
    });
  });
});
