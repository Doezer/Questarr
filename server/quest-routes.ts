import { Router, type Request, type Response } from "express";
import { query } from "express-validator";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import { validateRequest } from "./middleware.js";
import { isValidTimeZone } from "../shared/play-stats.js";
import type { User } from "../shared/schema.js";
import { syncQuests } from "./quest-service.js";

const router = Router();

/** True when `value` is a usable `getTimezoneOffset()` query value. */
function hasValidOffset(value: unknown): boolean {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) return false;
  const minutes = Number.parseInt(value, 10);
  return minutes >= -840 && minutes <= 840;
}

/**
 * Backlog quests of the current week and month, with the past ones, the medals and the month's
 * backlog progress. Opening this makes sure the period has its quests and updates their progress.
 * Days follow the viewer's clock (`timeZone` IANA name, `tz` = `getTimezoneOffset()`).
 */
router.get(
  "/api/quests",
  authenticateToken,
  query("tz").optional().isInt({ min: -840, max: 840 }).withMessage("Invalid time zone offset"),
  query("timeZone")
    .optional()
    .isString()
    .isLength({ max: 64 })
    .custom((value: string, { req }) => isValidTimeZone(value) || hasValidOffset(req.query?.tz))
    .withMessage("Invalid time zone"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const offset = typeof req.query.tz === "string" ? Number.parseInt(req.query.tz, 10) : 0;
      const named = req.query.timeZone;
      const zone = typeof named === "string" && isValidTimeZone(named) ? named : offset;
      return res.json(await syncQuests(user.id, zone));
    } catch (error) {
      routesLogger.error({ error }, "Error computing the backlog quests");
      return res.status(500).json({ error: "Failed to load the backlog quests" });
    }
  }
);

export const questRoutes = router;
