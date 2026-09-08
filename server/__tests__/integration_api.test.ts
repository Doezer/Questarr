import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createDbMock,
  createLoggerMocks,
  createRssMock,
  createTorznabMock,
  createNewznabMock,
  createProwlarrMock,
  createXrelMock,
  createAppriseMock,
  createDownloaderManagerMock,
  createSteamRoutesMock,
  createSearchMock,
  createConfigLoaderMock,
  createSocketMock,
} from "./fixtures/common-route-mocks.js";

// Like the auth-boundary suite, this one deliberately does NOT mock ../auth.js:
// the whole point is to prove that a real API key authenticates against the
// real middleware, and that it is refused everywhere except /api/integration.
vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../db.js", () => ({ db: createDbMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../rss.js", () => ({ rssService: createRssMock() }));
vi.mock("../torznab.js", () => ({ torznabClient: createTorznabMock() }));
vi.mock("../newznab.js", () => ({ newznabClient: createNewznabMock() }));
vi.mock("../prowlarr.js", () => ({ prowlarrClient: createProwlarrMock() }));
vi.mock("../xrel.js", () => createXrelMock());
vi.mock("../apprise.js", async () => createAppriseMock());
vi.mock("../downloaders.js", () => ({ DownloaderManager: createDownloaderManagerMock() }));
vi.mock("../steam-routes.js", () => ({ steamRoutes: createSteamRoutesMock() }));
vi.mock("../search.js", () => createSearchMock());
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

const JWT_SECRET = mockConfig.auth.jwtSecret;
const RAW_KEY = "qsr_test-raw-key-value";
const USER = { id: "user-1", username: "testuser" };

type Mock = ReturnType<typeof vi.fn>;

