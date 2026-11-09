import { Router, type Request, type Response } from "express";
import { body, param } from "express-validator";

import { z } from "zod";
import { storage } from "./storage.js";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import { validateRequest, sanitizeGameId } from "./middleware.js";
import {
  insertTagSchema,
  updateTagSchema,
  type User,
} from "../shared/schema.js";

const router = Router();
const logger = routesLogger;

// Validation middleware
const sanitizeTagIdParam = [
  param("tagId")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid tag ID format"),
];

const validateTagBody = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Tag name must be between 1 and 100 characters"),
  body("color")
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage("Color must be 20 characters or less"),
];

// For POST, both name and color validation
const validateCreateTagBody = [
  body("name")
    .trim()
    .notEmpty()
    .isLength({ min: 1, max: 100 })
    .withMessage("Tag name is required and must be between 1 and 100 characters"),
  body("color")
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage("Color must be 20 characters or less"),
];

// GET /api/tags - Get all tags for the current user
router.get("/api/tags", authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const tags = await storage.getTags(user.id);
    logger.info(`User ${user.id} fetched ${tags.length} tags`);
    return res.json(tags);
  } catch (error) {
    logger.error({ error }, "Failed to get tags");
    return res.status(500).json({ error: "Failed to get tags" });
  }
});

// GET /api/tags/:tagId - Get a specific tag
router.get(
  "/api/tags/:tagId",
  authenticateToken,
  ...sanitizeTagIdParam,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { tagId } = req.params as { tagId: string };
      const tag = await storage.getTag(tagId, user.id);

      if (!tag) {
        logger.warn(`User ${user.id} requested non-existent tag ${tagId}`);
        return res.status(404).json({ error: "Tag not found" });
      }

      logger.info(`User ${user.id} fetched tag ${tagId}`);
      return res.json(tag);
    } catch (error) {
      logger.error({ error }, "Failed to get tag");
      return res.status(500).json({ error: "Failed to get tag" });
    }
  }
);

// POST /api/tags - Create a new tag
router.post(
  "/api/tags",
  authenticateToken,
  ...validateCreateTagBody,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { name, color } = req.body as { name: string; color?: string };

      // Validate using Zod schema
      const validated = insertTagSchema.parse({ name, color });

      const tag = await storage.createTag({ userId: user.id, ...validated });
      logger.info(`User ${user.id} created tag ${tag.id}: ${tag.name}`);
      return res.status(201).json(tag);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn({ error }, "Tag creation validation failed");
        return res.status(400).json({ error: error.issues[0]?.message ?? "Validation failed" });
      }
      logger.error({ error }, "Failed to create tag");
      return res.status(500).json({ error: "Failed to create tag" });
    }
  }
);

// PATCH /api/tags/:tagId - Update a tag
router.patch(
  "/api/tags/:tagId",
  authenticateToken,
  ...sanitizeTagIdParam,
  ...validateTagBody,
  validateRequest,
  async (req: Request, res: Response) => {
    // For PATCH, at least one field (name or color) must be provided
    const { name, color } = req.body as { name?: string; color?: string };
    if (!name && !color) {
      return res.status(400).json({ error: "At least one field (name or color) must be provided" });
    }
    try {
      const user = req.user as User;
      const { tagId } = req.params as { tagId: string };

      // Validate using Zod schema
      const validated = updateTagSchema.parse({ name, color });

      const tag = await storage.updateTag(tagId, user.id, validated);

      if (!tag) {
        logger.warn(`User ${user.id} tried to update non-existent tag ${tagId}`);
        return res.status(404).json({ error: "Tag not found" });
      }

      logger.info(`User ${user.id} updated tag ${tagId}`);
      return res.json(tag);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn({ error }, "Tag update validation failed");
        return res.status(400).json({ error: error.issues[0]?.message ?? "Validation failed" });
      }
      logger.error({ error }, "Failed to update tag");
      return res.status(500).json({ error: "Failed to update tag" });
    }
  }
);

// DELETE /api/tags/:tagId - Delete a tag
router.delete(
  "/api/tags/:tagId",
  authenticateToken,
  ...sanitizeTagIdParam,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { tagId } = req.params as { tagId: string };

      const deleted = await storage.deleteTag(tagId, user.id);

      if (!deleted) {
        logger.warn(`User ${user.id} tried to delete non-existent tag ${tagId}`);
        return res.status(404).json({ error: "Tag not found" });
      }

      logger.info(`User ${user.id} deleted tag ${tagId}`);
      return res.json({ success: true });
    } catch (error) {
      logger.error({ error }, "Failed to delete tag");
      return res.status(500).json({ error: "Failed to delete tag" });
    }
  }
);

