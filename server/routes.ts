import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { pool } from "./db.js";
import {
  insertGameSchema,
  updateGameStatusSchema,
  updateGameHiddenSchema,
  insertIndexerSchema,
  insertDownloaderSchema,
  insertNotificationSchema,
  updateUserSettingsSchema,
  type Config,
  type Indexer,
  type Downloader,
} from "../shared/schema.js";
import { torznabClient } from "./torznab.js";
import { DownloaderManager } from "./downloaders.js";
import { z } from "zod";
import { routesLogger } from "./logger.js";
import {
  igdbRateLimiter,
  sensitiveEndpointLimiter,
  validateRequest,
  sanitizeSearchQuery,
  sanitizeGameId,
  sanitizeIgdbId,
  sanitizeGameStatus,
  sanitizeGameData,
  sanitizeIndexerData,
  sanitizeIndexerUpdateData,
  sanitizeDownloaderData,
  sanitizeDownloaderUpdateData,
  sanitizeDownloadData,
  sanitizeIndexerSearchQuery,
} from "./middleware.js";
import { config as appConfig } from "./config.js";
import { prowlarrClient } from "./prowlarr.js";
import { isSafeUrl } from "./ssrf.js";
import { hashPassword, comparePassword, generateToken, authenticateToken } from "./auth.js";
import { searchAllIndexers } from "./search.js";
import archiver from "archiver";

// ⚡ Bolt: Simple in-memory cache implementation to avoid external dependencies
// Caches storage info for 30 seconds to prevent spamming downloaders
const storageCache = {
  data: null as any,
  expiry: 0,
  ttl: 30 * 1000, // 30 seconds in milliseconds
};

