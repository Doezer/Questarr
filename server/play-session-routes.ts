import { Router, type Request, type Response } from "express";
import { query } from "express-validator";
import { z } from "zod";
import { storage } from "./storage.js";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import {
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizePlaySessionId,
  validateRequest,
} from "./middleware.js";
import {
  insertManualPlaySessionSchema,
  isEditablePlaySession,
  mergePlaySessionsSchema,
  splitPlaySessionSchema,
  updatePlaySessionSchema,
  type GamePlaySession,
  type User,
} from "../shared/schema.js";
import { computePlayStats, isValidTimeZone } from "../shared/play-stats.js";

const router = Router();

const MINUTE_MS = 60_000;
/** A session never lasts longer than a day: a timer left running is cut off at this length. */
export const MAX_SESSION_MINUTES = 24 * 60;
/** Small allowance for a clock that runs slightly ahead of the server's. */
const FUTURE_SLACK_MS = 5 * MINUTE_MS;

/** True for a unique-index violation from SQLite or Postgres (Drizzle may wrap the driver error). */
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  return (
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    (error instanceof Error &&
      (/UNIQUE constraint failed/i.test(error.message) ||
        /duplicate key value violates unique constraint/i.test(error.message)))
  );
}

/** Longest gap between two sessions that still count as one sitting when merging. */
export const MAX_MERGE_GAP_MINUTES = 30;

/** Why a session from `start` to `end` is not acceptable, or `null` when it is. */
function sessionTimesError(start: Date, end: Date): string | null {
  const length = end.getTime() - start.getTime();
  if (Number.isNaN(length) || length < MINUTE_MS) {
    return "A play session must last at least one minute";
  }
  if (length > MAX_SESSION_MINUTES * MINUTE_MS) {
    return "A play session cannot last more than 24 hours";
  }
  if (end.getTime() > Date.now() + FUTURE_SLACK_MS) {
    return "A play session cannot end in the future";
  }
  return null;
}

/** Why a session cannot be edited, merged or split, or `undefined` when it can. */
function unchangeableReason(
  session: GamePlaySession
): { status: number; error: string } | undefined {
  if (session.endedAt === null) {
    return { status: 409, error: "Stop the timer before changing this session" };
  }
  if (!isEditablePlaySession(session)) {
    return { status: 409, error: "Imported or estimated sessions cannot be changed" };
  }
  return undefined;
}

/** Answers a failed edit, merge or split: 400 for invalid input, else a logged 500. */
function respondToFailure(res: Response, error: unknown, verb: string): Response {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid request", details: error.issues });
  }
  routesLogger.error({ error }, `Error trying to ${verb} play session`);
  return res.status(500).json({ error: `Failed to ${verb} play session` });
}

/** The user's session `sessionId` of this game, if it exists. */
async function findSession(
  sessionId: string,
  gameId: string,
  userId: string
): Promise<GamePlaySession | undefined> {
  return (await storage.getGamePlaySessions(gameId, userId)).find((s) => s.id === sessionId);
}

/** Verifies the game exists and belongs to the requesting user; returns 404 otherwise. */
async function requireOwnedGame(req: Request, res: Response): Promise<string | null> {
  const { id } = req.params as { id: string };
  const user = req.user as User;
  const game = await storage.getGame(id);
  if (!game || game.userId !== user.id) {
    res.status(404).json({ error: "Game not found" });
    return null;
  }
  return id;
}

router.get(
  "/api/games/:id/play-sessions",
  authenticateToken,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      return res.json(await storage.getGamePlaySessions(gameId, user.id));
    } catch (error) {
      routesLogger.error({ error }, "Error fetching play sessions");
      return res.status(500).json({ error: "Failed to fetch play sessions" });
    }
  }
);

/** A session entered by hand: `durationMinutes`, optionally when it started (default: just now). */
router.post(
  "/api/games/:id/play-sessions",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { startedAt, durationMinutes } = insertManualPlaySessionSchema.parse(req.body);

      const now = Date.now();
      const durationMs = durationMinutes * MINUTE_MS;
      const start = startedAt ?? new Date(now - durationMs);
      const end = new Date(start.getTime() + durationMs);
      if (end.getTime() > now + FUTURE_SLACK_MS) {
        return res.status(400).json({ error: "A play session cannot end in the future" });
      }

      const session = await storage.addGamePlaySession({
        gameId,
        userId: user.id,
        startedAt: start,
        endedAt: end,
        source: "manual",
      });
      return res.status(201).json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid play session", details: error.issues });
      }
      routesLogger.error({ error }, "Error adding play session");
      return res.status(500).json({ error: "Failed to add play session" });
    }
  }
);

