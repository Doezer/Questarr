import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import type { Game, GamePlaySession } from "../../shared/schema.js";

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
const gameId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "523e4567-e89b-12d3-a456-426614174000";

function makeGame(overrides: Partial<Game> = {}): Game {
  return { id: gameId, userId: OWNER_ID, title: "Test Game", ...overrides } as Game;
}

function makeSession(overrides: Partial<GamePlaySession> = {}): GamePlaySession {
  return {
    id: sessionId,
    gameId,
    userId: OWNER_ID,
    startedAt: new Date("2026-11-05T10:00:00Z"),
    endedAt: null,
    source: "timer",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("Play session routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    await registerRoutes(app);

    vi.mocked(storage.getGame).mockResolvedValue(
      makeGame() as unknown as Awaited<ReturnType<typeof storage.getGame>>
    );
    vi.mocked(storage.getRunningPlaySession).mockResolvedValue(undefined);
    vi.mocked(storage.addGamePlaySession).mockImplementation(
      async (s) => ({ id: sessionId, createdAt: new Date(), ...s }) as GamePlaySession
    );
  });

  describe("GET /api/games/:id/play-sessions", () => {
    it("returns 404 when the game belongs to someone else", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(
        makeGame({ userId: "someone-else" }) as unknown as Awaited<
          ReturnType<typeof storage.getGame>
        >
      );
      const response = await request(app).get(`/api/games/${gameId}/play-sessions`);
      expect(response.status).toBe(404);
    });

    it("rejects a malformed game id", async () => {
      const response = await request(app).get("/api/games/not-a-uuid/play-sessions");
      expect(response.status).toBe(400);
    });

    it("lists the game's sessions", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([makeSession()]);
      const response = await request(app).get(`/api/games/${gameId}/play-sessions`);
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(storage.getGamePlaySessions).toHaveBeenCalledWith(gameId, OWNER_ID);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getGamePlaySessions).mockRejectedValue(new Error("db down"));
      const response = await request(app).get(`/api/games/${gameId}/play-sessions`);
      expect(response.status).toBe(500);
    });
  });

  describe("POST /api/games/:id/play-sessions (manual)", () => {
    it("records a session that ended just now when no start is given", async () => {
      const before = Date.now();
      const response = await request(app)
        .post(`/api/games/${gameId}/play-sessions`)
        .send({ durationMinutes: 90 });

      expect(response.status).toBe(201);
      const added = vi.mocked(storage.addGamePlaySession).mock.calls[0]?.[0];
      expect(added).toMatchObject({ gameId, userId: OWNER_ID, source: "manual" });
      const length = (added?.endedAt?.getTime() ?? 0) - (added?.startedAt.getTime() ?? 0);
      expect(length).toBe(90 * 60_000);
      expect(added?.endedAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before);
    });

    it("uses the given start", async () => {
      const response = await request(app)
        .post(`/api/games/${gameId}/play-sessions`)
        .send({ startedAt: "2026-01-02T20:00:00Z", durationMinutes: 45 });

      expect(response.status).toBe(201);
      const added = vi.mocked(storage.addGamePlaySession).mock.calls[0]?.[0];
      expect(added?.startedAt.toISOString()).toBe("2026-01-02T20:00:00.000Z");
      expect(added?.endedAt?.toISOString()).toBe("2026-01-02T20:45:00.000Z");
    });

    it.each([{}, { durationMinutes: 0 }, { durationMinutes: 1441 }, { durationMinutes: 1.5 }])(
      "rejects an invalid duration %j",
      async (body) => {
        const response = await request(app).post(`/api/games/${gameId}/play-sessions`).send(body);
        expect(response.status).toBe(400);
        expect(storage.addGamePlaySession).not.toHaveBeenCalled();
      }
    );

    it("rejects a session that ends in the future", async () => {
      const response = await request(app)
        .post(`/api/games/${gameId}/play-sessions`)
        .send({ startedAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30 });
      expect(response.status).toBe(400);
      expect(storage.addGamePlaySession).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/games/:id/play-sessions/start", () => {
    it("starts a timer", async () => {
      const response = await request(app).post(`/api/games/${gameId}/play-sessions/start`);
      expect(response.status).toBe(201);
      expect(storage.addGamePlaySession).toHaveBeenCalledWith(
        expect.objectContaining({ gameId, userId: OWNER_ID, endedAt: null, source: "timer" })
      );
    });

    it("answers 409 with the running session when a timer is already running", async () => {
      vi.mocked(storage.getRunningPlaySession).mockResolvedValue(makeSession());
      const response = await request(app).post(`/api/games/${gameId}/play-sessions/start`);
      expect(response.status).toBe(409);
      expect(response.body.session.id).toBe(sessionId);
      expect(storage.addGamePlaySession).not.toHaveBeenCalled();
    });

    it("answers 409 when a concurrent start loses the one-running-timer index", async () => {
      vi.mocked(storage.getRunningPlaySession)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(makeSession());
      vi.mocked(storage.addGamePlaySession).mockRejectedValueOnce(
        new Error("UNIQUE constraint failed: game_play_sessions.user_id")
      );
      const response = await request(app).post(`/api/games/${gameId}/play-sessions/start`);
      expect(response.status).toBe(409);
      expect(response.body.session.id).toBe(sessionId);
    });

    it("returns 404 for someone else's game", async () => {
      vi.mocked(storage.getGame).mockResolvedValue(undefined);
      const response = await request(app).post(`/api/games/${gameId}/play-sessions/start`);
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/play-sessions/:sessionId/stop", () => {
    it("stops the running timer", async () => {
      const startedAt = new Date(Date.now() - 30 * 60_000);
      vi.mocked(storage.getRunningPlaySession).mockResolvedValue(makeSession({ startedAt }));
      vi.mocked(storage.stopGamePlaySession).mockImplementation(async (_id, _user, endedAt) =>
        makeSession({ startedAt, endedAt })
      );

      const response = await request(app).post(`/api/play-sessions/${sessionId}/stop`);

      expect(response.status).toBe(200);
      expect(response.body.capped).toBe(false);
      expect(response.body.session.endedAt).toBeTruthy();
    });

    it("cuts a forgotten timer off at 24 hours", async () => {
      const startedAt = new Date(Date.now() - 3 * 24 * 3_600_000);
      vi.mocked(storage.getRunningPlaySession).mockResolvedValue(makeSession({ startedAt }));
      vi.mocked(storage.stopGamePlaySession).mockImplementation(async (_id, _user, endedAt) =>
        makeSession({ startedAt, endedAt })
      );

      const response = await request(app).post(`/api/play-sessions/${sessionId}/stop`);

      expect(response.status).toBe(200);
      expect(response.body.capped).toBe(true);
      const endedAt = vi.mocked(storage.stopGamePlaySession).mock.calls[0]?.[2];
      expect((endedAt?.getTime() ?? 0) - startedAt.getTime()).toBe(24 * 3_600_000);
    });

    it("returns 404 when that session is not the running one", async () => {
      vi.mocked(storage.getRunningPlaySession).mockResolvedValue(undefined);
      const response = await request(app).post(`/api/play-sessions/${sessionId}/stop`);
      expect(response.status).toBe(404);
      expect(storage.stopGamePlaySession).not.toHaveBeenCalled();
    });

    it("returns 404 when the timer was ended in between", async () => {
      vi.mocked(storage.getRunningPlaySession).mockResolvedValue(makeSession());
      vi.mocked(storage.stopGamePlaySession).mockResolvedValue(undefined);
      const response = await request(app).post(`/api/play-sessions/${sessionId}/stop`);
      expect(response.status).toBe(404);
    });

    it("rejects a malformed session id", async () => {
      const response = await request(app).post("/api/play-sessions/nope/stop");
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/play-sessions/active", () => {
    it("returns null without a running timer", async () => {
      const response = await request(app).get("/api/play-sessions/active");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ session: null });
    });

    it("returns the running timer", async () => {
      vi.mocked(storage.getRunningPlaySession).mockResolvedValue(makeSession());
      const response = await request(app).get("/api/play-sessions/active");
      expect(response.body.session.id).toBe(sessionId);
    });
  });

  describe("DELETE /api/games/:id/play-sessions/:sessionId", () => {
    it("deletes a session", async () => {
      vi.mocked(storage.deleteGamePlaySession).mockResolvedValue(true);
      const response = await request(app).delete(`/api/games/${gameId}/play-sessions/${sessionId}`);
      expect(response.status).toBe(204);
      expect(storage.deleteGamePlaySession).toHaveBeenCalledWith(sessionId, gameId, OWNER_ID);
    });

    it("returns 404 when it does not exist", async () => {
      vi.mocked(storage.deleteGamePlaySession).mockResolvedValue(false);
      const response = await request(app).delete(`/api/games/${gameId}/play-sessions/${sessionId}`);
      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/stats/play-time", () => {
    it("computes stats from the user's sessions and games", async () => {
      vi.mocked(storage.getUserPlaySessions).mockResolvedValue([
        makeSession({
          startedAt: new Date(Date.now() - 2 * 3_600_000),
          endedAt: new Date(Date.now() - 3_600_000),
        }),
      ]);
      vi.mocked(storage.getUserGames).mockResolvedValue([
        makeGame({ genres: ["RPG"], timeToBeatNormally: 12 }),
      ]);

      const response = await request(app).get("/api/stats/play-time?tz=-60");

      expect(response.status).toBe(200);
      expect(response.body.totalMinutes).toBe(60);
      expect(response.body.topGames[0]).toMatchObject({
        gameId,
        title: "Test Game",
        timeToBeatHours: 12,
      });
      expect(response.body.perWeek).toHaveLength(12);
      expect(storage.getUserGames).toHaveBeenCalledWith(OWNER_ID, true);
    });

    it("accepts an IANA time zone and rejects an unknown one", async () => {
      vi.mocked(storage.getUserPlaySessions).mockResolvedValue([]);
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      const ok = await request(app).get("/api/stats/play-time?timeZone=Europe%2FParis");
      expect(ok.status).toBe(200);
      const bad = await request(app).get("/api/stats/play-time?timeZone=Not%2FAZone");
      expect(bad.status).toBe(400);
    });

    it("falls back to the offset when the zone is unknown but tz is valid", async () => {
      vi.mocked(storage.getUserPlaySessions).mockResolvedValue([]);
      vi.mocked(storage.getUserGames).mockResolvedValue([]);
      const response = await request(app).get("/api/stats/play-time?timeZone=Not%2FAZone&tz=-60");
      expect(response.status).toBe(200);
      const both = await request(app).get("/api/stats/play-time?timeZone=Not%2FAZone&tz=abc");
      expect(both.status).toBe(400);
    });

    it("rejects an invalid time zone offset", async () => {
      const response = await request(app).get("/api/stats/play-time?tz=abc");
      expect(response.status).toBe(400);
    });
  });
});