describe("integration API", () => {
  let app: express.Express;
  let storage: Awaited<typeof import("../storage.js")>["storage"];
  let keyHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ storage } = await import("../storage.js"));
    const { hashApiKey } = await import("../auth.js");
    keyHash = hashApiKey(RAW_KEY);

    (storage.countUsers as Mock).mockResolvedValue(1);
    (storage.getSystemConfig as Mock).mockResolvedValue(undefined);
    (storage.getUser as Mock).mockResolvedValue(USER);
    (storage.getUserSettings as Mock).mockResolvedValue({});
    (storage.getApiKeyByHash as Mock).mockImplementation(async (hash: string) =>
      hash === keyHash
        ? { id: "key-1", userId: USER.id, name: "Playnite", keyHash, prefix: "qsr_test-ra" }
        : undefined
    );

    const { db } = await import("../db.js");
    (db.get as Mock).mockResolvedValue({ result: 1 });

    const { registerRoutes } = await import("../routes.js");
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  const withKey = (req: request.Test) => req.set("X-Api-Key", RAW_KEY);
  const tokenFor = (id: string) => jwt.sign({ id, username: "testuser" }, JWT_SECRET);

  describe("authentication", () => {
    it("rejects an unauthenticated integration request", async () => {
      const res = await request(app).get("/api/integration/ping");
      expect(res.status).toBe(401);
    });

    it("accepts a valid API key via X-Api-Key", async () => {
      const res = await withKey(request(app).get("/api/integration/ping"));
      expect(res.status).toBe(200);
      expect(res.body.service).toBe("questarr");
      expect(res.body.authenticatedAs.username).toBe("testuser");
      expect(res.body.usingApiKey).toBe(true);
    });

    it("accepts the same key as an Authorization: Bearer credential", async () => {
      const res = await request(app)
        .get("/api/integration/ping")
        .set("Authorization", `Bearer ${RAW_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body.usingApiKey).toBe(true);
    });

    it("rejects an unknown API key", async () => {
      const res = await request(app)
        .get("/api/integration/ping")
        .set("X-Api-Key", "qsr_not-a-real-key");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid API key");
    });

    it("still accepts a JWT, so the browser UI keeps working", async () => {
      const res = await request(app)
        .get("/api/integration/ping")
        .set("Authorization", `Bearer ${tokenFor(USER.id)}`);
      expect(res.status).toBe(200);
      expect(res.body.usingApiKey).toBe(false);
    });

    it("records the key's last-used timestamp", async () => {
      await withKey(request(app).get("/api/integration/ping"));
      expect(storage.touchApiKey).toHaveBeenCalledWith("key-1");
    });

    it("does not fail the request when recording last-used time fails", async () => {
      (storage.touchApiKey as Mock).mockRejectedValue(new Error("db unavailable"));
      const res = await withKey(request(app).get("/api/integration/ping"));
      expect(res.status).toBe(200);
    });

    it("rejects a key whose owning user no longer exists", async () => {
      (storage.getUser as Mock).mockImplementation(async (id: string) =>
        id === USER.id ? undefined : USER
      );

      const res = await withKey(request(app).get("/api/integration/ping"));

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid API key");
    });

    it("returns 500 when API key authentication itself fails", async () => {
      (storage.getApiKeyByHash as Mock).mockRejectedValue(new Error("db unavailable"));

      const res = await withKey(request(app).get("/api/integration/ping"));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Authentication failed");
    });

    it("does NOT accept an API key outside the integration surface", async () => {
      // The key must be useless against the rest of the API — most importantly
      // against key management itself, so a leaked key cannot mint another.
      const res = await request(app).get("/api/config").set("X-Api-Key", RAW_KEY);
      expect(res.status).toBe(401);
    });

    it("does NOT let an API key list or create other keys", async () => {
      const list = await request(app).get("/api/api-keys").set("X-Api-Key", RAW_KEY);
      expect(list.status).toBe(401);

      const create = await request(app)
        .post("/api/api-keys")
        .set("X-Api-Key", RAW_KEY)
        .send({ name: "escalation" });
      expect(create.status).toBe(401);
    });
  });

  describe("GET /api/integration/library", () => {
    it("returns the caller's library in the external shape", async () => {
      (storage.getUserGames as Mock).mockResolvedValue([
        {
          id: "game-1",
          title: "Hollow Knight",
          igdbId: 14593,
          steamAppId: 367520,
          status: "owned",
          coverUrl: "https://example.test/cover.jpg",
          platforms: ["PC"],
          genres: ["Platform"],
          libraryPath: null,
          addedAt: null,
          releaseStatus: "released",
          releaseDate: "2017-02-24",
          // Fields that must not leak into the integration payload:
          userId: "user-1",
          notes: "private note",
        },
      ]);

      const res = await withKey(request(app).get("/api/integration/library"));

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.games[0]).toMatchObject({ id: "game-1", title: "Hollow Knight" });
      expect(res.body.games[0]).not.toHaveProperty("notes");
      expect(res.body.games[0]).not.toHaveProperty("userId");
    });

    it("passes a comma-separated status filter through to storage", async () => {
      await withKey(request(app).get("/api/integration/library?status=wanted,owned"));
      expect(storage.getUserGames).toHaveBeenCalledWith("user-1", false, ["wanted", "owned"]);
    });

    it("rejects a malformed status filter instead of silently matching everything", async () => {
      const res = await withKey(request(app).get("/api/integration/library?status=,"));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid query parameters");
    });

    it("rejects an unknown status value", async () => {
      const res = await withKey(
        request(app).get("/api/integration/library?status=not-a-real-status")
      );
      expect(res.status).toBe(400);
    });

    it("returns 500 when the library lookup fails", async () => {
      (storage.getUserGames as Mock).mockRejectedValue(new Error("db unavailable"));

      const res = await withKey(request(app).get("/api/integration/library"));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch library");
    });
  });

  describe("POST /api/integration/library/sync", () => {
    const library = [
      {
        id: "game-1",
        title: "The Witcher 3: Wild Hunt",
        status: "wanted",
        steamAppId: 292030,
      },
      { id: "game-2", title: "Celeste", status: "owned", steamAppId: null },
    ];

    beforeEach(() => {
      (storage.getUserGames as Mock).mockResolvedValue(library);
      (storage.updateGameStatus as Mock).mockResolvedValue(undefined);
    });

    it("matches on a normalized title", async () => {
      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "the witcher 3 wild hunt", externalId: "pn-1" }],
      });

      expect(res.status).toBe(200);
      expect(res.body.matched).toHaveLength(1);
      expect(res.body.matched[0]).toMatchObject({ gameId: "game-1", externalId: "pn-1" });
      expect(res.body.unmatched).toHaveLength(0);
    });

    it("prefers a Steam app id over the title", async () => {
      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "Something Playnite Named Differently", steamAppId: 292030 }],
      });

      expect(res.body.matched[0].gameId).toBe("game-1");
    });

    it("reports titles Questarr does not know", async () => {
      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "A Game Not In Questarr", externalId: "pn-9" }],
      });

      expect(res.body.matched).toHaveLength(0);
      expect(res.body.unmatched).toEqual([{ externalId: "pn-9", title: "A Game Not In Questarr" }]);
    });

    it("leaves statuses alone unless markInstalledAsOwned is set", async () => {
      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "The Witcher 3: Wild Hunt", installed: true }],
      });

      expect(storage.updateGameStatus).not.toHaveBeenCalled();
      expect(res.body.promotedToOwned).toBe(0);
    });

    it("promotes an installed 'wanted' game to 'owned' when asked", async () => {
      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "The Witcher 3: Wild Hunt", installed: true }],
        markInstalledAsOwned: true,
      });

      expect(storage.updateGameStatus).toHaveBeenCalledWith("game-1", { status: "owned" });
      expect(res.body.promotedToOwned).toBe(1);
      expect(res.body.matched[0].status).toBe("owned");
    });

    it("does not touch a game that is already owned", async () => {
      await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "Celeste", installed: true }],
        markInstalledAsOwned: true,
      });

      expect(storage.updateGameStatus).not.toHaveBeenCalled();
    });

    it("rejects an empty payload", async () => {
      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [],
      });
      expect(res.status).toBe(400);
    });

    it("matches against the first game when two library entries share a normalized title", async () => {
      (storage.getUserGames as Mock).mockResolvedValue([
        ...library,
        { id: "game-3", title: "celeste", status: "owned", steamAppId: null },
      ]);

      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "Celeste" }],
      });

      expect(res.body.matched[0].gameId).toBe("game-2");
    });

    it("returns 500 when the sync fails", async () => {
      (storage.getUserGames as Mock).mockRejectedValue(new Error("db unavailable"));

      const res = await withKey(request(app).post("/api/integration/library/sync")).send({
        games: [{ title: "Anything" }],
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Library sync failed");
    });
  });

  describe("POST /api/integration/games/request", () => {
    beforeEach(async () => {
      const { igdbClient } = await import("../igdb.js");
      (igdbClient.searchGames as Mock).mockResolvedValue([{ id: 1 }]);
      (igdbClient.formatGameData as Mock).mockReturnValue({
        title: "Hades",
        igdbId: 113112,
        platforms: ["PC"],
        releaseDate: "2020-09-17",
        isAdultContent: false,
        isAgeRestricted: false,
      });
      (storage.getUserGames as Mock).mockResolvedValue([]);
      (storage.addGame as Mock).mockImplementation(async (game: Record<string, unknown>) => ({
        ...game,
        id: "new-game",
      }));
    });

    it("adds a matched game as 'wanted' so auto-search picks it up", async () => {
      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "Hades",
      });

      expect(res.status).toBe(201);
      expect(res.body.game).toMatchObject({ id: "new-game", title: "Hades" });
      expect(storage.addGame).toHaveBeenCalledWith(
        expect.objectContaining({ status: "wanted", userId: "user-1", source: "api" })
      );
    });

    it("stamps an already-released game so it is not filed as upcoming", async () => {
      await withKey(request(app).post("/api/integration/games/request")).send({ title: "Hades" });

      expect(storage.addGame).toHaveBeenCalledWith(
        expect.objectContaining({ releaseStatus: "released" })
      );
    });

    it("returns 409 when the game is already in the library", async () => {
      (storage.getUserGames as Mock).mockResolvedValue([
        { id: "game-1", title: "Hades", igdbId: 113112, status: "owned" },
      ]);

      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "Hades",
      });

      expect(res.status).toBe(409);
      expect(res.body.game.id).toBe("game-1");
      expect(storage.addGame).not.toHaveBeenCalled();
    });

    it("returns 404 when IGDB has no match", async () => {
      const { igdbClient } = await import("../igdb.js");
      (igdbClient.searchGames as Mock).mockResolvedValue([]);

      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "Definitely Not A Game",
      });

      expect(res.status).toBe(404);
    });

    it("hides a content-filtered match behind the same 404", async () => {
      const { igdbClient } = await import("../igdb.js");
      (igdbClient.formatGameData as Mock).mockReturnValue({
        title: "Filtered",
        igdbId: 999,
        isAdultContent: true,
      });
      (storage.getUserSettings as Mock).mockResolvedValue({ hideAdultContent: true });

      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "Filtered",
      });

      expect(res.status).toBe(404);
      expect(storage.addGame).not.toHaveBeenCalled();
    });

    it("rejects a blank title", async () => {
      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "   ",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when the matched IGDB data fails schema validation", async () => {
      const { igdbClient } = await import("../igdb.js");
      // No title -- insertGameSchema requires one, so quickAddGameByTitle's
      // own `insertGameSchema.parse` throws a ZodError before storage is touched.
      (igdbClient.formatGameData as Mock).mockReturnValue({
        igdbId: 113112,
        isAdultContent: false,
        isAgeRestricted: false,
      });

      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "Hades",
      });

      expect(res.status).toBe(400);
      expect(storage.addGame).not.toHaveBeenCalled();
    });

    it("returns 500 when the request fails for a reason other than validation", async () => {
      (storage.getUserGames as Mock).mockRejectedValue(new Error("db unavailable"));

      const res = await withKey(request(app).post("/api/integration/games/request")).send({
        title: "Hades",
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to request game");
    });
  });

  describe("API key management (JWT only)", () => {
    const authed = (req: request.Test) => req.set("Authorization", `Bearer ${tokenFor(USER.id)}`);

    it("returns the raw key exactly once, on creation", async () => {
      (storage.getApiKeys as Mock).mockResolvedValue([]);
      (storage.addApiKey as Mock).mockImplementation(
        async (key: { name: string; prefix: string }) => ({
          id: "key-2",
          userId: USER.id,
          name: key.name,
          prefix: key.prefix,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        })
      );

      const res = await authed(request(app).post("/api/api-keys")).send({ name: "Playnite" });

      expect(res.status).toBe(201);
      expect(res.body.key).toMatch(/^qsr_/);
      expect(res.body).not.toHaveProperty("keyHash");

      // What got persisted must be the hash, never the key itself.
      const stored = (storage.addApiKey as Mock).mock.calls[0][0];
      expect(stored.keyHash).not.toContain(res.body.key);
      const { hashApiKey } = await import("../auth.js");
      expect(stored.keyHash).toBe(hashApiKey(res.body.key));
    });

    it("returns 500 when listing keys fails", async () => {
      (storage.getApiKeys as Mock).mockRejectedValue(new Error("db unavailable"));
      const res = await authed(request(app).get("/api/api-keys"));
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to list API keys");
    });

    it("never exposes the hash when listing keys", async () => {
      (storage.getApiKeys as Mock).mockResolvedValue([
        {
          id: "key-1",
          userId: USER.id,
          name: "Playnite",
          prefix: "qsr_abc",
          createdAt: null,
          lastUsedAt: null,
        },
      ]);

      const res = await authed(request(app).get("/api/api-keys"));

      expect(res.status).toBe(200);
      expect(res.body[0]).not.toHaveProperty("keyHash");
    });

    it("rejects a blank name", async () => {
      const res = await authed(request(app).post("/api/api-keys")).send({ name: "  " });
      expect(res.status).toBe(400);
    });

    it("returns 409 when storage reports the per-user key cap is reached", async () => {
      // storage.addApiKey does the count-and-insert atomically and throws
      // this exact message when the cap is hit; the route translates it to
      // a 409 rather than a generic 500.
      (storage.addApiKey as Mock).mockRejectedValue(new Error("API key limit reached"));

      const res = await authed(request(app).post("/api/api-keys")).send({ name: "One too many" });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/at most/i);
    });

    it("returns 500 when key creation fails for a reason other than the cap", async () => {
      (storage.addApiKey as Mock).mockRejectedValue(new Error("db unavailable"));

      const res = await authed(request(app).post("/api/api-keys")).send({ name: "Playnite" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to create API key");
    });

    it("revokes a key scoped to the calling user", async () => {
      const keyId = "11111111-1111-4111-8111-111111111111";
      (storage.removeApiKey as Mock).mockResolvedValue(true);
      const res = await authed(request(app).delete(`/api/api-keys/${keyId}`));

      expect(res.status).toBe(204);
      expect(storage.removeApiKey).toHaveBeenCalledWith(keyId, USER.id);
    });

    it("returns 404 when the key belongs to someone else", async () => {
      const keyId = "22222222-2222-4222-8222-222222222222";
      (storage.removeApiKey as Mock).mockResolvedValue(false);
      const res = await authed(request(app).delete(`/api/api-keys/${keyId}`));
      expect(res.status).toBe(404);
    });

    it("rejects a malformed key ID before it ever reaches storage", async () => {
      const res = await authed(request(app).delete("/api/api-keys/not-a-uuid"));
      expect(res.status).toBe(400);
      expect(storage.removeApiKey).not.toHaveBeenCalled();
    });

    it("returns 500 when revocation fails", async () => {
      const keyId = "33333333-3333-4333-8333-333333333333";
      (storage.removeApiKey as Mock).mockRejectedValue(new Error("db unavailable"));

      const res = await authed(request(app).delete(`/api/api-keys/${keyId}`));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to revoke API key");
    });
  });
});

describe("integrationRouter's own auth guard", () => {
  // Every real mount point runs this router behind authenticateApiKeyOrToken,
  // so req.user is always populated by the time a request reaches it. This
  // guard only exists as defence-in-depth against a future mount that forgets
  // that middleware -- exercise it directly, without going through the app's
  // real auth stack, to prove it actually blocks an unauthenticated request.
  it("returns 401 when mounted without an authentication middleware in front of it", async () => {
    const { integrationRouter } = await import("../routes/integration.js");
    const app = express();
    app.use(express.json());
    app.use("/api/integration", integrationRouter);

    const res = await request(app).get("/api/integration/ping");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });
});
