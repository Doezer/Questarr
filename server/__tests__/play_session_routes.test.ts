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

  describe("PATCH /api/games/:id/play-sessions/:sessionId", () => {
    const finished = (over: Partial<GamePlaySession> = {}) =>
      makeSession({
        source: "manual",
        startedAt: new Date("2026-11-05T10:00:00Z"),
        endedAt: new Date("2026-11-05T11:00:00Z"),
        ...over,
      });
    const patch = (body: object) =>
      request(app).patch(`/api/games/${gameId}/play-sessions/${sessionId}`).send(body);

    beforeEach(() => {
      vi.mocked(storage.updateGamePlaySession).mockImplementation(async (_id, _g, _u, t) =>
        finished({ ...t })
      );
    });

    it("moves the start and keeps the length", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished()]);
      const response = await patch({ startedAt: "2026-11-04T20:00:00Z" });
      expect(response.status).toBe(200);
      const times = vi.mocked(storage.updateGamePlaySession).mock.calls[0]?.[3];
      expect(times?.startedAt.toISOString()).toBe("2026-11-04T20:00:00.000Z");
      expect(times?.endedAt.toISOString()).toBe("2026-11-04T21:00:00.000Z");
    });

    it.each([true, "90", null])("rejects a non-number duration %j", async (durationMinutes) => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished()]);
      expect((await patch({ durationMinutes })).status).toBe(400);
      expect(storage.updateGamePlaySession).not.toHaveBeenCalled();
    });

    it("applies a new duration from the start", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished()]);
      const response = await patch({ durationMinutes: 150 });
      expect(response.status).toBe(200);
      expect(
        vi.mocked(storage.updateGamePlaySession).mock.calls[0]?.[3].endedAt.toISOString()
      ).toBe("2026-11-05T12:30:00.000Z");
    });

    it("rejects an empty body, both end and duration, and bad limits", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished()]);
      expect((await patch({})).status).toBe(400);
      expect((await patch({ endedAt: "2026-11-05T12:00:00Z", durationMinutes: 30 })).status).toBe(
        400
      );
      expect((await patch({ endedAt: "2026-11-05T09:00:00Z" })).status).toBe(400);
      expect((await patch({ endedAt: "2026-11-06T11:00:00Z" })).status).toBe(400);
      expect((await patch({ startedAt: "2999-01-01T00:00:00Z" })).status).toBe(400);
      expect(storage.updateGamePlaySession).not.toHaveBeenCalled();
    });

    it("refuses imported sessions and running timers, and unknown ids", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished({ source: "steam" })]);
      expect((await patch({ durationMinutes: 30 })).status).toBe(409);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished({ endedAt: null })]);
      expect((await patch({ durationMinutes: 30 })).status).toBe(409);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([]);
      expect((await patch({ durationMinutes: 30 })).status).toBe(404);
    });

    it("answers 409 when the session changed meanwhile", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([finished()]);
      vi.mocked(storage.updateGamePlaySession).mockResolvedValue(undefined);
      expect((await patch({ durationMinutes: 30 })).status).toBe(409);
    });
  });

  describe("POST /api/games/:id/play-sessions/merge", () => {
    const idA = "623e4567-e89b-12d3-a456-426614174000";
    const idB = "723e4567-e89b-12d3-a456-426614174000";
    const at = (value: string) => new Date(`2026-11-05T${value}:00Z`);
    const make = (id: string, from: string, to: string, source = "manual") =>
      makeSession({ id, source, startedAt: at(from), endedAt: at(to) });
    const merge = (ids: string[]) =>
      request(app).post(`/api/games/${gameId}/play-sessions/merge`).send({ sessionIds: ids });

    beforeEach(() => {
      vi.mocked(storage.replaceGamePlaySessions).mockImplementation(async (_u, _g, _i, r) =>
        r.map((x) => makeSession({ id: "new", ...x }))
      );
    });

    it("merges overlapping and nearby sessions from first start to last end", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        make(idA, "10:00", "11:00"),
        make(idB, "11:20", "12:00", "timer"),
      ]);
      const response = await merge([idB, idA]);
      expect(response.status).toBe(201);
      expect(storage.replaceGamePlaySessions).toHaveBeenCalledWith(
        OWNER_ID,
        gameId,
        [
          { id: idA, startedAt: at("10:00"), endedAt: at("11:00") },
          { id: idB, startedAt: at("11:20"), endedAt: at("12:00") },
        ],
        [{ startedAt: at("10:00"), endedAt: at("12:00"), source: "manual" }]
      );
    });

    it("keeps the source when every session shares it", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        make(idA, "10:00", "11:00", "timer"),
        make(idB, "10:30", "10:45", "timer"),
      ]);
      await merge([idA, idB]);
      expect(vi.mocked(storage.replaceGamePlaySessions).mock.calls[0]?.[3][0]?.source).toBe(
        "timer"
      );
    });

    it("rejects far-apart sessions, a result over 24 hours, and bad input", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        make(idA, "10:00", "11:00"),
        make(idB, "13:00", "14:00"),
      ]);
      expect((await merge([idA, idB])).status).toBe(400);
      expect((await merge([idA, idA])).status).toBe(400);
      expect((await merge([idA])).status).toBe(400);
      expect((await merge(["nope", idA])).status).toBe(400);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        makeSession({
          id: idA,
          source: "manual",
          startedAt: new Date("2026-11-03T10:00:00Z"),
          endedAt: new Date("2026-11-04T10:00:00Z"),
        }),
        makeSession({
          id: idB,
          source: "manual",
          startedAt: new Date("2026-11-04T09:00:00Z"),
          endedAt: new Date("2026-11-04T12:00:00Z"),
        }),
      ]);
      expect((await merge([idA, idB])).status).toBe(400);
      expect(storage.replaceGamePlaySessions).not.toHaveBeenCalled();
    });

    it("refuses imported sessions, running timers and unknown ids", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        make(idA, "10:00", "11:00"),
        make(idB, "10:30", "11:30", "playnite"),
      ]);
      expect((await merge([idA, idB])).status).toBe(409);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        make(idA, "10:00", "11:00"),
        makeSession({ id: idB, source: "timer", endedAt: null }),
      ]);
      expect((await merge([idA, idB])).status).toBe(409);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([make(idA, "10:00", "11:00")]);
      expect((await merge([idA, idB])).status).toBe(404);
    });

    it("answers 409 when the sessions changed meanwhile", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([
        make(idA, "10:00", "11:00"),
        make(idB, "10:30", "11:30"),
      ]);
      vi.mocked(storage.replaceGamePlaySessions).mockResolvedValue(undefined);
      expect((await merge([idA, idB])).status).toBe(409);
    });
  });

  describe("POST /api/games/:id/play-sessions/:sessionId/split", () => {
    const session = makeSession({
      source: "timer",
      startedAt: new Date("2026-11-05T10:00:00Z"),
      endedAt: new Date("2026-11-05T22:00:00Z"),
    });
    const split = (splitAt: string) =>
      request(app).post(`/api/games/${gameId}/play-sessions/${sessionId}/split`).send({ splitAt });

    beforeEach(() => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([session]);
      vi.mocked(storage.replaceGamePlaySessions).mockImplementation(async (_u, _g, _i, r) =>
        r.map((x) => makeSession({ id: "new", ...x }))
      );
    });

    it("cuts the session in two at the chosen time", async () => {
      const response = await split("2026-11-05T14:00:00Z");
      expect(response.status).toBe(201);
      expect(response.body).toHaveLength(2);
      expect(storage.replaceGamePlaySessions).toHaveBeenCalledWith(
        OWNER_ID,
        gameId,
        [{ id: sessionId, startedAt: session.startedAt, endedAt: session.endedAt }],
        [
          {
            startedAt: session.startedAt,
            endedAt: new Date("2026-11-05T14:00:00Z"),
            source: "timer",
          },
          {
            startedAt: new Date("2026-11-05T14:00:00Z"),
            endedAt: session.endedAt,
            source: "timer",
          },
        ]
      );
    });

    it("rejects a cut outside the session or leaving a part under a minute", async () => {
      expect((await split("2026-11-05T09:00:00Z")).status).toBe(400);
      expect((await split("2026-11-05T10:00:30Z")).status).toBe(400);
      expect((await split("2026-11-05T21:59:30Z")).status).toBe(400);
      expect((await split("2026-11-06T09:00:00Z")).status).toBe(400);
      expect((await split("not a date")).status).toBe(400);
      expect(storage.replaceGamePlaySessions).not.toHaveBeenCalled();
    });

    it("refuses imported sessions, running timers and unknown ids", async () => {
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([{ ...session, source: "steam" }]);
      expect((await split("2026-11-05T14:00:00Z")).status).toBe(409);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([{ ...session, endedAt: null }]);
      expect((await split("2026-11-05T14:00:00Z")).status).toBe(409);
      vi.mocked(storage.getGamePlaySessions).mockResolvedValue([]);
      expect((await split("2026-11-05T14:00:00Z")).status).toBe(404);
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
      const plus = await request(app).get("/api/stats/play-time?timeZone=Not%2FAZone&tz=%2B60");
      expect(plus.status).toBe(200);
      const both = await request(app).get("/api/stats/play-time?timeZone=Not%2FAZone&tz=abc");
      expect(both.status).toBe(400);
    });

    it("rejects an invalid time zone offset", async () => {
      const response = await request(app).get("/api/stats/play-time?tz=abc");
      expect(response.status).toBe(400);
    });

    it("narrows the figures to from/to and validates them", async () => {
      vi.mocked(storage.getUserPlaySessions).mockResolvedValue([
        makeSession({
          startedAt: new Date("2026-01-10T10:00:00Z"),
          endedAt: new Date("2026-01-10T11:00:00Z"),
        }),
        makeSession({
          startedAt: new Date("2026-03-10T10:00:00Z"),
          endedAt: new Date("2026-03-10T10:30:00Z"),
        }),
      ]);
      vi.mocked(storage.getUserGames).mockResolvedValue([makeGame()]);
      const ok = await request(app).get(
        "/api/stats/play-time?timeZone=UTC&from=2026-03-01&to=2026-03-31"
      );
      expect(ok.status).toBe(200);
      expect(ok.body.totalMinutes).toBe(30);
      expect(ok.body.range).toEqual({ from: "2026-03-01", to: "2026-03-31" });
      expect((await request(app).get("/api/stats/play-time?from=2026-02-30")).status).toBe(400);
      expect(
        (await request(app).get("/api/stats/play-time?from=2026-04-01&to=2026-03-01")).status
      ).toBe(400);
    });
  });

  describe("GET /api/stats/play-time/export", () => {
    beforeEach(() => {
      vi.mocked(storage.getUserPlaySessions).mockResolvedValue([
        makeSession({
          startedAt: new Date("2026-03-10T10:00:00Z"),
          endedAt: new Date("2026-03-10T10:30:00Z"),
          source: "timer",
        }),
        makeSession({ startedAt: new Date("2026-03-11T10:00:00Z"), endedAt: null }),
      ]);
      vi.mocked(storage.getUserGames).mockResolvedValue([
        makeGame({ title: '=HYPERLINK("x"), y' }),
      ]);
    });

    it("returns CSV with spreadsheet formulas neutralised and running timers left out", async () => {
      const response = await request(app).get("/api/stats/play-time/export?timeZone=UTC");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/csv");
      expect(response.headers["content-disposition"]).toContain("attachment");
      const lines = response.text.trim().split("\r\n");
      expect(lines[0]).toBe("game,source,started_at,ended_at,minutes");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe(
        `"'=HYPERLINK(""x""), y",timer,2026-03-10T10:00:00.000Z,2026-03-10T10:30:00.000Z,30`
      );
    });

    it("returns JSON and respects the range", async () => {
      const json = await request(app).get("/api/stats/play-time/export?format=json&timeZone=UTC");
      expect(json.status).toBe(200);
      expect(json.body.sessions).toHaveLength(1);
      expect(json.body.sessions[0]).toMatchObject({ source: "timer", minutes: 30 });
      const empty = await request(app).get(
        "/api/stats/play-time/export?format=json&timeZone=UTC&from=2026-04-01"
      );
      expect(empty.body.sessions).toEqual([]);
      expect((await request(app).get("/api/stats/play-time/export?format=xml")).status).toBe(400);
    });
  });

  describe("GET /api/stats/backlog", () => {
    it("computes the burn-down from the status history, the sessions and the games", async () => {
      vi.mocked(storage.getUserGameStatusEvents).mockResolvedValue([
        {
          id: "e1",
          gameId,
          userId: OWNER_ID,
          status: "owned",
          createdAt: new Date(Date.now() - 20 * 86_400_000),
        },
      ]);
      vi.mocked(storage.getUserPlaySessions).mockResolvedValue([]);
      vi.mocked(storage.getUserGames).mockResolvedValue([
        makeGame({ status: "owned", timeToBeatNormally: 10 }),
      ]);

      const response = await request(app).get("/api/stats/backlog?timeZone=UTC");

      expect(response.status).toBe(200);
      expect(response.body.current).toEqual({
        backlog: 1,
        remainingHours: 10,
        withoutEstimate: 0,
      });
      expect(response.body.perWeek).toHaveLength(12);
      expect(response.body.perMonth).toHaveLength(12);
      expect(response.body.perWeek.at(-1).backlog).toBe(1);
      expect(response.body.projection.clearedOn).toBeNull();
      expect(storage.getUserGameStatusEvents).toHaveBeenCalledWith(OWNER_ID);
    });

    it("rejects an invalid time zone", async () => {
      expect((await request(app).get("/api/stats/backlog?timeZone=Not%2FAZone")).status).toBe(400);
      expect((await request(app).get("/api/stats/backlog?tz=abc")).status).toBe(400);
    });
  });
});
