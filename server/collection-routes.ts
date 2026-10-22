import { Router, type Request, type Response } from "express";
import { param } from "express-validator";
import { z } from "zod";
import { storage } from "./storage.js";
import { authenticateToken } from "./auth.js";
import { routesLogger } from "./logger.js";
import { sanitizeCollectionId, sensitiveEndpointLimiter, validateRequest } from "./middleware.js";
import { getContentFilterFlags, excludeFilteredContent } from "./content-filter.js";
import {
  gameMatchesCollectionRules,
  hasReversedYearRange,
  isEmptyCollectionRules,
} from "../shared/collection-rules.js";
import {
  addCollectionGameSchema,
  insertCollectionSchema,
  updateCollectionSchema,
  type Collection,
  type Game,
  type User,
} from "../shared/schema.js";

const router = Router();

const COVER_PREVIEW_COUNT = 4;

const sanitizeCollectionGameId = [
  param("gameId")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid game ID format"),
];

/** Games of a collection: explicit links for a manual one, rule matches for a smart one.
 * Hidden games are excluded, as everywhere else in the library. */
function gamesOfCollection(
  collection: Collection,
  libraryGames: Game[],
  linkedGameIds: ReadonlySet<string>
): Game[] {
  if (collection.type === "smart") {
    const rules = collection.rules ?? {};
    return libraryGames.filter((game) => gameMatchesCollectionRules(game, rules));
  }
  return libraryGames.filter((game) => linkedGameIds.has(game.id));
}

/** The user's visible library: hidden games and content hidden by their filter settings are left out. */
async function loadLibraryGames(userId: string): Promise<Game[]> {
  const [games, flags] = await Promise.all([
    storage.getUserGames(userId),
    getContentFilterFlags(userId),
  ]);
  return excludeFilteredContent(games, flags);
}

async function loadOwnedCollection(req: Request, res: Response): Promise<Collection | null> {
  const user = req.user as User;
  const { collectionId } = req.params as { collectionId: string };
  const collection = await storage.getCollection(collectionId, user.id);
  if (!collection) {
    res.status(404).json({ error: "Collection not found" });
    return null;
  }
  return collection;
}

router.get("/api/collections", authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const [collections, links, libraryGames] = await Promise.all([
      storage.getCollections(user.id),
      storage.getCollectionLinks(user.id),
      loadLibraryGames(user.id),
    ]);

    const linkedByCollection = new Map<string, Set<string>>();
    for (const { collectionId, gameId } of links) {
      const set = linkedByCollection.get(collectionId) ?? new Set<string>();
      set.add(gameId);
      linkedByCollection.set(collectionId, set);
    }

    return res.json(
      collections.map((collection) => {
        const games = gamesOfCollection(
          collection,
          libraryGames,
          linkedByCollection.get(collection.id) ?? new Set()
        );
        return {
          ...collection,
          gameCount: games.length,
          coverUrls: games
            .map((game) => game.coverUrl)
            .filter((url): url is string => !!url)
            .slice(0, COVER_PREVIEW_COUNT),
        };
      })
    );
  } catch (error) {
    routesLogger.error({ error }, "Error fetching collections");
    return res.status(500).json({ error: "Failed to fetch collections" });
  }
});

router.get(
  "/api/collections/:collectionId",
  authenticateToken,
  sanitizeCollectionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const collection = await loadOwnedCollection(req, res);
      if (!collection) return;
      const user = req.user as User;
      const [links, libraryGames] = await Promise.all([
        storage.getCollectionLinks(user.id),
        loadLibraryGames(user.id),
      ]);
      const linked = new Set(
        links.filter((l) => l.collectionId === collection.id).map((l) => l.gameId)
      );
      return res.json({
        ...collection,
        games: gamesOfCollection(collection, libraryGames, linked),
      });
    } catch (error) {
      routesLogger.error({ error }, "Error fetching collection");
      return res.status(500).json({ error: "Failed to fetch collection" });
    }
  }
);

router.post(
  "/api/collections",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const data = insertCollectionSchema.parse(req.body);
      const collection = await storage.createCollection({
        userId: user.id,
        name: data.name,
        description: data.description,
        type: data.type,
        rules: data.rules,
      });
      return res.status(201).json(collection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid collection", details: error.issues });
      }
      routesLogger.error({ error }, "Error creating collection");
      return res.status(500).json({ error: "Failed to create collection" });
    }
  }
);

router.patch(
  "/api/collections/:collectionId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeCollectionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const existing = await loadOwnedCollection(req, res);
      if (!existing) return;
      const user = req.user as User;
      const patch = updateCollectionSchema.parse(req.body);

      // The effective type/rules after the patch must still form a valid collection.
      const type = patch.type ?? (existing.type as "manual" | "smart");
      const rules = patch.rules === undefined ? existing.rules : patch.rules;
      if (type === "smart" && isEmptyCollectionRules(rules)) {
        return res.status(400).json({ error: "A smart collection needs at least one rule" });
      }

      if (type === "smart" && hasReversedYearRange(rules)) {
        return res.status(400).json({ error: "releaseYearTo must not be before releaseYearFrom" });
      }

      const updated = await storage.updateCollection(existing.id, user.id, {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        type,
        rules: type === "smart" ? (rules ?? null) : null,
      });
      if (!updated) return res.status(404).json({ error: "Collection not found" });
      return res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid collection", details: error.issues });
      }
      routesLogger.error({ error }, "Error updating collection");
      return res.status(500).json({ error: "Failed to update collection" });
    }
  }
);

router.delete(
  "/api/collections/:collectionId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeCollectionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user as User;
      const { collectionId } = req.params as { collectionId: string };
      const deleted = await storage.deleteCollection(collectionId, user.id);
      if (!deleted) return res.status(404).json({ error: "Collection not found" });
      return res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "Error deleting collection");
      return res.status(500).json({ error: "Failed to delete collection" });
    }
  }
);

router.post(
  "/api/collections/:collectionId/games",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeCollectionId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const collection = await loadOwnedCollection(req, res);
      if (!collection) return;
      if (collection.type !== "manual") {
        return res.status(400).json({ error: "Games can only be added to manual collections" });
      }
      const user = req.user as User;
      const { gameId } = addCollectionGameSchema.parse(req.body);
      const game = await storage.getGame(gameId);
      if (!game || game.userId !== user.id) {
        return res.status(404).json({ error: "Game not found" });
      }
      const added = await storage.addGameToCollection(collection.id, gameId);
      if (!added) return res.status(409).json({ error: "Game is already in this collection" });
      return res.status(201).json({ collectionId: collection.id, gameId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request", details: error.issues });
      }
      routesLogger.error({ error }, "Error adding game to collection");
      return res.status(500).json({ error: "Failed to add game to collection" });
    }
  }
);

router.delete(
  "/api/collections/:collectionId/games/:gameId",
  authenticateToken,
  sensitiveEndpointLimiter,
  sanitizeCollectionId,
  sanitizeCollectionGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const collection = await loadOwnedCollection(req, res);
      if (!collection) return;
      const { gameId } = req.params as { gameId: string };
      const removed = await storage.removeGameFromCollection(collection.id, gameId);
      if (!removed) return res.status(404).json({ error: "Game is not in this collection" });
      return res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "Error removing game from collection");
      return res.status(500).json({ error: "Failed to remove game from collection" });
    }
  }
);

export const collectionRoutes = router;
