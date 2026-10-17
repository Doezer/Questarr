import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createStorageMock,
  createIgdbMock,
  createLoggerMocks,
} from "./fixtures/common-route-mocks.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../logger.js", () => createLoggerMocks());
vi.mock("../downloaders/manager.js", () => ({
  DownloaderManager: { removeDownload: vi.fn().mockResolvedValue({ success: true, message: "" }) },
}));

type Mock = ReturnType<typeof vi.fn>;

const USER = { id: "user-1", username: "testuser" };
const igdbGame = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  igdbId: id,
  name,
  title: name,
  platforms: ["PC (Microsoft Windows)"],
  platformOptions: [{ id: 6, name: "PC (Microsoft Windows)" }],
  genres: ["Adventure"],
  releaseDate: "2020-01-15",
  ...extra,
});

describe("SeerrNG provider API", () => {
  let app: express.Express;
  let storage: Awaited<typeof import("../storage.js")>["storage"];
  let igdb: Awaited<typeof import("../igdb.js")>["igdbClient"];
  let ledger: Map<string, Record<string, unknown>>;
  let games: Map<string, Record<string, unknown>>;
  let keyScope: string;
  let tmp: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    keyScope = "integration:seerrng";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seerrng-"));
    ledger = new Map();
    games = new Map();

    ({ storage } = await import("../storage.js"));
    ({ igdbClient: igdb } = await import("../igdb.js"));

    (storage.getUserSettings as Mock).mockResolvedValue({});
    (storage.getUserGames as Mock).mockImplementation(async () => [...games.values()]);
    (storage.getGame as Mock).mockImplementation(async (id: string) => games.get(id));
    (storage.addGame as Mock).mockImplementation(async (data: Record<string, unknown>) => {
      const game = { id: `game-${games.size + 1}`, status: "wanted", userId: USER.id, ...data };
      games.set(game.id as string, game);
      return game;
    });
    (storage.updateGameStatus as Mock).mockImplementation(
      async (id: string, { status }: { status: string }) => {
        games.set(id, { ...games.get(id), status });
      }
    );
    (storage.updateGameSearchResultsAvailable as Mock).mockResolvedValue(undefined);
    (storage.getDownloadsByGameId as Mock).mockResolvedValue([]);
    (storage.getGameFiles as Mock).mockResolvedValue([]);
    (storage.getImportConfig as Mock).mockResolvedValue({ libraryRoot: tmp });
    (storage.getEnabledRootFolders as Mock).mockResolvedValue([]);
    const keyOf = (userId: string, id: string) => `${userId}:${id}`;
    (storage.getIntegrationRequest as Mock).mockImplementation(async (userId: string, id: string) =>
      ledger.get(keyOf(userId, id))
    );
    (storage.addIntegrationRequest as Mock).mockImplementation(
      async (r: Record<string, unknown>) => {
        const key = keyOf(r.userId as string, r.externalRequestId as string);
        const existing = ledger.get(key);
        if (existing) return { request: existing, created: false };
        const row = {
          id: `req-${ledger.size + 1}`,
          status: "accepted",
          errorMessage: null,
          gameId: null,
          ...r,
        };
        ledger.set(key, row);
        return { request: row, created: true };
      }
    );
    (storage.updateIntegrationRequest as Mock).mockImplementation(
      async (userId: string, id: string, updates: Record<string, unknown>) => {
        const key = keyOf(userId, id);
        const row = { ...ledger.get(key), ...updates };
        ledger.set(key, row);
        return row;
      }
    );
    (storage.getIntegrationRequestByGameId as Mock).mockImplementation(
      async (_userId: string, gameId: string) =>
        [...ledger.values()].find((r) => r.gameId === gameId)
    );

    (igdb.formatGameData as Mock).mockImplementation((g) => g);
    (igdb.getGameById as Mock).mockImplementation(async (id: number) => igdbGame(id, `Game ${id}`));
    (igdb.searchGames as Mock).mockResolvedValue([igdbGame(42, "Example Game")]);

    const { seerrngRouter } = await import("../routes/seerrng.js");
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = USER as never;
      req.apiKeyId = "key-1";
      req.apiKeyScope = keyScope as never;
      next();
    });
    app.use("/api/integration/seerrng/v1", seerrngRouter);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const base = "/api/integration/seerrng/v1";
  const variant = { operatingSystem: "windows", architecture: "x64" };
  const createBody = {
    externalRequestId: "seerrng:request:1",
    title: "Example Game",
    igdbId: 42,
    variant,
  };

  describe("scope", () => {
    it("refuses keys scoped to something else", async () => {
      keyScope = "integration:playnite";
      expect((await request(app).get(`${base}/ping`)).status).toBe(403);
      expect((await request(app).post(`${base}/requests`).send(createBody)).status).toBe(403);
    });

    it("accepts integration:seerrng and integration:all", async () => {
      expect((await request(app).get(`${base}/ping`)).status).toBe(200);
      keyScope = "integration:all";
      expect((await request(app).get(`${base}/ping`)).status).toBe(200);
    });

    it("declares a scope on every route", async () => {
      const { seerrngRouter } = await import("../routes/seerrng.js");
      const routes = (
        seerrngRouter.stack as Array<{
          route?: { path: string; stack: Array<{ handle: { requiredScopes?: string[] } }> };
        }>
      ).filter((layer) => layer.route);
      expect(routes.length).toBeGreaterThan(10);
      for (const layer of routes) {
        const declared = layer.route!.stack.some((l) => Array.isArray(l.handle.requiredScopes));
        expect(declared, `${layer.route!.path} must call requireScope()`).toBe(true);
      }
    });
  });

  describe("handshake and catalog", () => {
    it("advertises the contract versions SeerrNG gates on", async () => {
      const res = await request(app).get(`${base}/ping`);
      expect(res.body).toMatchObject({
        service: "Questarr",
        apiVersion: 1,
        requestContractVersion: 2,
        capabilities: {
          catalog: true,
          pcAcquisition: true,
          emulationAcquisition: false,
          requestActions: { retry: true, cancel: true },
          assetStreaming: true,
        },
      });
    });

    it("searches the catalog and validates the query", async () => {
      const res = await request(app).get(`${base}/catalog/search?q=example&limit=5`);
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({ id: "igdb-42", igdbId: 42, title: "Example Game" });
      expect(igdb.searchGames).toHaveBeenCalledWith("example", 5);
      expect((await request(app).get(`${base}/catalog/search`)).status).toBe(400);
      expect((await request(app).get(`${base}/catalog/search?q=x&limit=51`)).status).toBe(400);
    });

    it("hides adult titles when the account filters them", async () => {
      (storage.getUserSettings as Mock).mockResolvedValue({ hideAdultContent: true });
      (igdb.searchGames as Mock).mockResolvedValue([
        igdbGame(1, "Fine"),
        igdbGame(2, "Adult", { isAdultContent: true }),
      ]);
      const res = await request(app).get(`${base}/catalog/search?q=g`);
      expect(res.body.map((g: { igdbId: number }) => g.igdbId)).toEqual([1]);
    });

    it("pages search results with an offset cursor", async () => {
      (igdb.searchGames as Mock).mockResolvedValue(
        [1, 2, 3, 4, 5].map((id) => igdbGame(id, `Game ${id}`))
      );
      const first = await request(app).get(`${base}/catalog/search-page?q=game&limit=2`);
      expect(first.body.results.map((g: { igdbId: number }) => g.igdbId)).toEqual([1, 2]);
      expect(first.body.nextCursor).toBe("2");
      const last = await request(app).get(`${base}/catalog/search-page?q=game&limit=2&cursor=4`);
      expect(last.body.results.map((g: { igdbId: number }) => g.igdbId)).toEqual([5]);
      expect(last.body.nextCursor).toBeNull();
      expect((await request(app).get(`${base}/catalog/search-page?q=game&cursor=abc`)).status).toBe(
        400
      );
    });

    it("filters pages by platform, genre and year", async () => {
      (igdb.getPopularGames as Mock).mockResolvedValue([
        igdbGame(1, "A"),
        igdbGame(2, "B", { platformOptions: [{ id: 48, name: "PS4" }] }),
        igdbGame(3, "C", { genres: ["Puzzle"] }),
        igdbGame(4, "D", { releaseDate: "1999-01-01" }),
      ]);
      const res = await request(app).get(
        `${base}/catalog/popular-page?platformIds=6&genre=adventure&releaseYear=2020`
      );
      expect(res.body.results.map((g: { igdbId: number }) => g.igdbId)).toEqual([1]);
      expect(res.body.nextOffset).toBeNull();
    });

    it("keeps paging past entries removed by filters", async () => {
      (igdb.getPopularGames as Mock).mockResolvedValue([
        ...[1, 2, 3].map((id) => igdbGame(id, `P${id}`, { genres: ["Puzzle"] })),
        ...[4, 5, 6].map((id) => igdbGame(id, `A${id}`)),
      ]);
      const first = await request(app).get(`${base}/catalog/popular-page?genre=adventure&limit=2`);
      expect(first.body.results.map((g: { igdbId: number }) => g.igdbId)).toEqual([4, 5]);
      expect(first.body.nextOffset).toBe(5);
      const second = await request(app).get(
        `${base}/catalog/popular-page?genre=adventure&limit=2&offset=5`
      );
      expect(second.body.results.map((g: { igdbId: number }) => g.igdbId)).toEqual([6]);
      expect(second.body.nextOffset).toBeNull();
    });

    it("returns game details and 404 for a filtered or unknown game", async () => {
      const ok = await request(app).get(`${base}/catalog/games/42`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ igdbId: 42, screenshots: [], videos: [] });
      (igdb.getGameById as Mock).mockResolvedValue(null);
      expect((await request(app).get(`${base}/catalog/games/43`)).status).toBe(404);
      expect((await request(app).get(`${base}/catalog/games/zero`)).status).toBe(400);
    });

    it("looks up library games by IGDB id", async () => {
      games.set("g1", { id: "g1", userId: USER.id, igdbId: 42, status: "owned", title: "A" });
      games.set("g2", { id: "g2", userId: USER.id, igdbId: 7, status: "wanted", title: "B" });
      const res = await request(app).get(`${base}/library/lookup?igdbIds=42,43`);
      expect(res.body.games).toEqual([{ igdbId: 42, status: "owned", deliverable: false }]);
      expect((await request(app).get(`${base}/library/lookup`)).status).toBe(400);
    });
  });

  describe("requests", () => {
    it("creates a request, adds the game for the requested OS and reports searching", async () => {
      const res = await request(app).post(`${base}/requests`).send(createBody);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        externalRequestId: "seerrng:request:1",
        status: "searching",
        deliverable: false,
        variant,
        identity: { catalogProvider: "igdb", catalogId: 42 },
        actions: { retry: false, cancel: true },
      });
      expect(igdb.getGameById).toHaveBeenCalledWith(42);
      expect(storage.addGame).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "wanted",
          targetPlatformId: 6,
          targetPlatformName: "PC (Microsoft Windows)",
        })
      );
    });

    it("targets Linux and macOS releases for those variants", async () => {
      await request(app)
        .post(`${base}/requests`)
        .send({ ...createBody, variant: { operatingSystem: "linux", architecture: "x64" } });
      expect(storage.addGame).toHaveBeenCalledWith(
        expect.objectContaining({ targetPlatformId: 3, targetPlatformName: "Linux" })
      );
    });

    it("is idempotent: the same payload replays with 200, a different one conflicts", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      const replay = await request(app).post(`${base}/requests`).send(createBody);
      expect(replay.status).toBe(200);
      expect(storage.addGame).toHaveBeenCalledTimes(1);
      const conflict = await request(app)
        .post(`${base}/requests`)
        .send({ ...createBody, variant: { operatingSystem: "linux", architecture: "x64" } });
      expect(conflict.status).toBe(409);
    });

    it("rejects invalid payloads", async () => {
      for (const body of [
        {},
        { ...createBody, externalRequestId: "" },
        { ...createBody, variant: { operatingSystem: "beos", architecture: "x64" } },
        { ...createBody, variant: { operatingSystem: "windows" } },
        { ...createBody, igdbId: -1 },
      ]) {
        expect((await request(app).post(`${base}/requests`).send(body)).status).toBe(400);
      }
    });

    it("returns 404 and records a failure when IGDB has no match", async () => {
      (igdb.getGameById as Mock).mockResolvedValue(null);
      const res = await request(app).post(`${base}/requests`).send(createBody);
      expect(res.status).toBe(404);
      const status = await request(app).get(`${base}/requests/seerrng:request:1`);
      expect(status.body).toMatchObject({ status: "failed", actions: { retry: true } });
    });

    it("attaches to a game already in the library and reports its real state", async () => {
      games.set("g1", {
        id: "g1",
        userId: USER.id,
        igdbId: 42,
        status: "owned",
        title: "Example Game",
      });
      const res = await request(app).post(`${base}/requests`).send(createBody);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "available", game: { id: "g1" } });
      expect(storage.addGame).not.toHaveBeenCalled();
    });

    it("marks the request failed when dispatch throws so it can be retried", async () => {
      (storage.addGame as Mock).mockRejectedValueOnce(new Error("db down"));
      const res = await request(app).post(`${base}/requests`).send(createBody);
      expect(res.status).toBe(500);
      const status = await request(app).get(`${base}/requests/seerrng:request:1`);
      expect(status.body).toMatchObject({ status: "failed", actions: { retry: true } });
    });

    it("retargets an unacquired library game to the requested OS", async () => {
      games.set("g1", {
        id: "g1",
        userId: USER.id,
        igdbId: 42,
        status: "wanted",
        title: "Example Game",
        targetPlatformId: 6,
      });
      (storage.updateGame as Mock).mockResolvedValue(undefined);
      const linux = { ...createBody, variant: { operatingSystem: "linux", architecture: "x64" } };
      const res = await request(app).post(`${base}/requests`).send(linux);
      expect(res.status).toBe(201);
      expect(storage.updateGame).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ targetPlatformId: 3 })
      );
    });

    it("does not reset a game acquired since when retrying an unlinked request", async () => {
      await request(app)
        .post(`${base}/requests`)
        .send({ ...createBody, igdbId: 99 });
      ledger.set("user-1:seerrng:request:1", {
        ...ledger.get("user-1:seerrng:request:1"),
        gameId: null,
        igdbId: 42,
        status: "failed",
      });
      games.clear();
      games.set("g9", {
        id: "g9",
        userId: USER.id,
        igdbId: 42,
        status: "owned",
        title: "Example Game",
      });
      const res = await request(app).post(`${base}/requests/seerrng:request:1/retry`).send({});
      expect(res.status).toBe(200);
      expect(games.get("g9")?.status).toBe("owned");
    });

    it("reports a request whose game was deleted as failed and retryable", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      ledger.set("user-1:seerrng:request:1", {
        ...ledger.get("user-1:seerrng:request:1"),
        gameId: null,
        status: "searching",
      });
      games.clear();
      const status = await request(app).get(`${base}/requests/seerrng:request:1`);
      expect(status.body).toMatchObject({ status: "failed", actions: { retry: true } });
    });

    it("adds one game for concurrent exact-ID requests with different titles", async () => {
      const [a, b] = await Promise.all([
        request(app).post(`${base}/requests`).send(createBody),
        request(app)
          .post(`${base}/requests`)
          .send({ ...createBody, externalRequestId: "seerrng:request:2", title: "Other Title" }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(games.size).toBe(1);
    });

    it("lets a cancelled game be requested again under a new request ID", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      await request(app).post(`${base}/requests/seerrng:request:1/cancel`).send({});
      const again = await request(app)
        .post(`${base}/requests`)
        .send({ ...createBody, externalRequestId: "seerrng:request:2" });
      expect(again.status).toBe(201);
      expect(again.body.status).toBe("searching");
    });

    it("refuses to retry onto a game another request has since claimed", async () => {
      await request(app)
        .post(`${base}/requests`)
        .send({ ...createBody, igdbId: 42 });
      ledger.set("user-1:seerrng:request:2", {
        id: "req-x",
        userId: USER.id,
        externalRequestId: "seerrng:request:2",
        title: "Example Game",
        igdbId: 42,
        operatingSystem: "windows",
        architecture: "x64",
        gameId: null,
        status: "failed",
        errorMessage: "x",
      });
      const res = await request(app).post(`${base}/requests/seerrng:request:2/retry`).send({});
      expect(res.status).toBe(409);
    });

    it("refuses console-only IGDB ids", async () => {
      (igdb.getGameById as Mock).mockResolvedValue(
        igdbGame(42, "Console Only", { platformOptions: [{ id: 48, name: "PS4" }] })
      );
      const res = await request(app).post(`${base}/requests`).send(createBody);
      expect(res.status).toBe(404);
      expect(storage.addGame).not.toHaveBeenCalled();
    });

    it("refuses a game already answering another request", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      const res = await request(app)
        .post(`${base}/requests`)
        .send({ ...createBody, externalRequestId: "seerrng:request:2" });
      expect(res.status).toBe(409);
    });

    it("scopes requests to the authenticated user", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      const other = express();
      const { seerrngRouter } = await import("../routes/seerrng.js");
      other.use((req, _res, next) => {
        req.user = { id: "user-2", username: "other" } as never;
        req.apiKeyId = "key-2";
        req.apiKeyScope = "integration:seerrng";
        next();
      });
      other.use(base, seerrngRouter);
      expect((await request(other).get(`${base}/requests/seerrng:request:1`)).status).toBe(404);
    });

    it("maps download progress onto the request status", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      const states: Array<[string, string]> = [
        ["downloading", "downloading"],
        ["paused", "downloading"],
        ["unpacking", "importing"],
        ["manual_review_required", "importing"],
        ["failed", "failed"],
      ];
      for (const [downloadStatus, expected] of states) {
        (storage.getDownloadsByGameId as Mock).mockResolvedValue([
          { id: "d1", status: downloadStatus, addedAt: new Date(), errorMessage: "boom" },
        ]);
        const res = await request(app).get(`${base}/requests/seerrng:request:1`);
        expect(res.body.status).toBe(expected);
      }
    });

    it("retries a failed request by putting the game back in the search pipeline", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      (storage.getDownloadsByGameId as Mock).mockResolvedValue([
        { id: "d1", status: "failed", addedAt: new Date(), errorMessage: "boom" },
      ]);
      games.set("game-1", { ...games.get("game-1"), status: "downloading" });
      const res = await request(app)
        .post(`${base}/requests/seerrng:request:1/retry`)
        .send({ confirmNoExistingDownload: true });
      expect(res.status).toBe(200);
      expect(storage.updateGameStatus).toHaveBeenCalledWith("game-1", { status: "wanted" });
    });

    it("refuses to retry an active, available or cancelled request", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      (storage.getDownloadsByGameId as Mock).mockResolvedValue([
        { id: "d1", status: "downloading", addedAt: new Date() },
      ]);
      expect((await request(app).post(`${base}/requests/seerrng:request:1/retry`)).status).toBe(
        409
      );
      (storage.getDownloadsByGameId as Mock).mockResolvedValue([]);
      await request(app).post(`${base}/requests/seerrng:request:1/cancel`);
      expect((await request(app).post(`${base}/requests/seerrng:request:1/retry`)).status).toBe(
        409
      );
      expect((await request(app).post(`${base}/requests/missing/retry`)).status).toBe(404);
    });

    it("keeps a cancellation when a retry for the same request arrives at the same time", async () => {
      (igdb.getGameById as Mock).mockResolvedValueOnce(null);
      await request(app).post(`${base}/requests`).send(createBody);
      (igdb.getGameById as Mock).mockImplementation(async (id: number) =>
        igdbGame(id, `Game ${id}`)
      );
      const [cancel, retry] = await Promise.all([
        request(app).post(`${base}/requests/seerrng:request:1/cancel`).send({}),
        request(app).post(`${base}/requests/seerrng:request:1/retry`).send({}),
      ]);
      expect(cancel.status).toBe(200);
      expect(retry.status).toBe(409);
      const status = await request(app).get(`${base}/requests/seerrng:request:1`);
      expect(status.body).toMatchObject({ status: "cancelled" });
    });

    it("cancels: stops the tracked download, shelves the game, remembers the cancellation", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      (storage.getDownloadsByGameId as Mock).mockResolvedValue([
        {
          id: "d1",
          status: "downloading",
          downloaderId: "dl1",
          downloadHash: "abc",
          addedAt: new Date(),
        },
      ]);
      (storage.getDownloader as Mock).mockResolvedValue({ id: "dl1" });
      const { DownloaderManager } = await import("../downloaders/manager.js");
      const res = await request(app).post(`${base}/requests/seerrng:request:1/cancel`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "cancelled", actions: { cancel: false } });
      expect(DownloaderManager.removeDownload).toHaveBeenCalledWith({ id: "dl1" }, "abc", false);
      expect(storage.updateGameDownloadStatus).toHaveBeenCalledWith(
        "d1",
        "cancelled",
        "Cancelled through SeerrNG."
      );
      expect(storage.updateGameStatus).toHaveBeenCalledWith("game-1", { status: "shelved" });
      // Replays are idempotent.
      expect((await request(app).post(`${base}/requests/seerrng:request:1/cancel`)).status).toBe(
        200
      );
    });

    it("refuses to cancel while the download client is still confirming the add", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      (storage.getDownloadsByGameId as Mock).mockResolvedValue([
        {
          id: "d1",
          status: "downloading",
          downloaderId: "dl1",
          downloadHash: "questarr-add-1",
          addedAt: new Date(),
        },
      ]);
      expect((await request(app).post(`${base}/requests/seerrng:request:1/cancel`)).status).toBe(
        409
      );
    });
  });

  describe("assets", () => {
    const registerFiles = async (files: Array<{ id: string; name: string; body: string }>) => {
      await request(app).post(`${base}/requests`).send(createBody);
      const rows = files.map((file) => {
        const filePath = path.join(tmp, file.name);
        fs.writeFileSync(filePath, file.body);
        return { id: file.id, originalName: file.name, storedName: file.name, filePath };
      });
      (storage.getGameFiles as Mock).mockResolvedValue(rows);
      games.set("game-1", { ...games.get("game-1"), status: "owned" });
    };

    it("lists registered files inside the library and marks the request available", async () => {
      await registerFiles([{ id: "f1", name: "Example Game.zip", body: "hello world" }]);
      const status = await request(app).get(`${base}/requests/seerrng:request:1`);
      expect(status.body).toMatchObject({ status: "available", deliverable: true });
      const res = await request(app).get(`${base}/requests/seerrng:request:1/assets`);
      expect(res.body).toMatchObject({
        assets: [
          {
            id: "f1",
            name: "Example Game.zip",
            size: 11,
            url: `${base}/requests/seerrng%3Arequest%3A1/assets/f1`,
          },
        ],
        bundleSupported: false,
      });
    });

    it("skips files outside the library or missing on disk", async () => {
      await request(app).post(`${base}/requests`).send(createBody);
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
      const stray = path.join(outside, "stray.bin");
      fs.writeFileSync(stray, "x");
      (storage.getGameFiles as Mock).mockResolvedValue([
        { id: "a", originalName: "stray.bin", storedName: "stray.bin", filePath: stray },
        {
          id: "b",
          originalName: "gone.bin",
          storedName: "gone.bin",
          filePath: path.join(tmp, "gone.bin"),
        },
      ]);
      try {
        const res = await request(app).get(`${base}/requests/seerrng:request:1/assets`);
        expect(res.body.assets).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it("streams a file, honours byte ranges and refuses unknown assets", async () => {
      await registerFiles([{ id: "f1", name: "Example Game.zip", body: "0123456789" }]);
      const url = `${base}/requests/seerrng:request:1/assets/f1`;
      const full = await request(app)
        .get(url)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(full.status).toBe(200);
      expect(full.headers["accept-ranges"]).toBe("bytes");
      expect(full.headers["content-disposition"]).toContain("Example%20Game.zip");
      expect((full.body as Buffer).toString()).toBe("0123456789");
      const part = await request(app)
        .get(url)
        .set("Range", "bytes=2-4")
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(part.status).toBe(206);
      expect(part.headers["content-range"]).toBe("bytes 2-4/10");
      expect((part.body as Buffer).toString()).toBe("234");
      expect((await request(app).get(url).set("Range", "bytes=50-60")).status).toBe(416);
      expect(
        (await request(app).get(`${base}/requests/seerrng:request:1/assets/nope`)).status
      ).toBe(404);
    });

    it("bundles two or more files as a gzip tar and refuses a bundle for one file", async () => {
      await registerFiles([{ id: "f1", name: "a.bin", body: "aaa" }]);
      expect(
        (await request(app).get(`${base}/requests/seerrng:request:1/assets/bundle`)).status
      ).toBe(409);
      await registerFiles([
        { id: "f1", name: "a.bin", body: "aaa" },
        { id: "f2", name: "b.bin", body: "bbbb" },
      ]);
      const list = await request(app).get(`${base}/requests/seerrng:request:1/assets`);
      expect(list.body).toMatchObject({
        bundleSupported: true,
        bundleName: "Game 42.tar.gz",
        bundleUrl: `${base}/requests/seerrng%3Arequest%3A1/assets/bundle`,
      });
      const res = await request(app)
        .get(`${base}/requests/seerrng:request:1/assets/bundle`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/gzip");
      const raw = (await import("node:zlib")).gunzipSync(res.body as Buffer).toString("latin1");
      expect(raw).toContain("a.bin");
      expect(raw).toContain("b.bin");
    });
  });
});