// Helper to parse category query param which might be string, array, or comma-separated
export function parseCategories(input: unknown): string[] | undefined {
  if (!input) return undefined;

  // If array, flatten and filter
  if (Array.isArray(input)) {
    return input.map(String).filter((c) => c.trim().length > 0);
  }

  // If string, split by comma
  if (typeof input === "string") {
    return input
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  return undefined;
}

// Helper function for aggregated indexer search
async function handleAggregatedIndexerSearch(req: Request, res: Response) {
  try {
    const { query, category, cat } = req.query;
    // Use validated values from middleware (already converted to integers by .toInt())
    const limit = (req.query.limit as unknown as number) || 50;
    const offset = (req.query.offset as unknown as number) || 0;

    const categories = parseCategories(category || cat);

    routesLogger.info(
      { query, categories, limit, offset },
      "Handling aggregated indexer search request"
    );

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Search query required" });
    }

    const { items, total, errors } = await searchAllIndexers({
      query: query.trim(),
      category: categories,
      limit,
      offset,
    });

    res.json({
      items,
      total,
      offset,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error searching indexers:", error);
    res.status(500).json({ error: "Failed to search indexers" });
  }
}

/**
 * Validates and sanitizes pagination parameters from query string.
 * @param query - The query parameters object
 * @returns Validated limit and offset values
 */
function validatePaginationParams(query: { limit?: string; offset?: string }): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(Math.max(1, parseInt(query.limit as string) || 20), 100);
  const offset = Math.max(0, parseInt(query.offset as string) || 0);
  return { limit, offset };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth Routes
  app.get("/api/auth/status", async (_req, res) => {
    try {
      const userCount = await storage.countUsers();
      res.json({ hasUsers: userCount > 0 });
    } catch (error) {
      routesLogger.error({ error }, "Failed to check setup status");
      res.status(500).json({ error: "Failed to check setup status" });
    }
  });

  app.post("/api/auth/setup", async (req, res) => {
    try {
      // Check if setup already completed
      const userCount = await storage.countUsers();
      if (userCount > 0) {
        return res.status(403).json({ error: "Setup already completed" });
      }

      const { username, password, igdbClientId, igdbClientSecret } = req.body;

      // Validate input
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      if (typeof username !== "string" || typeof password !== "string") {
        return res.status(400).json({ error: "Username and password must be strings" });
      }

      if (username.length < 3) {
        return res.status(400).json({ error: "Username must be at least 3 characters" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      if (username.length > 50) {
        return res.status(400).json({ error: "Username must be at most 50 characters" });
      }

      // Create first user
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({ username, passwordHash });
      const token = await generateToken(user);

      // Save IGDB creds if provided
      if (igdbClientId && igdbClientSecret) {
        if (
          typeof igdbClientId === "string" &&
          typeof igdbClientSecret === "string" &&
          igdbClientId.trim().length > 0 &&
          igdbClientSecret.trim().length > 0
        ) {
          await storage.setSystemConfig("igdb.clientId", igdbClientId.trim());
          await storage.setSystemConfig("igdb.clientSecret", igdbClientSecret.trim());
          routesLogger.info("IGDB credentials saved during setup");
        }
      }

      routesLogger.info({ username }, "Initial setup completed");
      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      routesLogger.error({ error }, "Setup failed");
      res.status(500).json({ error: "Setup failed. Please try again." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await storage.getUserByUsername(username);

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Auto-migrate orphan games to this user on login
    // This handles the transition from single-user to multi-user
    await storage.assignOrphanGamesToUser(user.id);

    const token = await generateToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  });

  app.get("/api/auth/me", authenticateToken, (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user;
    res.json({ id: user.id, username: user.username });
  });

  // Health check endpoint
  app.get("/api/health", async (req, res) => {
    // 🛡️ Sentinel: Harden health check endpoint.
    // This liveness probe only confirms the server is responsive.
    // For readiness checks (e.g., database connectivity), use the /api/ready endpoint.
    res.status(200).json({ status: "ok" });
  });

  // Protect all API routes from here
  app.use("/api", (req, res, next) => {
    // Skip authentication for specific public endpoints that were already defined or need to be excluded
    // Note: Auth routes are defined before this middleware, so they are already skipped.
    // We explicitly skip health check if it matched /api/health (it was defined before, so express handles it first? Yes.)

    // Just applying authenticateToken middleware
    authenticateToken(req, res, next);
  });

  // Sync indexers from Prowlarr
  app.post("/api/indexers/prowlarr/sync", sensitiveEndpointLimiter, async (req, res) => {
    try {
      const { url, apiKey } = req.body;

      if (!url || !apiKey) {
        return res.status(400).json({ error: "URL and API Key are required" });
      }

      const indexers = await prowlarrClient.getIndexers(url, apiKey);

      const results = {
        added: 0,
        updated: 0,
        failed: 0,
        errors: [] as string[],
      };

      const existingIndexers = await storage.getAllIndexers();

      for (const idx of indexers) {
        try {
          // Check for existing indexer with same URL (exact match)
          const existing = existingIndexers.find((e) => e.url === idx.url);

          if (existing) {
            // Update existing
            await storage.updateIndexer(existing.id, idx);
            results.updated++;
          } else {
            // Create new
            if (!idx.name || !idx.url || !idx.apiKey) {
              results.failed++;
              results.errors.push(`Skipping ${idx.name || "unknown"} - missing required fields`);
              continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await storage.addIndexer(idx as any);
            results.added++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push(
            `Failed to sync ${idx.name}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }

      res.json({
        success: true,
        message: `Synced indexers from Prowlarr: ${results.added} added, ${results.updated} updated`,
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      routesLogger.error({ error }, "Failed to sync from Prowlarr");
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/ready", async (req, res) => {
    let isHealthy = true;

    // Check database connectivity
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      routesLogger.error({ error }, "database health check failed");
      isHealthy = false;
    }

    // Check IGDB API connectivity
    try {
      // Try to get popular games with a minimal limit to test connectivity
      await igdbClient.getPopularGames(1);
    } catch (error) {
      routesLogger.error({ error }, "igdb health check failed");
      isHealthy = false;
    }

    if (isHealthy) {
      res.status(200).json({ status: "ok" });
    } else {
      res.status(503).json({ status: "error" });
    }
  });

  // Game collection routes

  // Get all games in collection
  app.get("/api/games", authenticateToken, async (req, res) => {
    try {
      const { search, includeHidden } = req.query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user.id;
      const showHidden = includeHidden === "true";

      let games;
      if (search && typeof search === "string" && search.trim()) {
        games = await storage.searchUserGames(userId, search.trim(), showHidden);
      } else {
        games = await storage.getUserGames(userId, showHidden);
      }

      res.json(games);
    } catch (error) {
      routesLogger.error({ error }, "error fetching games");
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  // Get games by status
  app.get("/api/games/status/:status", authenticateToken, async (req, res) => {
    try {
      const { status } = req.params;
      const { includeHidden } = req.query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user.id;
      const showHidden = includeHidden === "true";

      const games = await storage.getUserGamesByStatus(userId, status, showHidden);
      res.json(games);
    } catch (error) {
      routesLogger.error({ error }, "error fetching games by status");
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  // Search user's collection
  app.get(
    "/api/games/search",
    authenticateToken,
    sanitizeSearchQuery,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { q, includeHidden } = req.query;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (req as any).user.id;
        const showHidden = includeHidden === "true";

        if (!q || typeof q !== "string") {
          return res.status(400).json({ error: "Search query required" });
        }
        const games = await storage.searchUserGames(userId, q, showHidden);
        res.json(games);
      } catch (error) {
        routesLogger.error({ error }, "error searching games");
        res.status(500).json({ error: "Failed to search games" });
      }
    }
  );

  // Add game to collection
  app.post(
    "/api/games",
    authenticateToken,
    sensitiveEndpointLimiter,
    sanitizeGameData,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        routesLogger.debug({ body: req.body }, "received game data");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (req as any).user.id;
        const gameData = insertGameSchema.parse({ ...req.body, userId });

        const userGames = await storage.getUserGames(userId, true); // Check against all games including hidden
        const existingGame = userGames.find((g) => g.igdbId === gameData.igdbId);

        if (existingGame) {
          return res.status(409).json({ error: "Game already in collection", game: existingGame });
        }

        // Always generate new UUID - never trust client-provided IDs
        const game = await storage.addGame(gameData);
        res.status(201).json(game);
      } catch (error) {
        if (error instanceof z.ZodError) {
          routesLogger.warn({ errors: error.errors }, "validation error");
          return res.status(400).json({ error: "Invalid game data", details: error.errors });
        }
        routesLogger.error({ error }, "error adding game");
        res.status(500).json({ error: "Failed to add game" });
      }
    }
  );

  // Update game status
  app.patch(
    "/api/games/:id/status",
    sensitiveEndpointLimiter,
    sanitizeGameId,
    sanitizeGameStatus,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const statusUpdate = updateGameStatusSchema.parse(req.body);

        const updatedGame = await storage.updateGameStatus(id, statusUpdate);
        if (!updatedGame) {
          return res.status(404).json({ error: "Game not found" });
        }

        res.json(updatedGame);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid status data", details: error.errors });
        }
        routesLogger.error({ error }, "error updating game status");
        res.status(500).json({ error: "Failed to update game status" });
      }
    }
  );

  // Update game visibility (hidden status)
  app.patch(
    "/api/games/:id/hidden",
    sensitiveEndpointLimiter,
    sanitizeGameId,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { hidden } = updateGameHiddenSchema.parse(req.body);

        const updatedGame = await storage.updateGameHidden(id, hidden);
        if (!updatedGame) {
          return res.status(404).json({ error: "Game not found" });
        }

        res.json(updatedGame);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid hidden data", details: error.errors });
        }
        routesLogger.error({ error }, "error updating game visibility");
        res.status(500).json({ error: "Failed to update game visibility" });
      }
    }
  );

  // Refresh metadata for all games
  app.post("/api/games/refresh-metadata", authenticateToken, async (req, res) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user.id;
      const userGames = await storage.getUserGames(userId, true);

      routesLogger.info({ userId, gameCount: userGames.length }, "starting metadata refresh");

      // ⚡ Bolt: Optimize metadata refresh by fetching all games in batches
      // instead of sequential 1-by-1 requests.
      const igdbIds = userGames
        .map((g) => g.igdbId)
        .filter((id): id is number => id !== null && id !== undefined);

      // Fetch all updated game data from IGDB in parallel/batches
      const igdbGames = igdbIds.length > 0 ? await igdbClient.getGamesByIds(igdbIds) : [];
      const igdbGameMap = new Map(igdbGames.map((g) => [g.id, g]));

      let updatedCount = 0;
      let errorCount = 0;

      // Process updates in batches to avoid overwhelming the database
      const CONCURRENCY_LIMIT = 10;
      for (let i = 0; i < userGames.length; i += CONCURRENCY_LIMIT) {
        const chunk = userGames.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(
          chunk.map(async (game) => {
            if (!game.igdbId) return;

            try {
              const igdbGame = igdbGameMap.get(game.igdbId);
              if (igdbGame) {
                const updatedData = igdbClient.formatGameData(igdbGame);
                await storage.updateGame(game.id, {
                  publishers: updatedData.publishers as string[],
                  developers: updatedData.developers as string[],
                  summary: updatedData.summary as string,
                  rating: updatedData.rating as number,
                  genres: updatedData.genres as string[],
                  platforms: updatedData.platforms as string[],
                  coverUrl: updatedData.coverUrl as string,
                  screenshots: updatedData.screenshots as string[],
                  releaseDate: updatedData.releaseDate as string,
                });
                updatedCount++;
              }
            } catch (error) {
              routesLogger.error({ gameId: game.id, error }, "failed to refresh metadata for game");
              errorCount++;
            }
          })
        );
      }

      routesLogger.info({ userId, updatedCount, errorCount }, "metadata refresh completed");

      res.json({
        success: true,
        message: `Successfully refreshed metadata for ${updatedCount} games.${errorCount > 0 ? ` Failed for ${errorCount} games.` : ""}`,
        updatedCount,
        errorCount,
      });
    } catch (error) {
      routesLogger.error({ error }, "error refreshing metadata");
      res.status(500).json({ error: "Failed to refresh metadata" });
    }
  });

  // Remove game from collection
  app.delete(
    "/api/games/:id",
    sensitiveEndpointLimiter,
    sanitizeGameId,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const success = await storage.removeGame(id);

        if (!success) {
          return res.status(404).json({ error: "Game not found" });
        }

        res.status(204).send();
      } catch (error) {
        routesLogger.error({ error }, "error removing game");
        res.status(500).json({ error: "Failed to remove game" });
      }
    }
  );

  // IGDB discovery routes

  // Search IGDB for games
  app.get(
    "/api/igdb/search",
    igdbRateLimiter,
    sanitizeSearchQuery,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { q, limit } = req.query;
        if (!q || typeof q !== "string") {
          return res.status(400).json({ error: "Search query required" });
        }

        const limitNum = limit ? parseInt(limit as string) : 20;
        const igdbGames = await igdbClient.searchGames(q, limitNum);
        const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

        res.json(formattedGames);
      } catch (error) {
        routesLogger.error({ error }, "error searching IGDB");
        res.status(500).json({ error: "Failed to search games" });
      }
    }
  );

  // New discover endpoint for personalized recommendations
  app.get("/api/games/discover", igdbRateLimiter, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      // Get user's current games for recommendations
      const userGames = await storage.getAllGames();

      // Get recommendations from IGDB
      const igdbGames = await igdbClient.getRecommendations(
        userGames.map((g) => ({
          genres: g.genres || undefined,
          platforms: g.platforms || undefined,
          igdbId: g.igdbId ?? undefined,
        })),
        limit
      );
      const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

      res.json(formattedGames);
    } catch (error) {
      routesLogger.error({ error }, "error getting game recommendations");
      res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  // Get popular games
  app.get("/api/igdb/popular", igdbRateLimiter, async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;

      const igdbGames = await igdbClient.getPopularGames(limitNum);
      const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

      res.json(formattedGames);
    } catch (error) {
      routesLogger.error({ error }, "error fetching popular games");
      res.status(500).json({ error: "Failed to fetch popular games" });
    }
  });

  // Get recent releases
  app.get("/api/igdb/recent", igdbRateLimiter, async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;

      const igdbGames = await igdbClient.getRecentReleases(limitNum);
      const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

      res.json(formattedGames);
    } catch (error) {
      routesLogger.error({ error }, "error fetching recent releases");
      res.status(500).json({ error: "Failed to fetch recent releases" });
    }
  });

  // Get upcoming releases
  app.get("/api/igdb/upcoming", igdbRateLimiter, async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;

      const igdbGames = await igdbClient.getUpcomingReleases(limitNum);
      const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

      res.json(formattedGames);
    } catch (error) {
      routesLogger.error({ error }, "error fetching upcoming releases");
      res.status(500).json({ error: "Failed to fetch upcoming releases" });
    }
  });

  // Get games by genre
  app.get("/api/igdb/genre/:genre", igdbRateLimiter, async (req, res) => {
    try {
      const { genre } = req.params;
      const { limit, offset } = validatePaginationParams(
        req.query as { limit?: string; offset?: string }
      );

      // Basic validation for genre parameter
      if (!genre || genre.length > 100) {
        return res.status(400).json({ error: "Invalid genre parameter" });
      }

      const igdbGames = await igdbClient.getGamesByGenre(genre, limit, offset);
      const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

      res.json(formattedGames);
    } catch (error) {
      console.error("Error fetching games by genre:", error);
      res.status(500).json({ error: "Failed to fetch games by genre" });
    }
  });

  // Get games by platform
  app.get("/api/igdb/platform/:platform", igdbRateLimiter, async (req, res) => {
    try {
      const { platform } = req.params;
      const { limit, offset } = validatePaginationParams(
        req.query as { limit?: string; offset?: string }
      );

      // Basic validation for platform parameter
      if (!platform || platform.length > 100) {
        return res.status(400).json({ error: "Invalid platform parameter" });
      }

      const igdbGames = await igdbClient.getGamesByPlatform(platform, limit, offset);
      const formattedGames = igdbGames.map((game) => igdbClient.formatGameData(game));

      res.json(formattedGames);
    } catch (error) {
      console.error("Error fetching games by platform:", error);
      res.status(500).json({ error: "Failed to fetch games by platform" });
    }
  });

  // Get available genres (for UI dropdowns/filters)
  app.get("/api/igdb/genres", igdbRateLimiter, async (req, res) => {
    try {
      const genres = await igdbClient.getGenres();
      res.json(genres);
    } catch (error) {
      console.error("Error fetching genres:", error);
      res.status(500).json({ error: "Failed to fetch genres" });
    }
  });

  // Get available platforms (for UI dropdowns/filters)
  app.get("/api/igdb/platforms", igdbRateLimiter, async (req, res) => {
    try {
      const platforms = await igdbClient.getPlatforms();
      res.json(platforms);
    } catch (error) {
      console.error("Error fetching platforms:", error);
      res.status(500).json({ error: "Failed to fetch platforms" });
    }
  });

  // Get game details by IGDB ID
  app.get(
    "/api/igdb/game/:id",
    igdbRateLimiter,
    sanitizeIgdbId,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const igdbId = parseInt(id);

        if (isNaN(igdbId)) {
          return res.status(400).json({ error: "Invalid game ID" });
        }

        const igdbGame = await igdbClient.getGameById(igdbId);
        if (!igdbGame) {
          return res.status(404).json({ error: "Game not found" });
        }

        const formattedGame = igdbClient.formatGameData(igdbGame);
        res.json(formattedGame);
      } catch (error) {
        routesLogger.error({ error }, "error fetching game details");
        res.status(500).json({ error: "Failed to fetch game details" });
      }
    }
  );

  // Indexer management routes

  // Get all indexers
  app.get("/api/indexers", async (req, res) => {
    try {
      const indexers = await storage.getAllIndexers();
      res.json(indexers);
    } catch (error) {
      routesLogger.error({ error }, "error fetching indexers");
      res.status(500).json({ error: "Failed to fetch indexers" });
    }
  });

  // Get enabled indexers only
  app.get("/api/indexers/enabled", async (req, res) => {
    try {
      const indexers = await storage.getEnabledIndexers();
      res.json(indexers);
    } catch (error) {
      routesLogger.error({ error }, "error fetching enabled indexers");
      res.status(500).json({ error: "Failed to fetch enabled indexers" });
    }
  });

  // Aggregated search across all enabled indexers
  app.get(
    "/api/indexers/search",
    sanitizeIndexerSearchQuery,
    validateRequest,
    handleAggregatedIndexerSearch
  );

  // Get single indexer
  app.get("/api/indexers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const indexer = await storage.getIndexer(id);
      if (!indexer) {
        return res.status(404).json({ error: "Indexer not found" });
      }
      res.json(indexer);
    } catch (error) {
      routesLogger.error({ error }, "error fetching indexer");
      res.status(500).json({ error: "Failed to fetch indexer" });
    }
  });

  // Add new indexer
  app.post(
    "/api/indexers",
    sensitiveEndpointLimiter,
    sanitizeIndexerData,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const indexerData = insertIndexerSchema.parse(req.body);
        const indexer = await storage.addIndexer(indexerData);
        res.status(201).json(indexer);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid indexer data", details: error.errors });
        }
        routesLogger.error({ error }, "error adding indexer");
        res.status(500).json({ error: "Failed to add indexer" });
      }
    }
  );

  // Update indexer
  app.patch(
    "/api/indexers/:id",
    sensitiveEndpointLimiter,
    sanitizeIndexerUpdateData,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const updates = req.body; // Partial updates
        const indexer = await storage.updateIndexer(id, updates);
        if (!indexer) {
          return res.status(404).json({ error: "Indexer not found" });
        }
        res.json(indexer);
      } catch (error) {
        routesLogger.error({ error }, "error updating indexer");
        res.status(500).json({ error: "Failed to update indexer" });
      }
    }
  );

  // Delete indexer
  app.delete("/api/indexers/:id", sensitiveEndpointLimiter, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.removeIndexer(id);
      if (!success) {
        return res.status(404).json({ error: "Indexer not found" });
      }
      res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "error deleting indexer");
      res.status(500).json({ error: "Failed to delete indexer" });
    }
  });

  // Downloader management routes

  // Get all downloaders
  app.get("/api/downloaders", async (req, res) => {
    try {
      const downloaders = await storage.getAllDownloaders();
      res.json(downloaders);
    } catch (error) {
      routesLogger.error({ error }, "error fetching downloaders");
      res.status(500).json({ error: "Failed to fetch downloaders" });
    }
  });

  // Get enabled downloaders only
  app.get("/api/downloaders/enabled", async (req, res) => {
    try {
      const downloaders = await storage.getEnabledDownloaders();
      res.json(downloaders);
    } catch (error) {
      routesLogger.error({ error }, "error fetching enabled downloaders");
      res.status(500).json({ error: "Failed to fetch enabled downloaders" });
    }
  });

  // Get free space for all enabled downloaders
  app.get("/api/downloaders/storage", async (req, res) => {
    try {
      // ⚡ Bolt: Check cache first
      if (storageCache.data && Date.now() < storageCache.expiry) {
        return res.json(storageCache.data);
      }

      const enabledDownloaders = await storage.getEnabledDownloaders();
      routesLogger.debug(
        { count: enabledDownloaders.length },
        "fetching storage info for downloaders"
      );
      // ⚡ Bolt: Fetch storage info from all downloaders in parallel
      const storageInfo = await Promise.all(
        enabledDownloaders.map(async (downloader) => {
          try {
            const freeSpace = await DownloaderManager.getFreeSpace(downloader);
            routesLogger.debug({ name: downloader.name, freeSpace }, "retrieved free space");
            return {
              downloaderId: downloader.id,
              downloaderName: downloader.name,
              freeSpace,
            };
          } catch (error) {
            routesLogger.error(
              { downloaderName: downloader.name, error },
              "error getting free space"
            );
            return {
              downloaderId: downloader.id,
              downloaderName: downloader.name,
              freeSpace: 0,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      );

      // ⚡ Bolt: Cache the result
      storageCache.data = storageInfo;
      storageCache.expiry = Date.now() + storageCache.ttl;

      res.json(storageInfo);
    } catch (error) {
      routesLogger.error({ error }, "error getting all storage info");
      res.status(500).json({ error: "Failed to get storage info" });
    }
  });

  // Get single downloader
  app.get("/api/downloaders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const downloader = await storage.getDownloader(id);
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }
      res.json(downloader);
    } catch (error) {
      routesLogger.error({ error }, "error fetching downloader");
      res.status(500).json({ error: "Failed to fetch downloader" });
    }
  });

  // Add new downloader
  app.post(
    "/api/downloaders",
    sensitiveEndpointLimiter,
    sanitizeDownloaderData,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const downloaderData = insertDownloaderSchema.parse(req.body);
        const downloader = await storage.addDownloader(downloaderData);
        res.status(201).json(downloader);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid downloader data", details: error.errors });
        }
        routesLogger.error({ error }, "error adding downloader");
        res.status(500).json({ error: "Failed to add downloader" });
      }
    }
  );

  // Update downloader
  app.patch(
    "/api/downloaders/:id",
    sensitiveEndpointLimiter,
    sanitizeDownloaderUpdateData,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const updates = req.body; // Partial updates
        const downloader = await storage.updateDownloader(id, updates);
        if (!downloader) {
          return res.status(404).json({ error: "Downloader not found" });
        }
        res.json(downloader);
      } catch (error) {
        routesLogger.error({ error }, "error updating downloader");
        res.status(500).json({ error: "Failed to update downloader" });
      }
    }
  );

  // Delete downloader
  app.delete("/api/downloaders/:id", sensitiveEndpointLimiter, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.removeDownloader(id);
      if (!success) {
        return res.status(404).json({ error: "Downloader not found" });
      }
      res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "error deleting downloader");
      res.status(500).json({ error: "Failed to delete downloader" });
    }
  });

  // Torznab search routes

  // Search for games using configured indexers (alias for /api/indexers/search)
  app.get(
    "/api/search",
    sanitizeIndexerSearchQuery,
    validateRequest,
    handleAggregatedIndexerSearch
  );

  // Test indexer connection with provided configuration (doesn't require saving first)
  app.post("/api/indexers/test", async (req, res) => {
    try {
      const { name, url, apiKey, enabled, priority, categories, rssEnabled, autoSearchEnabled } =
        req.body;

      if (!url || !apiKey) {
        return res.status(400).json({ error: "URL and API key are required" });
      }

      // Create a temporary indexer object for testing
      const tempIndexer: Indexer = {
        id: "test",
        name: name || "Test Connection",
        url,
        apiKey,
        protocol: "torznab",
        enabled: enabled ?? true,
        priority: priority ?? 1,
        categories: categories || [],
        rssEnabled: rssEnabled ?? true,
        autoSearchEnabled: autoSearchEnabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await torznabClient.testConnection(tempIndexer);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error testing indexer");
      res.status(500).json({
        error: "Failed to test indexer connection",
      });
    }
  });

  // Test existing indexer connection by ID
  app.post("/api/indexers/:id/test", async (req, res) => {
    try {
      const { id } = req.params;
      const indexer = await storage.getIndexer(id);

      if (!indexer) {
        return res.status(404).json({ error: "Indexer not found" });
      }

      const result = await torznabClient.testConnection(indexer);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error testing indexer");
      res.status(500).json({
        error: "Failed to test indexer connection",
      });
    }
  });

  // Get available categories from an indexer
  app.get("/api/indexers/:id/categories", async (req, res) => {
    try {
      const { id } = req.params;
      const indexer = await storage.getIndexer(id);

      if (!indexer) {
        return res.status(404).json({ error: "Indexer not found" });
      }

      const categories = await torznabClient.getCategories(indexer);
      res.json(categories);
    } catch (error) {
      routesLogger.error({ error }, "error getting categories");
      res.status(500).json({ error: "Failed to get categories" });
    }
  });

  // Search specific indexer
  app.get("/api/indexers/:id/search", async (req, res) => {
    try {
      const { id } = req.params;
      const { query, category, cat, limit = 50, offset = 0 } = req.query;

      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }

      const indexer = await storage.getIndexer(id);
      if (!indexer) {
        return res.status(404).json({ error: "Indexer not found" });
      }

      const searchParams = {
        query: query.trim(),
        category: parseCategories(category || cat),
        limit: parseInt(limit as string) || 50,
        offset: parseInt(offset as string) || 0,
      };

      const results = await torznabClient.searchGames(indexer, searchParams);
      res.json(results);
    } catch (error) {
      routesLogger.error({ error }, "error searching specific indexer");
      res.status(500).json({ error: "Failed to search indexer" });
    }
  });

  // Downloader integration routes

  // Test downloader connection with provided configuration (doesn't require saving first)
  app.post("/api/downloaders/test", async (req, res) => {
    try {
      const {
        type,
        url,
        port,
        useSsl,
        urlPath,
        username,
        password,
        downloadPath,
        category,
        label,
        addStopped,
        removeCompleted,
        postImportCategory,
        settings,
      } = req.body;

      if (!type || !url) {
        return res.status(400).json({ error: "Type and URL are required" });
      }

      // Check for SSRF
      if (!(await isSafeUrl(url))) {
        return res.status(400).json({ error: "Invalid or unsafe URL" });
      }

      // Create a temporary downloader object for testing
      const tempDownloader: Downloader = {
        id: "test",
        name: "Test Connection",
        type,
        url,
        port: port || null,
        useSsl: useSsl ?? false,
        urlPath: urlPath || null,
        username: username || null,
        password: password || null,
        enabled: true,
        priority: 1,
        downloadPath: downloadPath || null,
        category: category || null,
        label: label || "Questarr",
        addStopped: addStopped ?? false,
        removeCompleted: removeCompleted ?? false,
        postImportCategory: postImportCategory || null,
        settings: settings || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await DownloaderManager.testDownloader(tempDownloader);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error testing downloader");
      res.status(500).json({
        error: "Failed to test downloader connection",
      });
    }
  });

  // Test existing downloader connection by ID
  app.post("/api/downloaders/:id/test", async (req, res) => {
    try {
      const { id } = req.params;
      const downloader = await storage.getDownloader(id);

      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.testDownloader(downloader);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error testing downloader");
      res.status(500).json({
        error: "Failed to test downloader connection",
      });
    }
  });

  // Add download to downloader
  app.post(
    "/api/downloaders/:id/downloads",
    sensitiveEndpointLimiter,
    sanitizeDownloadData, // TODO: Rename to sanitizeDownloadData
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { url, title, category, downloadPath, priority, downloadType } = req.body;

        if (!url || !title) {
          return res.status(400).json({ error: "URL and title are required" });
        }

        const downloader = await storage.getDownloader(id);
        if (!downloader) {
          return res.status(404).json({ error: "Downloader not found" });
        }

        if (!downloader.enabled) {
          return res.status(400).json({ error: "Downloader is disabled" });
        }

        const result = await DownloaderManager.addDownload(downloader, {
          url,
          title,
          category,
          downloadPath,
          priority,
          downloadType,
        });

        res.json(result);
      } catch (error) {
        routesLogger.error({ error }, "error adding download");
        res.status(500).json({
          error: "Failed to add download",
        });
      }
    }
  );

  // Get all downloads from a downloader
  app.get("/api/downloaders/:id/downloads", async (req, res) => {
    try {
      const { id } = req.params;
      const downloader = await storage.getDownloader(id);

      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const downloads = await DownloaderManager.getAllDownloads(downloader);
      res.json(downloads);
    } catch (error) {
      routesLogger.error({ error }, "error getting downloads");
      res.status(500).json({ error: "Failed to get downloads" });
    }
  });

  // Get specific download status
  app.get("/api/downloaders/:id/downloads/:downloadId", async (req, res) => {
    try {
      const { id, downloadId } = req.params;
      const downloader = await storage.getDownloader(id);

      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const download = await DownloaderManager.getDownloadStatus(downloader, downloadId);
      if (!download) {
        return res.status(404).json({ error: "Download not found" });
      }

      res.json(download);
    } catch (error) {
      routesLogger.error({ error }, "error getting download status");
      res.status(500).json({ error: "Failed to get download status" });
    }
  });

  // Get detailed download information (files, trackers, etc.)
  app.get("/api/downloaders/:id/downloads/:downloadId/details", async (req, res) => {
    try {
      const { id, downloadId } = req.params;
      const downloader = await storage.getDownloader(id);

      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const details = await DownloaderManager.getDownloadDetails(downloader, downloadId);
      if (!details) {
        return res.status(404).json({ error: "Download not found" });
      }

      res.json(details);
    } catch (error) {
      console.error("Error getting download details:", error);
      res.status(500).json({ error: "Failed to get download details" });
    }
  });

  // Pause download
  app.post("/api/downloaders/:id/downloads/:downloadId/pause", async (req, res) => {
    try {
      const { id, downloadId } = req.params;
      const downloader = await storage.getDownloader(id);

      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.pauseDownload(downloader, downloadId);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error pausing download");
      res.status(500).json({
        error: "Failed to pause download",
      });
    }
  });

  // Resume download
  app.post("/api/downloaders/:id/downloads/:downloadId/resume", async (req, res) => {
    try {
      const { id, downloadId } = req.params;
      const downloader = await storage.getDownloader(id);

      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.resumeDownload(downloader, downloadId);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error resuming download");
      res.status(500).json({
        error: "Failed to resume download",
      });
    }
  });

  // Remove download
  app.delete("/api/downloaders/:id/downloads/:downloadId", async (req, res) => {
    try {
      const { id, downloadId } = req.params;
      const { deleteFiles = false } = req.query;

      const downloader = await storage.getDownloader(id);
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.removeDownload(
        downloader,
        downloadId,
        deleteFiles === "true"
      );

      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error removing download");
      res.status(500).json({
        error: "Failed to remove download",
      });
    }
  });

  // Get aggregated downloads from all enabled downloaders
  app.get("/api/downloads", async (req, res) => {
    try {
      const enabledDownloaders = await storage.getEnabledDownloaders();
      // ⚡ Bolt: Fetch downloads from all downloaders in parallel to reduce latency.
      const results = await Promise.all(
        enabledDownloaders.map(async (downloader) => {
          try {
            const downloads = await DownloaderManager.getAllDownloads(downloader);
            return {
              success: true as const,
              data: downloads.map((download) => ({
                ...download,
                downloaderId: downloader.id,
                downloaderName: downloader.name,
              })),
            };
          } catch (error) {
            return {
              success: false as const,
              downloader,
              error,
            };
          }
        })
      );

      const allDownloads = results.flatMap((r) => (r.success ? r.data : []));
      const errors = results
        .filter((r): r is { success: false; downloader: Downloader; error: unknown } => !r.success)
        .map(({ downloader, error }) => {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          routesLogger.error({ downloaderName: downloader.name, error }, "error getting downloads");
          return {
            downloaderId: downloader.id,
            downloaderName: downloader.name,
            error: errorMessage,
          };
        });

      res.json({
        downloads: allDownloads,
        errors,
      });
    } catch (error) {
      routesLogger.error({ error }, "error getting all downloads");
      res.status(500).json({ error: "Failed to get downloads" });
    }
  });

  // Add download to best available downloader
  app.post(
    "/api/downloads",
    sensitiveEndpointLimiter,
    sanitizeDownloadData,
    validateRequest,
    async (req: Request, res: Response) => {
      try {
        const { url, title, category, downloadPath, priority, gameId, downloadType } = req.body;

        if (!url || !title) {
          return res.status(400).json({ error: "URL and title are required" });
        }

        const enabledDownloaders = await storage.getEnabledDownloaders();
        if (enabledDownloaders.length === 0) {
          return res.status(400).json({ error: "No downloaders configured" });
        }

        // Try downloaders by priority order with automatic fallback
        const result = await DownloaderManager.addDownloadWithFallback(enabledDownloaders, {
          url,
          title,
          category,
          downloadPath,
          priority,
          downloadType,
        });

        if (result && result.success === false) {
          // All downloaders failed, return 500 error
          return res.status(500).json(result);
        }

        // If gameId is provided, track this download and update game status
        if (gameId && result.success && result.id && result.downloaderId) {
          try {
            await storage.addGameDownload({
              gameId,
              downloaderId: result.downloaderId,
              downloadHash: result.id,
              downloadTitle: title,
              status: "downloading",
              downloadType: downloadType || "torrent",
            });

            await storage.updateGameStatus(gameId, { status: "downloading" });
          } catch (error) {
            routesLogger.error({ error, gameId }, "Failed to link download to game");
            // We don't fail the whole request since the download was added successfully
          }
        }

        res.json(result);
      } catch (error) {
        routesLogger.error({ error }, "error adding download");
        res.status(500).json({
          error: "Failed to add download",
        });
      }
    }
  );

  // Download bundle of downloads as ZIP
  app.post("/api/downloads/bundle", sensitiveEndpointLimiter, async (req, res) => {
    try {
      const { downloads } = req.body;
      if (!downloads || !Array.isArray(downloads)) {
        return res.status(400).json({ error: "No downloads provided" });
      }

      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      res.attachment("download-bundle.zip");
      archive.pipe(res);

      // ⚡ Bolt: Fetch all downloads in parallel to significantly reduce wait time
      // for the user compared to sequential processing.
      // We process in chunks to prevent overwhelming external servers or our own network.
      const CONCURRENCY_LIMIT = 5;
      for (let i = 0; i < downloads.length; i += CONCURRENCY_LIMIT) {
        const chunk = downloads.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(
          chunk.map(async (download: { link: string; title: string; downloadType?: string }) => {
            try {
              const response = await fetch(download.link);
              if (response.ok) {
                const buffer = await response.arrayBuffer();
                // Try to detect if it's a usenet item based on title or link if downloadType not present
                const isUsenet =
                  download.downloadType === "usenet" ||
                  download.link.includes("newznab") ||
                  download.title.toLowerCase().includes(".nzb");
                const extension = isUsenet ? "nzb" : "torrent";
                const filename = `${download.title.replace(/[<>:"/\\|?*]/g, "_")}.${extension}`;
                archive.append(Buffer.from(buffer), { name: filename });
              }
            } catch (error) {
              console.error(`Error adding ${download.title} to bundle:`, error);
            }
          })
        );
      }

      await archive.finalize();
    } catch (error) {
      console.error("Error creating bundle:", error);
      res.status(500).json({ error: "Failed to create bundle" });
    }
  });

  // Notification routes
  app.get("/api/notifications", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const notifications = await storage.getNotifications(limit);
      res.json(notifications);
    } catch (error) {
      routesLogger.error({ error }, "error fetching notifications");
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", async (req, res) => {
    try {
      const count = await storage.getUnreadNotificationsCount();
      res.json({ count });
    } catch (error) {
      routesLogger.error({ error }, "error fetching unread count");
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  app.post("/api/notifications", validateRequest, async (req, res) => {
    try {
      const notificationData = insertNotificationSchema.parse(req.body);
      const notification = await storage.addNotification(notificationData);

      // Notify via WebSocket
      // dynamic import to avoid circular dependency issues if they exist,
      // or just import it at top if safe.
      // Ideally notifications are triggered by events, not by API, but this is good for testing.
      const { notifyUser } = await import("./socket.js");
      notifyUser("notification", notification);

      res.status(201).json(notification);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid notification data", details: error.errors });
      }
      routesLogger.error({ error }, "error adding notification");
      res.status(500).json({ error: "Failed to add notification" });
    }
  });

  app.put("/api/notifications/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      const notification = await storage.markNotificationAsRead(id);
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }
      res.json(notification);
    } catch (error) {
      routesLogger.error({ error }, "error marking notification as read");
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  app.put("/api/notifications/read-all", async (req, res) => {
    try {
      await storage.markAllNotificationsAsRead();
      res.json({ success: true });
    } catch (error) {
      routesLogger.error({ error }, "error marking all notifications as read");
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });

  app.delete("/api/notifications", async (req, res) => {
    try {
      await storage.clearAllNotifications();
      res.status(204).send();
    } catch (error) {
      routesLogger.error({ error }, "error clearing notifications");
      res.status(500).json({ error: "Failed to clear notifications" });
    }
  });

  // Configuration endpoint - read-only access to key settings
  app.get("/api/config", sensitiveEndpointLimiter, async (req, res) => {
    try {
      // 🛡️ Sentinel: Harden config endpoint to prevent information disclosure.
      // Only expose boolean flags indicating if services are configured, not
      // sensitive details like database URLs or partial API keys.
      let isConfigured = false;
      let source: "env" | "database" | undefined;

      // Check database first (takes precedence)
      const dbClientId = await storage.getSystemConfig("igdb.clientId");
      const dbClientSecret = await storage.getSystemConfig("igdb.clientSecret");
      
      let clientId: string | undefined;

      if (dbClientId && dbClientSecret) {
        isConfigured = true;
        source = "database";
        clientId = dbClientId;
      } else if (appConfig.igdb.isConfigured) {
        // Fallback to environment variables
        isConfigured = true;
        source = "env";
        clientId = appConfig.igdb.clientId;
      }

      const config: Config = {
        igdb: {
          configured: isConfigured,
          source,
          clientId,
        },
      };
      res.json(config);
    } catch (error) {
      routesLogger.error({ error }, "error fetching config");
      res.status(500).json({ error: "Failed to fetch configuration" });
    }
  });

  // IGDB Configuration endpoint
  app.post("/api/settings/igdb", authenticateToken, async (req, res) => {
    try {
      const { clientId, clientSecret } = req.body;

      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: "Client ID and Client Secret are required" });
      }

      await storage.setSystemConfig("igdb.clientId", clientId.trim());
      await storage.setSystemConfig("igdb.clientSecret", clientSecret.trim());
      
      routesLogger.info("IGDB credentials updated via settings");
      res.json({ success: true });
    } catch (error) {
      routesLogger.error({ error }, "Failed to update IGDB credentials");
      res.status(500).json({ error: "Failed to update IGDB credentials" });
    }
  });

  // User Settings routes
  app.get("/api/settings", authenticateToken, async (req, res) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user.id;
      let settings = await storage.getUserSettings(userId);

      // Create default settings if they don't exist
      if (!settings) {
        settings = await storage.createUserSettings({ userId });
      }

      res.json(settings);
    } catch (error) {
      routesLogger.error({ error }, "error fetching settings");
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", authenticateToken, async (req, res) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user.id;

      // Validate the request body
      const updates = updateUserSettingsSchema.parse(req.body);

      let settings = await storage.getUserSettings(userId);

      if (!settings) {
        // Create with updates if doesn't exist
        settings = await storage.createUserSettings({ userId, ...updates });
      } else {
        settings = await storage.updateUserSettings(userId, updates);
      }

      if (!settings) {
        return res.status(404).json({ error: "Settings not found" });
      }

      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        routesLogger.error({ error: error.errors }, "validation error in settings update");
        return res.status(400).json({ error: "Invalid settings data", details: error.errors });
      }
      routesLogger.error({ error }, "error updating settings");
      res.status(500).json({
        error: "Failed to update settings",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
