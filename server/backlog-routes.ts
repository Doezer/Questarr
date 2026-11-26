import { Router, type Request, type Response } from "express";
import { storage } from "./storage.js";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import { validateRequest } from "./middleware.js";
import type { User } from "../shared/schema.js";
import { computeBacklogBurndown } from "../shared/backlog-burndown.js";
import { zoneFromQuery, zoneQueryValidators } from "./stats-zone.js";

const router = Router();

/**
 * Backlog burn-down: owned and playing games over the last 12 weeks and months, the hours still to
 * play and when the backlog runs out at the current pace. Days follow the viewer's clock, with the
 * same `timeZone` (IANA name) and `tz` (`getTimezoneOffset()`) parameters as the play-time stats.
 */
router.get(
  "/api/stats/backlog",
  authenticateToken,
  ...zoneQueryValidators,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const zone = zoneFromQuery(req);
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