/** Starts the timer. A user has at most one running timer, so a second start answers 409. */
router.post(
  "/api/games/:id/play-sessions/start",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;

      const running = await storage.getRunningPlaySession(user.id);
      if (running) {
        return res.status(409).json({ error: "A play timer is already running", session: running });
      }

      const session = await storage.addGamePlaySession({
        gameId,
        userId: user.id,
        startedAt: new Date(),
        endedAt: null,
        source: "timer",
      });
      return res.status(201).json(session);
    } catch (error) {
      // A concurrent start (double tap, two tabs) lost the race to the one-running-timer index.
      if (isUniqueViolation(error)) {
        const user = req.user as User;
        const running = await storage.getRunningPlaySession(user.id).catch(() => undefined);
        return res.status(409).json({ error: "A play timer is already running", session: running });
      }
      routesLogger.error({ error }, "Error starting play timer");
      return res.status(500).json({ error: "Failed to start the play timer" });
    }
  }
);

/**
 * Edits a finished manual or timer session: a new start, and a new end or duration. What is not
 * sent stays as it was (a new start alone keeps the length). Same limits as when adding one.
 */
router.patch(
  "/api/games/:id/play-sessions/:sessionId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizePlaySessionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { sessionId } = req.params as { sessionId: string };
      const body = updatePlaySessionSchema.parse(req.body);

      const current = await findSession(sessionId, gameId, user.id);
      if (!current) return res.status(404).json({ error: "Play session not found" });
      const blocked = unchangeableReason(current);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const start = body.startedAt ?? current.startedAt;
      const length = current.endedAt!.getTime() - current.startedAt.getTime();
      let end: Date;
      if (body.endedAt) end = body.endedAt;
      else if (body.durationMinutes)
        end = new Date(start.getTime() + body.durationMinutes * MINUTE_MS);
      else end = new Date(start.getTime() + length);

      const invalid = sessionTimesError(start, end);
      if (invalid) return res.status(400).json({ error: invalid });

      const updated = await storage.updateGamePlaySession(sessionId, gameId, user.id, {
        startedAt: start,
        endedAt: end,
      });
      if (!updated) return res.status(409).json({ error: "The play session changed, try again" });
      return res.json(updated);
    } catch (error) {
      return respondToFailure(res, error, "update");
    }
  }
);

/**
 * Merges finished manual or timer sessions of one game into one that runs from the earliest start
 * to the latest end. They must overlap or be at most `MAX_MERGE_GAP_MINUTES` apart, and the
 * result keeps the 24-hour limit. The merged session keeps their source when all share one.
 */
router.post(
  "/api/games/:id/play-sessions/merge",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { sessionIds } = mergePlaySessionsSchema.parse(req.body);
      const ids = Array.from(new Set(sessionIds));
      if (ids.length < 2) {
        return res.status(400).json({ error: "Choose at least two different sessions" });
      }

      const all = await storage.getGamePlaySessions(gameId, user.id);
      const chosen: GamePlaySession[] = [];
      for (const id of ids) {
        const session = all.find((s) => s.id === id);
        if (!session) return res.status(404).json({ error: "Play session not found" });
        const blocked = unchangeableReason(session);
        if (blocked) return res.status(blocked.status).json({ error: blocked.error });
        chosen.push(session);
      }

      chosen.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      let latestEnd = chosen[0]!.endedAt!.getTime();
      for (const session of chosen.slice(1)) {
        if (session.startedAt.getTime() - latestEnd > MAX_MERGE_GAP_MINUTES * MINUTE_MS) {
          return res.status(400).json({
            error: `Only sessions that overlap or are at most ${MAX_MERGE_GAP_MINUTES} minutes apart can be merged`,
          });
        }
        latestEnd = Math.max(latestEnd, session.endedAt!.getTime());
      }
      const start = chosen[0]!.startedAt;
      const end = new Date(latestEnd);
      const invalid = sessionTimesError(start, end);
      if (invalid) return res.status(400).json({ error: invalid });

      const sources = new Set(chosen.map((s) => s.source));
      const source = sources.size === 1 ? chosen[0]!.source : "manual";
      const merged = await storage.replaceGamePlaySessions(user.id, gameId, ids, [
        { startedAt: start, endedAt: end, source },
      ]);
      if (!merged) return res.status(409).json({ error: "The play sessions changed, try again" });
      return res.status(201).json(merged[0]);
    } catch (error) {
      return respondToFailure(res, error, "merge");
    }
  }
);

