import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { igdbClient } from "./igdb";
import { insertGameSchema, updateGameStatusSchema, insertIndexerSchema, insertDownloaderSchema } from "@shared/schema";
import { torznabClient } from "./torznab";
import { DownloaderManager } from "./downloaders";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
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
      console.error("Error fetching games:", error);
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
      console.error("Error fetching games by status:", error);
      res.status(500).json({ error: "Failed to fetch games" });
    }
  });

  // Search user's collection
  app.get("/api/games/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }
      const games = await storage.searchGames(q);
      res.json(games);
    } catch (error) {
      console.error("Error searching games:", error);
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  // Add game to collection
  app.post("/api/games", async (req, res) => {
    try {
      console.log("Received game data:", JSON.stringify(req.body, null, 2));
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
        console.error("Validation error:", JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ error: "Invalid game data", details: error.errors });
      }
      console.error("Error adding game:", error);
      res.status(500).json({ error: "Failed to add game" });
    }
  });

  // Update game status
  app.patch("/api/games/:id/status", async (req, res) => {
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
      console.error("Error updating game status:", error);
      res.status(500).json({ error: "Failed to update game status" });
    }
  });

  // Remove game from collection
  app.delete("/api/games/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.removeGame(id);
      
      if (!success) {
        return res.status(404).json({ error: "Game not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error removing game:", error);
      res.status(500).json({ error: "Failed to remove game" });
    }
  });

  // IGDB discovery routes

  // Search IGDB for games
  app.get("/api/igdb/search", async (req, res) => {
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
      console.error("Error searching IGDB:", error);
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  // New discover endpoint for personalized recommendations
  app.get("/api/games/discover", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      // Get user's current games for recommendations
      const userGames = await storage.getAllGames();
      
      // Get recommendations from IGDB
      const igdbGames = await igdbClient.getRecommendations(userGames, limit);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
      res.json(formattedGames);
    } catch (error) {
      console.error("Error getting game recommendations:", error);
      res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  // Get popular games
  app.get("/api/igdb/popular", async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      
      const igdbGames = await igdbClient.getPopularGames(limitNum);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
      res.json(formattedGames);
    } catch (error) {
      console.error("Error fetching popular games:", error);
      res.status(500).json({ error: "Failed to fetch popular games" });
    }
  });

  // Get recent releases
  app.get("/api/igdb/recent", async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      
      const igdbGames = await igdbClient.getRecentReleases(limitNum);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
      res.json(formattedGames);
    } catch (error) {
      console.error("Error fetching recent releases:", error);
      res.status(500).json({ error: "Failed to fetch recent releases" });
    }
  });

  // Get upcoming releases
  app.get("/api/igdb/upcoming", async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      
      const igdbGames = await igdbClient.getUpcomingReleases(limitNum);
      const formattedGames = igdbGames.map(game => igdbClient.formatGameData(game));
      
      res.json(formattedGames);
    } catch (error) {
      console.error("Error fetching upcoming releases:", error);
      res.status(500).json({ error: "Failed to fetch upcoming releases" });
    }
  });

  // Get game details by IGDB ID
  app.get("/api/igdb/game/:id", async (req, res) => {
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
      console.error("Error fetching game details:", error);
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
      console.error("Error fetching indexers:", error);
      res.status(500).json({ error: "Failed to fetch indexers" });
    }
  });

  // Get enabled indexers only
  app.get("/api/indexers/enabled", async (req, res) => {
    try {
      const indexers = await storage.getEnabledIndexers();
      res.json(indexers);
    } catch (error) {
      console.error("Error fetching enabled indexers:", error);
      res.status(500).json({ error: "Failed to fetch enabled indexers" });
    }
  });

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
      console.error("Error fetching indexer:", error);
      res.status(500).json({ error: "Failed to fetch indexer" });
    }
  });

  // Add new indexer
  app.post("/api/indexers", async (req, res) => {
    try {
      const indexerData = insertIndexerSchema.parse(req.body);
      const indexer = await storage.addIndexer(indexerData);
      res.status(201).json(indexer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid indexer data", details: error.errors });
      }
      console.error("Error adding indexer:", error);
      res.status(500).json({ error: "Failed to add indexer" });
    }
  });

  // Update indexer
  app.patch("/api/indexers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body; // Partial updates
      const indexer = await storage.updateIndexer(id, updates);
      if (!indexer) {
        return res.status(404).json({ error: "Indexer not found" });
      }
      res.json(indexer);
    } catch (error) {
      console.error("Error updating indexer:", error);
      res.status(500).json({ error: "Failed to update indexer" });
    }
  });

  // Delete indexer
  app.delete("/api/indexers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.removeIndexer(id);
      if (!success) {
        return res.status(404).json({ error: "Indexer not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting indexer:", error);
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
      console.error("Error fetching downloaders:", error);
      res.status(500).json({ error: "Failed to fetch downloaders" });
    }
  });

  // Get enabled downloaders only
  app.get("/api/downloaders/enabled", async (req, res) => {
    try {
      const downloaders = await storage.getEnabledDownloaders();
      res.json(downloaders);
    } catch (error) {
      console.error("Error fetching enabled downloaders:", error);
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
      console.error("Error fetching downloader:", error);
      res.status(500).json({ error: "Failed to fetch downloader" });
    }
  });

  // Add new downloader
  app.post("/api/downloaders", async (req, res) => {
    try {
      const downloaderData = insertDownloaderSchema.parse(req.body);
      const downloader = await storage.addDownloader(downloaderData);
      res.status(201).json(downloader);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid downloader data", details: error.errors });
      }
      console.error("Error adding downloader:", error);
      res.status(500).json({ error: "Failed to add downloader" });
    }
  });

  // Update downloader
  app.patch("/api/downloaders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body; // Partial updates
      const downloader = await storage.updateDownloader(id, updates);
      if (!downloader) {
        return res.status(404).json({ error: "Downloader not found" });
      }
      res.json(downloader);
    } catch (error) {
      console.error("Error updating downloader:", error);
      res.status(500).json({ error: "Failed to update downloader" });
    }
  });

  // Delete downloader
  app.delete("/api/downloaders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.removeDownloader(id);
      if (!success) {
        return res.status(404).json({ error: "Downloader not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting downloader:", error);
      res.status(500).json({ error: "Failed to delete downloader" });
    }
  });

  // Torznab search routes
  
  // Search for games using configured indexers
  app.get("/api/search", async (req, res) => {
    try {
      const { query, category, limit = 50, offset = 0 } = req.query;
      
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
        limit: parseInt(limit as string) || 50,
        offset: parseInt(offset as string) || 0,
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
  });

  // Test indexer connection
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
      console.error("Error testing indexer:", error);
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
      console.error("Error getting categories:", error);
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
      console.error("Error searching specific indexer:", error);
      res.status(500).json({ error: "Failed to search indexer" });
    }
  });

  // Downloader integration routes
  
  // Test downloader connection
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
      console.error("Error testing downloader:", error);
      res.status(500).json({ 
        error: "Failed to test downloader connection" 
      });
    }
  });

  // Add torrent to downloader
  app.post("/api/downloaders/:id/torrents", async (req, res) => {
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
      console.error("Error adding torrent:", error);
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
      console.error("Error getting torrents:", error);
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
      console.error("Error getting torrent status:", error);
      res.status(500).json({ error: "Failed to get torrent status" });
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
      console.error("Error pausing torrent:", error);
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
      console.error("Error resuming torrent:", error);
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
      console.error("Error removing torrent:", error);
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
          console.error(`Error getting torrents from ${downloader.name}:`, error);
        }
      }

      res.json(allTorrents);
    } catch (error) {
      console.error("Error getting all downloads:", error);
      res.status(500).json({ error: "Failed to get downloads" });
    }
  });

  // Add torrent to best available downloader with fallback
  app.post("/api/downloads", async (req, res) => {
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
      console.error("Error adding download:", error);
      res.status(500).json({ 
        error: "Failed to add download" 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
