import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  mockConfig,
  createStorageMock,
  createIgdbMock,
  createAuthMock,
  createDbModuleMock,
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
import { registerRoutes } from "../routes.js";
import { storage } from "../storage.js";
import type { Collection, Game } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({ storage: createStorageMock() }));
vi.mock("../igdb.js", () => ({ igdbClient: createIgdbMock() }));
vi.mock("../auth.js", () => createAuthMock());
vi.mock("../db.js", () => createDbModuleMock());
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
vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    scanRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});
vi.mock("../config.js", () => ({ config: mockConfig }));
vi.mock("../config-loader.js", () => ({ configLoader: createConfigLoaderMock() }));
vi.mock("../socket.js", () => createSocketMock());

const OWNER_ID = "user-1";
const collectionId = "123e4567-e89b-12d3-a456-426614174000";
const gameId = "223e4567-e89b-12d3-a456-426614174000";

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: collectionId,
    userId: OWNER_ID,
    name: "Backlog",
    description: null,
    type: "manual",
    rules: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: gameId,
    userId: OWNER_ID,
    title: "Doom",
    status: "wanted",
    genres: ["Shooter"],
    coverUrl: "https://example.test/doom.jpg",
    ...overrides,
  } as Game;
}

describe("Collection routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);
  });

  it("lists collections with counts, resolving manual links and smart rules", async () => {
    const smartId = "323e4567-e89b-12d3-a456-426614174000";
    vi.mocked(storage.getCollections).mockResolvedValue([
      makeCollection(),
      makeCollection({
        id: smartId,
        name: "Shooters",
        type: "smart",
        rules: { genres: ["shooter"] },
      }),
    ]);
    vi.mocked(storage.getCollectionLinks).mockResolvedValue([{ collectionId, gameId }]);
    vi.mocked(storage.getUserGames).mockResolvedValue([
      makeGame(),
      makeGame({ id: "423e4567-e89b-12d3-a456-426614174000", title: "Zelda", genres: ["RPG"] }),
    ]);

    const response = await request(app).get("/api/collections");

    expect(response.status).toBe(200);
    expect(response.body.map((c: { gameCount: number }) => c.gameCount)).toEqual([1, 1]);
    expect(response.body[0].coverUrls).toEqual(["https://example.test/doom.jpg"]);
  });

  it("creates a manual collection and drops any rules sent with it", async () => {
    vi.mocked(storage.createCollection).mockResolvedValue(makeCollection());

    const response = await request(app)
      .post("/api/collections")
      .send({ name: "  Backlog ", type: "manual", rules: { genres: ["RPG"] } });

    expect(response.status).toBe(201);
    expect(storage.createCollection).toHaveBeenCalledWith({
      userId: OWNER_ID,
      name: "Backlog",
      description: null,
      type: "manual",
      rules: null,
    });
  });

  it("rejects a smart collection without rules", async () => {
    const response = await request(app)
      .post("/api/collections")
      .send({ name: "Empty", type: "smart", rules: {} });

    expect(response.status).toBe(400);
    expect(storage.createCollection).not.toHaveBeenCalled();
  });

  it("rejects unknown rule keys", async () => {
    const response = await request(app)
      .post("/api/collections")
      .send({ name: "Odd", type: "smart", rules: { nope: true } });

    expect(response.status).toBe(400);
  });

  it("returns 404 for a collection that is not the requester's", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(undefined);

    const response = await request(app).get(`/api/collections/${collectionId}`);

    expect(response.status).toBe(404);
  });

  it("refuses to turn a collection smart without rules", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(makeCollection());

    const response = await request(app)
      .patch(`/api/collections/${collectionId}`)
      .send({ type: "smart" });

    expect(response.status).toBe(400);
    expect(storage.updateCollection).not.toHaveBeenCalled();
  });

  it("clears rules when a smart collection becomes manual", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(
      makeCollection({ type: "smart", rules: { genres: ["RPG"] } })
    );
    vi.mocked(storage.updateCollection).mockResolvedValue(makeCollection());

    const response = await request(app)
      .patch(`/api/collections/${collectionId}`)
      .send({ type: "manual" });

    expect(response.status).toBe(200);
    expect(storage.updateCollection).toHaveBeenCalledWith(collectionId, OWNER_ID, {
      type: "manual",
      rules: null,
    });
  });

  it("only adds games to manual collections", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(
      makeCollection({ type: "smart", rules: { genres: ["RPG"] } })
    );

    const response = await request(app)
      .post(`/api/collections/${collectionId}/games`)
      .send({ gameId });

    expect(response.status).toBe(400);
  });

  it("adds a game once and answers 409 on a duplicate", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(makeCollection());
    vi.mocked(storage.getGame).mockResolvedValue(makeGame());
    vi.mocked(storage.addGameToCollection).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await request(app)
      .post(`/api/collections/${collectionId}/games`)
      .send({ gameId });
    const second = await request(app)
      .post(`/api/collections/${collectionId}/games`)
      .send({ gameId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it("does not add another user's game", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(makeCollection());
    vi.mocked(storage.getGame).mockResolvedValue(makeGame({ userId: "someone-else" }));

    const response = await request(app)
      .post(`/api/collections/${collectionId}/games`)
      .send({ gameId });

    expect(response.status).toBe(404);
    expect(storage.addGameToCollection).not.toHaveBeenCalled();
  });

  it("removes a game and deletes a collection", async () => {
    vi.mocked(storage.getCollection).mockResolvedValue(makeCollection());
    vi.mocked(storage.removeGameFromCollection).mockResolvedValue(true);
    vi.mocked(storage.deleteCollection).mockResolvedValue(true);

    const removed = await request(app).delete(`/api/collections/${collectionId}/games/${gameId}`);
    const deleted = await request(app).delete(`/api/collections/${collectionId}`);

    expect(removed.status).toBe(204);
    expect(deleted.status).toBe(204);
  });
});
