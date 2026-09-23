import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { storage } from "./storage.js";
import { authenticateToken } from "./auth.js";
import { configLoader } from "./config-loader.js";
import { routesLogger } from "./logger.js";
import { sensitiveEndpointLimiter } from "./middleware.js";
import {
  sanitizeGameId,
  sanitizeJournalEntryId,
  sanitizeMilestoneId,
  sanitizeScreenshotId,
  validateRequest,
} from "./middleware.js";
import {
  insertGameJournalEntrySchema,
  insertGameMilestoneSchema,
  updateGameMilestoneSchema,
  updateGameScreenshotSchema,
  type User,
} from "@shared/schema";

const router = Router();

const SCREENSHOT_DIR = () => path.join(configLoader.getConfigDir(), "screenshots");
const ALLOWED_SCREENSHOT_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (Object.hasOwn(ALLOWED_SCREENSHOT_MIME_TYPES, file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
  },
});

/** Verifies the game exists and belongs to the requesting user; returns 404 otherwise. */
async function requireOwnedGame(req: Request, res: Response): Promise<string | null> {
  const { id } = req.params;
  const user = req.user as User;
  const game = await storage.getGame(id);
  if (!game || game.userId !== user.id) {
    res.status(404).json({ error: "Game not found" });
    return null;
  }
  return id;
}

// ─── Journal entries (local-only notes) ─────────────────────────────────────

router.get(
  "/api/games/:id/journal",
  authenticateToken,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const entries = await storage.getGameJournalEntries(gameId, user.id);
      return res.json(entries);
    } catch (error) {
      routesLogger.error({ error }, "Error fetching journal entries");
      return res.status(500).json({ error: "Failed to fetch journal entries" });
    }
  }
);

router.post(
  "/api/games/:id/journal",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { note } = insertGameJournalEntrySchema.pick({ note: true }).parse(req.body);

      const entry = await storage.addGameJournalEntry({ gameId, userId: user.id, note });
      return res.status(201).json(entry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid journal entry", details: error.issues });
      }
      routesLogger.error({ error }, "Error adding journal entry");
      return res.status(500).json({ error: "Failed to add journal entry" });
    }
  }
);

router.delete(
  "/api/games/:id/journal/:entryId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizeJournalEntryId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const deleted = await storage.deleteGameJournalEntry(req.params.entryId, user.id);
      if (!deleted) return res.status(404).json({ error: "Journal entry not found" });
      return res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "Error deleting journal entry");
      return res.status(500).json({ error: "Failed to delete journal entry" });
    }
  }
);

// ─── Milestones (manual "successes" checklist) ──────────────────────────────

router.get(
  "/api/games/:id/milestones",
  authenticateToken,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const milestones = await storage.getGameMilestones(gameId, user.id);
      return res.json(milestones);
    } catch (error) {
      routesLogger.error({ error }, "Error fetching milestones");
      return res.status(500).json({ error: "Failed to fetch milestones" });
    }
  }
);

router.post(
  "/api/games/:id/milestones",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { label } = insertGameMilestoneSchema.pick({ label: true }).parse(req.body);

      const milestone = await storage.addGameMilestone({ gameId, userId: user.id, label });
      return res.status(201).json(milestone);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid milestone", details: error.issues });
      }
      routesLogger.error({ error }, "Error adding milestone");
      return res.status(500).json({ error: "Failed to add milestone" });
    }
  }
);

router.patch(
  "/api/games/:id/milestones/:milestoneId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizeMilestoneId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { completed } = updateGameMilestoneSchema.parse(req.body);

      const updated = await storage.updateGameMilestone(req.params.milestoneId, user.id, completed);
      if (!updated) return res.status(404).json({ error: "Milestone not found" });
      return res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid milestone update", details: error.issues });
      }
      routesLogger.error({ error }, "Error updating milestone");
      return res.status(500).json({ error: "Failed to update milestone" });
    }
  }
);

router.delete(
  "/api/games/:id/milestones/:milestoneId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizeMilestoneId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const deleted = await storage.deleteGameMilestone(req.params.milestoneId, user.id);
      if (!deleted) return res.status(404).json({ error: "Milestone not found" });
      return res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "Error deleting milestone");
      return res.status(500).json({ error: "Failed to delete milestone" });
    }
  }
);

