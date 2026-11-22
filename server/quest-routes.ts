import { Router, type Request, type Response } from "express";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import { validateRequest } from "./middleware.js";
import { zoneFromQuery, zoneQueryValidators } from "./stats-zone.js";
import type { User } from "../shared/schema.js";
import { syncQuests } from "./quest-service.js";

const router = Router();

/**
 * Backlog quests of the current week and month, with the past ones, the medals and the month's
 * backlog progress. Opening this makes sure the period has its quests and updates their progress.
 * Days follow the viewer's clock (`timeZone` IANA name, `tz` = `getTimezoneOffset()`).
 */
router.get(
  "/api/quests",
  authenticateToken,
  ...zoneQueryValidators,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const zone = zoneFromQuery(req);
      return res.json(await syncQuests(user.id, zone));
    } catch (error) {
      routesLogger.error({ error }, "Error computing the backlog quests");
      return res.status(500).json({ error: "Failed to load the backlog quests" });
    }
  }
);

export const questRoutes = router;
