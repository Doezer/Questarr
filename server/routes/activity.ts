import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage.js";
import { routesLogger as logger } from "../logger.js";
import { DOWNLOAD_EVENT_TYPES } from "../../shared/schema.js";

export const activityRouter = Router();

activityRouter.use((req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.locals.userId = req.user.id;
  return next();
});

const historyQuerySchema = z.object({
  eventType: z.enum(DOWNLOAD_EVENT_TYPES).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /api/activity/history?eventType=&limit=&offset= - what happened to downloads, newest first
activityRouter.get("/history", async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }
  try {
    const { eventType, search, limit, offset } = parsed.data;
    const result = await storage.getDownloadEvents(res.locals.userId as string, {
      ...(eventType ? { eventType } : {}),
      ...(search ? { search } : {}),
      limit,
      offset,
    });
    return res.json(result);
  } catch (error) {
    logger.error({ error }, "error listing download history");
    return res.status(500).json({ error: "Failed to load history" });
  }
});

// DELETE /api/activity/blocklist - unblock every release of the user's games in one go
activityRouter.delete("/blocklist", async (_req, res) => {
  try {
    const removed = await storage.removeAllReleaseBlacklists(res.locals.userId as string);
    return res.json({ removed });
  } catch (error) {
    logger.error({ error }, "error clearing the blocklist");
    return res.status(500).json({ error: "Failed to clear the blocklist" });
  }
});
