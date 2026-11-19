import { Router, type Request, type Response } from "express";
import { query } from "express-validator";
import { storage } from "./storage.js";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import { validateRequest } from "./middleware.js";
import type { User } from "../shared/schema.js";
import { computeBacklogBurndown } from "../shared/backlog-burndown.js";
import { isValidTimeZone } from "../shared/play-stats.js";

const router = Router();

/** True when `value` is a usable `getTimezoneOffset()` query value. */
function hasValidOffset(value: unknown): boolean {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) return false;
  const minutes = Number.parseInt(value, 10);
  return minutes >= -840 && minutes <= 840;
}

/**
 * Backlog burn-down: owned and playing games over the last 12 weeks and months, the hours still to
 * play and when the backlog runs out at the current pace. Days follow the viewer's clock, with the
 * same `timeZone` (IANA name) and `tz` (`getTimezoneOffset()`) parameters as the play-time stats.
 */
router.get(
  "/api/stats/backlog",
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
      const [events, sessions, games] = await Promise.all([
        storage.getUserGameStatusEvents(user.id),
        storage.getUserPlaySessions(user.id),
        storage.getUserGames(user.id, true),
      ]);
      return res.json(
        computeBacklogBurndown(
          games,
          events.map((e) => ({ gameId: e.gameId, status: e.status, at: e.createdAt })),
          sessions,
          new Date(),
          zone
        )
      );
    } catch (error) {
      routesLogger.error({ error }, "Error computing the backlog burn-down");
      return res.status(500).json({ error: "Failed to compute the backlog burn-down" });
    }
  }
);

export const backlogRoutes = router;