// ─── Screenshots ─────────────────────────────────────────────────────────────

router.get(
  "/api/games/:id/screenshots",
  authenticateToken,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const screenshots = await storage.getGameScreenshots(gameId, user.id);
      return res.json(
        screenshots.map((s) => ({
          ...s,
          url: `/api/games/${gameId}/screenshots/${s.id}/file`,
        }))
      );
    } catch (error) {
      routesLogger.error({ error }, "Error fetching screenshots");
      return res.status(500).json({ error: "Failed to fetch screenshots" });
    }
  }
);

router.post(
  "/api/games/:id/screenshots",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  validateRequest,
  screenshotUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;

      if (!req.file) {
        return res.status(400).json({ error: "A screenshot file is required" });
      }
      const caption =
        typeof req.body.caption === "string" ? req.body.caption.trim().slice(0, 300) || null : null;

      const dir = path.join(SCREENSHOT_DIR(), gameId);
      await fs.promises.mkdir(dir, { recursive: true });

      const extension = ALLOWED_SCREENSHOT_MIME_TYPES[req.file.mimetype];
      const fileName = `${randomUUID()}${extension}`;
      const filePath = path.join(dir, fileName);
      await fs.promises.writeFile(filePath, req.file.buffer);

      const screenshot = await storage.addGameScreenshot({
        gameId,
        userId: user.id,
        filePath,
        caption,
      });

      return res.status(201).json({
        ...screenshot,
        url: `/api/games/${gameId}/screenshots/${screenshot.id}/file`,
      });
    } catch (error) {
      routesLogger.error({ error }, "Error uploading screenshot");
      return res.status(500).json({ error: "Failed to upload screenshot" });
    }
  }
);

router.get(
  "/api/games/:id/screenshots/:screenshotId/file",
  authenticateToken,
  sanitizeGameId,
  sanitizeScreenshotId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;

      const screenshots = await storage.getGameScreenshots(gameId, user.id);
      const screenshot = screenshots.find((s) => s.id === req.params.screenshotId);
      if (!screenshot) return res.status(404).json({ error: "Screenshot not found" });

      return res.sendFile(path.resolve(screenshot.filePath), (error) => {
        if (error) {
          routesLogger.error({ error }, "Error sending screenshot file");
          if (!res.headersSent) res.status(404).json({ error: "Screenshot file not found" });
        }
      });
    } catch (error) {
      routesLogger.error({ error }, "Error fetching screenshot file");
      return res.status(500).json({ error: "Failed to fetch screenshot" });
    }
  }
);

router.patch(
  "/api/games/:id/screenshots/:screenshotId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizeScreenshotId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const { caption } = updateGameScreenshotSchema.parse(req.body);

      const updated = await storage.updateGameScreenshotCaption(
        req.params.screenshotId,
        user.id,
        caption
      );
      if (!updated) return res.status(404).json({ error: "Screenshot not found" });
      return res.json({ ...updated, url: `/api/games/${gameId}/screenshots/${updated.id}/file` });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid caption", details: error.issues });
      }
      routesLogger.error({ error }, "Error updating screenshot caption");
      return res.status(500).json({ error: "Failed to update screenshot" });
    }
  }
);

router.delete(
  "/api/games/:id/screenshots/:screenshotId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeGameId,
  sanitizeScreenshotId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const gameId = await requireOwnedGame(req, res);
      if (!gameId) return;
      const user = req.user as User;
      const deleted = await storage.deleteGameScreenshot(req.params.screenshotId, user.id);
      if (!deleted) return res.status(404).json({ error: "Screenshot not found" });

      await fs.promises.unlink(deleted.filePath).catch((error) => {
        routesLogger.warn(
          { error, filePath: deleted.filePath },
          "Failed to delete screenshot file"
        );
      });

      return res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "Error deleting screenshot");
      return res.status(500).json({ error: "Failed to delete screenshot" });
    }
  }
);

export const gameJournalRoutes = router;
