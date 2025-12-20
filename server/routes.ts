import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { pool } from "./db.js";
import { insertGameSchema, updateGameStatusSchema, insertIndexerSchema, insertDownloaderSchema, type Config, type Indexer, type Downloader } from "../shared/schema.js";
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
  sanitizeTorrentData,
  sanitizeIndexerSearchQuery,
} from "./middleware.js";
import { config as appConfig } from "./config.js";

// Helper function for aggregated indexer search
async function handleAggregatedIndexerSearch(req: Request, res: Response) {
  try {
    const { query, category } = req.query;
    // Use validated values from middleware (already converted to integers by .toInt())
    const limit = (req.query.limit as unknown as number) || 50;
    const offset = (req.query.offset as unknown as number) || 0;
    
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Search query required" });
    }

    // Get enabled indexers
    const enabledIndexers = await storage.getEnabledIndexers();
    if (enabledIndexers.length === 0) {
      return res.status(400).json({ error: "No indexers configured" });
    }

    const searchParams = {
      query: query.trim(),
      category: category && typeof category === "string" ? category.split(",") : undefined,
      limit,
      offset,
    };

    const { results, errors } = await torznabClient.searchMultipleIndexers(
      enabledIndexers,
      searchParams
    );

    res.json({
      items: results.items,
      total: results.total,
      offset: results.offset,
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
function validatePaginationParams(query: { limit?: string; offset?: string }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(1, parseInt(query.limit as string) || 20), 100);
  const offset = Math.max(0, parseInt(query.offset as string) || 0);
  return { limit, offset };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint
  app.get("/api/health", async (req, res) => {
    const health = {
      ok: true,
      db: false,
      igdb: false,
    };

    // Check database connectivity
    try {
      await pool.query("SELECT 1");
      health.db = true;
    } catch (error) {
      routesLogger.error({ error }, "database health check failed");
      health.ok = false;
    }

    // Check IGDB API connectivity
    try {
      // Try to get popular games with a minimal limit to test connectivity
      await igdbClient.getPopularGames(1);
      health.igdb = true;
    } catch (error) {
      routesLogger.error({ error }, "igdb health check failed");
      health.ok = false;
    }

    // Return 200 if all OK, 500 if any service is down
    const statusCode = health.ok ? 200 : 500;
    res.status(statusCode).json(health);
  });

  // Game collection routes
  
  // Get all games in collection
  app.get("/api/games", async (req, res) => {
    try {
      const { search } = req.query;
      
      let games;
      if (search && typeof search === 'string' && search.trim()) {
        games = await storage.searchGames(search.trim());
      } else {
        games = await storage.getAllGames();
      }
      
      res.json(games);
    } catch (error) {
      routesLogger.error({ error }, "error fetching games");
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  // Get games by status
  app.get("/api/games/status/:status", async (req, res) => {
    try {
      const { status } = req.params;
      const games = await storage.getGamesByStatus(status);
      res.json(games);
    } catch (error) {
      routesLogger.error({ error }, "error fetching games by status");
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  // Search user's collection
  app.get("/api/games/search", sanitizeSearchQuery, validateRequest, async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }
      const games = await storage.searchGames(q);
      res.json(games);
    } catch (error) {
      routesLogger.error({ error }, "error searching games");
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  // Add game to collection
  app.post("/api/games", sensitiveEndpointLimiter, sanitizeGameData, validateRequest, async (req: Request, res: Response) => {
    try {
      routesLogger.debug({ body: req.body }, "received game data");
      const gameData = insertGameSchema.parse(req.body);
      
      // Check if game already exists by IGDB ID
      if (gameData.igdbId) {
        const existingGame = await storage.getGameByIgdbId(gameData.igdbId);
        if (existingGame) {
          return res.status(409).json({ error: "Game already in collection", game: existingGame });
        }
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
  });

  // Update game status
  app.patch("/api/games/:id/status", sensitiveEndpointLimiter, sanitizeGameId, sanitizeGameStatus, validateRequest, async (req: Request, res: Response) => {
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
  });

  // Remove game from collection
  app.delete("/api/games/:id", sensitiveEndpointLimiter, sanitizeGameId, validateRequest, async (req: Request, res: Response) => {
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
  });

  // IGDB discovery routes

  // Search IGDB for games
  app.get("/api/igdb/search", igdbRateLimiter, sanitizeSearchQuery, validateRequest, async (req: Request, res: Response) => {
    try {
      const { q, limit } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }
      
      const limitNum = limit ? parseInt(limit as string) : 20;
      const igdbGames = await igdbClient.searchGames(q, limitNum);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
      res.json(formattedGames);
    } catch (error) {
      routesLogger.error({ error }, "error searching IGDB");
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  // New discover endpoint for personalized recommendations
  app.get("/api/games/discover", igdbRateLimiter, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      // Get user's current games for recommendations
      const userGames = await storage.getAllGames();
      
      // Get recommendations from IGDB  
      const igdbGames = await igdbClient.getRecommendations(
        userGames.map(g => ({ 
          genres: g.genres || undefined, 
          platforms: g.platforms || undefined, 
          igdbId: g.igdbId ?? undefined 
        })), 
        limit
      );
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
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
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
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
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
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
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
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
      const { limit, offset } = validatePaginationParams(req.query as { limit?: string; offset?: string });
      
      // Basic validation for genre parameter
      if (!genre || genre.length > 100) {
        return res.status(400).json({ error: "Invalid genre parameter" });
      }
      
      const igdbGames = await igdbClient.getGamesByGenre(genre, limit, offset);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
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
      const { limit, offset } = validatePaginationParams(req.query as { limit?: string; offset?: string });
      
      // Basic validation for platform parameter
      if (!platform || platform.length > 100) {
        return res.status(400).json({ error: "Invalid platform parameter" });
      }
      
      const igdbGames = await igdbClient.getGamesByPlatform(platform, limit, offset);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
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
  app.get("/api/igdb/game/:id", igdbRateLimiter, sanitizeIgdbId, validateRequest, async (req: Request, res: Response) => {
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
  });

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
  app.get("/api/indexers/search", sanitizeIndexerSearchQuery, validateRequest, handleAggregatedIndexerSearch);

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
  app.post("/api/indexers", sensitiveEndpointLimiter, sanitizeIndexerData, validateRequest, async (req: Request, res: Response) => {
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
  });

  // Update indexer
  app.patch("/api/indexers/:id", sensitiveEndpointLimiter, sanitizeIndexerUpdateData, validateRequest, async (req: Request, res: Response) => {
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
  });

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
  app.post("/api/downloaders", sensitiveEndpointLimiter, sanitizeDownloaderData, validateRequest, async (req: Request, res: Response) => {
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
  });

  // Update downloader
  app.patch("/api/downloaders/:id", sensitiveEndpointLimiter, sanitizeDownloaderUpdateData, validateRequest, async (req: Request, res: Response) => {
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
  });

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
  app.get("/api/search", sanitizeIndexerSearchQuery, validateRequest, handleAggregatedIndexerSearch);

  // Test indexer connection with provided configuration (doesn't require saving first)
  app.post("/api/indexers/test", async (req, res) => {
    try {
      const { name, url, apiKey, enabled, priority, categories, rssEnabled, autoSearchEnabled } = req.body;
      
      if (!url || !apiKey) {
        return res.status(400).json({ error: "URL and API key are required" });
      }

      // Create a temporary indexer object for testing
      const tempIndexer: Indexer = {
        id: "test",
        name: name || "Test Connection",
        url,
        apiKey,
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
        error: "Failed to test indexer connection" 
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
        error: "Failed to test indexer connection" 
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
      const { query, category, limit = 50, offset = 0 } = req.query;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }

      const indexer = await storage.getIndexer(id);
      if (!indexer) {
        return res.status(404).json({ error: "Indexer not found" });
      }

      const searchParams = {
        query: query.trim(),
        category: category && typeof category === "string" ? category.split(",") : undefined,
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
      const { type, url, port, useSsl, urlPath, username, password, downloadPath, category, label, addStopped, removeCompleted, postImportCategory, settings } = req.body;
      
      if (!type || !url) {
        return res.status(400).json({ error: "Type and URL are required" });
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
        label: label || "GameRadarr",
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
        error: "Failed to test downloader connection" 
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
        error: "Failed to test downloader connection" 
      });
    }
  });

  // Add torrent to downloader
  app.post("/api/downloaders/:id/torrents", sensitiveEndpointLimiter, sanitizeTorrentData, validateRequest, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { url, title, category, downloadPath, priority } = req.body;
      
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

      const result = await DownloaderManager.addTorrent(downloader, {
        url,
        title,
        category,
        downloadPath,
        priority,
      });

      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error adding torrent");
      res.status(500).json({ 
        error: "Failed to add torrent" 
      });
    }
  });

  // Get all torrents from a downloader
  app.get("/api/downloaders/:id/torrents", async (req, res) => {
    try {
      const { id } = req.params;
      const downloader = await storage.getDownloader(id);
      
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const torrents = await DownloaderManager.getAllTorrents(downloader);
      res.json(torrents);
    } catch (error) {
      routesLogger.error({ error }, "error getting torrents");
      res.status(500).json({ error: "Failed to get torrents" });
    }
  });

  // Get specific torrent status
  app.get("/api/downloaders/:id/torrents/:torrentId", async (req, res) => {
    try {
      const { id, torrentId } = req.params;
      const downloader = await storage.getDownloader(id);
      
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const torrent = await DownloaderManager.getTorrentStatus(downloader, torrentId);
      if (!torrent) {
        return res.status(404).json({ error: "Torrent not found" });
      }

      res.json(torrent);
    } catch (error) {
      routesLogger.error({ error }, "error getting torrent status");
      res.status(500).json({ error: "Failed to get torrent status" });
    }
  });

  // Get detailed torrent information (files, trackers, etc.)
  app.get("/api/downloaders/:id/torrents/:torrentId/details", async (req, res) => {
    try {
      const { id, torrentId } = req.params;
      const downloader = await storage.getDownloader(id);
      
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const details = await DownloaderManager.getTorrentDetails(downloader, torrentId);
      if (!details) {
        return res.status(404).json({ error: "Torrent not found" });
      }

      res.json(details);
    } catch (error) {
      console.error("Error getting torrent details:", error);
      res.status(500).json({ error: "Failed to get torrent details" });
    }
  });

  // Pause torrent
  app.post("/api/downloaders/:id/torrents/:torrentId/pause", async (req, res) => {
    try {
      const { id, torrentId } = req.params;
      const downloader = await storage.getDownloader(id);
      
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.pauseTorrent(downloader, torrentId);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error pausing torrent");
      res.status(500).json({ 
        error: "Failed to pause torrent" 
      });
    }
  });

  // Resume torrent
  app.post("/api/downloaders/:id/torrents/:torrentId/resume", async (req, res) => {
    try {
      const { id, torrentId } = req.params;
      const downloader = await storage.getDownloader(id);
      
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.resumeTorrent(downloader, torrentId);
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error resuming torrent");
      res.status(500).json({ 
        error: "Failed to resume torrent" 
      });
    }
  });

  // Remove torrent
  app.delete("/api/downloaders/:id/torrents/:torrentId", async (req, res) => {
    try {
      const { id, torrentId } = req.params;
      const { deleteFiles = false } = req.query;
      
      const downloader = await storage.getDownloader(id);
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }

      const result = await DownloaderManager.removeTorrent(
        downloader, 
        torrentId, 
        deleteFiles === 'true'
      );
      
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error removing torrent");
      res.status(500).json({ 
        error: "Failed to remove torrent" 
      });
    }
  });

  // Get aggregated torrents from all enabled downloaders
  app.get("/api/downloads", async (req, res) => {
    try {
      const enabledDownloaders = await storage.getEnabledDownloaders();
      const allTorrents = [];
      const errors: Array<{ downloaderId: string; downloaderName: string; error: string }> = [];

      for (const downloader of enabledDownloaders) {
        try {
          const torrents = await DownloaderManager.getAllTorrents(downloader);
          const torrentsWithDownloader = torrents.map(torrent => ({
            ...torrent,
            downloaderId: downloader.id,
            downloaderName: downloader.name,
          }));
          allTorrents.push(...torrentsWithDownloader);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          routesLogger.error({ downloaderName: downloader.name, error }, "error getting torrents");
          errors.push({
            downloaderId: downloader.id,
            downloaderName: downloader.name,
            error: errorMessage,
          });
        }
      }

      res.json({
        torrents: allTorrents,
        errors,
      });
    } catch (error) {
      routesLogger.error({ error }, "error getting all downloads");
      res.status(500).json({ error: "Failed to get downloads" });
    }
  });

  // Add torrent to best available downloader
  app.post("/api/downloads", sensitiveEndpointLimiter, sanitizeTorrentData, validateRequest, async (req: Request, res: Response) => {
    try {
      const { url, title, category, downloadPath, priority } = req.body;
      
      if (!url || !title) {
        return res.status(400).json({ error: "URL and title are required" });
      }

      const enabledDownloaders = await storage.getEnabledDownloaders();
      if (enabledDownloaders.length === 0) {
        return res.status(400).json({ error: "No downloaders configured" });
      }

      // Try downloaders by priority order with automatic fallback
      const result = await DownloaderManager.addTorrentWithFallback(
        enabledDownloaders,
        {
          url,
          title,
          category,
          downloadPath,
          priority,
        }
      );

      if (result && result.success === false) {
        // All downloaders failed, return 500 error
        return res.status(500).json(result);
      }
      res.json(result);
    } catch (error) {
      routesLogger.error({ error }, "error adding download");
      res.status(500).json({ 
        error: "Failed to add download" 
      });
    }
  });

  // Configuration endpoint - read-only access to key settings
  app.get("/api/config", sensitiveEndpointLimiter, async (req, res) => {
    try {
      // 🛡️ Sentinel: Harden config endpoint to prevent information disclosure.
      // Only expose boolean flags indicating if services are configured, not
      // sensitive details like database URLs or partial API keys.
      const config: Config = {
        database: {
          connected: !!appConfig.database.url,
        },
        igdb: {
          configured: appConfig.igdb.isConfigured,
        },
      };
      res.json(config);
    } catch (error) {
      routesLogger.error({ error }, "error fetching config");
      res.status(500).json({ error: "Failed to fetch configuration" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