// GET /api/games/:gameId/tags - Get all tags for a specific game
router.get(
  "/api/games/:gameId/tags",
  authenticateToken,
  ...sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { gameId } = req.params as { gameId: string };

      // Verify the game exists and belongs to the user
      const game = await storage.getGame(gameId);
      if (game?.userId !== user.id) {
        return res.status(404).json({ error: "Game not found" });
      }

      const gameTags = await storage.getGameTags(gameId);

      // Get full tag details for each tag ID
      const tagIds = gameTags.map((gt) => gt.tagId);
      const tags = tagIds.length > 0
        ? await storage.getTagsByIds(tagIds)
        : [];

      const tagsMap = new Map(tags.map((tag) => [tag.id, tag]));
      const result = gameTags.map((gt) => ({
        ...gt,
        tag: tagsMap.get(gt.tagId),
      }));

      logger.info(`User ${user.id} fetched ${result.length} tags for game ${gameId}`);
      return res.json(result);
    } catch (error) {
      logger.error({ error }, "Failed to get game tags");
      return res.status(500).json({ error: "Failed to get game tags" });
    }
  }
);

// POST /api/games/:gameId/tags - Add a tag to a game
router.post(
  "/api/games/:gameId/tags",
  authenticateToken,
  ...sanitizeGameId,
  body("tagId")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid tag ID format"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { gameId } = req.params as { gameId: string };
      const { tagId } = req.body as { tagId: string };

      // Verify the game exists and belongs to the user
      const game = await storage.getGame(gameId);
      if (game?.userId !== user.id) {
        return res.status(404).json({ error: "Game not found" });
      }

      // Verify the tag exists and belongs to the user
      const tag = await storage.getTag(tagId, user.id);
      if (!tag) {
        logger.warn(`User ${user.id} tried to add non-existent tag ${tagId} to game ${gameId}`);
        return res.status(404).json({ error: "Tag not found" });
      }

      // Check if the tag is already on the game
      const existing = await storage.getGameTags(gameId);
      if (existing.some((gt) => gt.tagId === tagId)) {
        logger.warn(`User ${user.id} tried to add duplicate tag ${tagId} to game ${gameId}`);
        return res.status(409).json({ error: "Tag already added to this game" });
      }

      const gameTag = await storage.addTagToGame({ gameId, tagId });
      logger.info(`User ${user.id} added tag ${tagId} to game ${gameId}`);
      return res.status(201).json(gameTag);
    } catch (error) {
      logger.error({ error }, "Failed to add tag to game");
      return res.status(500).json({ error: "Failed to add tag to game" });
    }
  }
);

// DELETE /api/games/:gameId/tags/:tagId - Remove a tag from a game
router.delete(
  "/api/games/:gameId/tags/:tagId",
  authenticateToken,
  ...sanitizeGameId,
  ...sanitizeTagIdParam,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { gameId, tagId } = req.params as { gameId: string; tagId: string };

      // Verify the tag belongs to the user
      const tag = await storage.getTag(tagId, user.id);
      if (!tag) {
        logger.warn(`User ${user.id} tried to remove non-existent tag ${tagId} from game ${gameId}`);
        return res.status(404).json({ error: "Tag not found" });
      }

      const removed = await storage.removeTagFromGame(gameId, tagId);

      if (!removed) {
        logger.warn(`User ${user.id} tried to remove non-existent tag ${tagId} from game ${gameId}`);
        return res.status(404).json({ error: "Tag not found on this game" });
      }

      logger.info(`User ${user.id} removed tag ${tagId} from game ${gameId}`);
      return res.json({ success: true });
    } catch (error) {
      logger.error({ error }, "Failed to remove tag from game");
      return res.status(500).json({ error: "Failed to remove tag from game" });
    }
  }
);

// GET /api/tags/:tagId/games - Get all games with a specific tag
router.get(
  "/api/tags/:tagId/games",
  authenticateToken,
  ...sanitizeTagIdParam,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { tagId } = req.params as { tagId: string };

      // Verify the tag exists and belongs to the user
      const tag = await storage.getTag(tagId, user.id);
      if (!tag) {
        logger.warn(`User ${user.id} requested games for non-existent tag ${tagId}`);
        return res.status(404).json({ error: "Tag not found" });
      }

      const gameIds = await storage.getGamesByTag(tagId, user.id);

      // Get full game details
      const games = gameIds.length > 0
        ? await storage.getGamesByIds(gameIds)
        : [];

      logger.info(`User ${user.id} fetched ${games.length} games for tag ${tagId}`);
      return res.json(games);
    } catch (error) {
      logger.error({ error }, "Failed to get games by tag");
      return res.status(500).json({ error: "Failed to get games by tag" });
    }
  }
);

export default router;