/** Cuts a finished manual or timer session in two at `splitAt` (each half lasts a minute or more). */
router.post(
  "/api/games/:id/play-sessions/:sessionId/split",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizePlaySessionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { sessionId } = req.params as { sessionId: string };
      const { splitAt } = splitPlaySessionSchema.parse(req.body);

      const current = await findSession(sessionId, gameId, user.id);
      if (!current) return res.status(404).json({ error: "Play session not found" });
      const blocked = unchangeableReason(current);
      if (blocked) return res.status(blocked.status).json({ error: blocked.error });
      const { startedAt, source } = current;
      const endedAt = current.endedAt!;
      if (
        splitAt.getTime() - startedAt.getTime() < MINUTE_MS ||
        endedAt.getTime() - splitAt.getTime() < MINUTE_MS
      ) {
        return res.status(400).json({
          error: "Split the session at least one minute after its start and before its end",
        });
      }

      const parts = await storage.replaceGamePlaySessions(
        user.id,
        gameId,
        [sessionId],
        [
          { startedAt, endedAt: splitAt, source },
          { startedAt: splitAt, endedAt, source },
        ]
      );
      if (!parts) return res.status(409).json({ error: "The play session changed, try again" });
      return res.status(201).json(parts);
    } catch (error) {
      return respondToFailure(res, error, "split");
    }
  }
);

router.delete(
  "/api/games/:id/play-sessions/:sessionId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizePlaySessionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { sessionId } = req.params as { sessionId: string };
      const deleted = await storage.deleteGamePlaySession(sessionId, gameId, user.id);
      if (!deleted) return res.status(404).json({ error: "Play session not found" });
      return res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "Error deleting play session");
      return res.status(500).json({ error: "Failed to delete play session" });
    }
  }
);

/** The user's running timer, or `{ session: null }`. */
router.get("/api/play-sessions/active", authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const session = await storage.getRunningPlaySession(user.id);
    return res.json({ session: session ?? null });
  } catch (error) {
    routesLogger.error({ error }, "Error fetching the running play timer");
    return res.status(500).json({ error: "Failed to fetch the play timer" });
  }
});

router.post(
  "/api/play-sessions/:sessionId/stop",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizePlaySessionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { sessionId } = req.params as { sessionId: string };

      const running = await storage.getRunningPlaySession(user.id);
      if (running?.id !== sessionId) {
        return res.status(404).json({ error: "No running play timer with that id" });
      }

      const now = Date.now();
      const longest = running.startedAt.getTime() + MAX_SESSION_MINUTES * MINUTE_MS;
      const capped = now > longest;
      const stopped = await storage.stopGamePlaySession(
        sessionId,
        user.id,
        new Date(capped ? longest : now)
      );
      if (!stopped) return res.status(404).json({ error: "No running play timer with that id" });
      return res.json({ session: stopped, capped });
    } catch (error) {
      routesLogger.error({ error }, "Error stopping play timer");
      return res.status(500).json({ error: "Failed to stop the play timer" });
    }
  }
);

/** True when `value` is a usable `getTimezoneOffset()` query value. */
function hasValidOffset(value: unknown): boolean {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) return false;
  const minutes = Number.parseInt(value, 10);
  return minutes >= -840 && minutes <= 840;
}

/**
 * Play-time analytics. Days follow the viewer's clock: `timeZone` (IANA name, DST-aware) wins over
 * `tz` (the browser's `getTimezoneOffset()`, kept for older clients).
 */
router.get(
  "/api/stats/play-time",
  authenticateToken,
  query("tz").optional().isInt({ min: -840, max: 840 }).withMessage("Invalid time zone offset"),
  query("timeZone")
    .optional()
    .isString()
    .isLength({ max: 64 })
    // A zone this runtime does not know is tolerated when a valid `tz` offset comes along.
    .custom((value: string, { req }) => isValidTimeZone(value) || hasValidOffset(req.query?.tz))
    .withMessage("Invalid time zone"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const offset = typeof req.query.tz === "string" ? Number.parseInt(req.query.tz, 10) : 0;
      const named = req.query.timeZone;
      const zone = typeof named === "string" && isValidTimeZone(named) ? named : offset;
      const [sessions, games] = await Promise.all([
        storage.getUserPlaySessions(user.id),
        storage.getUserGames(user.id, true),
      ]);
      return res.json(computePlayStats(sessions, games, new Date(), zone));
    } catch (error) {
      routesLogger.error({ error }, "Error computing play-time stats");
      return res.status(500).json({ error: "Failed to compute play-time stats" });
    }
  }
);

export const playSessionRoutes = router;
