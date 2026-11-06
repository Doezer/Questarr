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
import { insertManualPlaySessionSchema, type User } from "../shared/schema.js";
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
    .custom((value: string) => isValidTimeZone(value))
    .withMessage("Invalid time zone"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const offset = typeof req.query.tz === "string" ? Number.parseInt(req.query.tz, 10) : 0;
      const zone = typeof req.query.timeZone === "string" ? req.query.timeZone : offset;
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
