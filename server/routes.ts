import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertGameSchema } from "@shared/schema";
import { z } from "zod";
import { igdbService } from "./services/igdbService";

export async function registerRoutes(app: Express): Promise<Server> {
  // Game routes
  
  // Get all games
  app.get("/api/games", async (req, res) => {
    try {
      const games = await storage.getAllGames();
      res.json(games);
    } catch (error) {
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
      res.status(500).json({ error: "Failed to fetch games by status" });
    }
  });

  // Search games
  app.get("/api/games/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query is required" });
      }
      const games = await storage.searchGames(q);
      res.json(games);
    } catch (error) {
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  // Get games by platform
  app.get("/api/games/platform/:platform", async (req, res) => {
    try {
      const { platform } = req.params;
      const games = await storage.getGamesByPlatform(platform);
      res.json(games);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch games by platform" });
    }
  });

  // Get single game
  app.get("/api/games/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const game = await storage.getGame(id);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      res.json(game);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch game" });
    }
  });

  // Create new game
  app.post("/api/games", async (req, res) => {
    try {
      const gameData = insertGameSchema.parse(req.body);
      const game = await storage.createGame(gameData);
      res.status(201).json(game);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid game data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create game" });
    }
  });

  // Update game
  app.patch("/api/games/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Validate the updates against the schema (partial)
      const partialGameSchema = insertGameSchema.partial();
      const validUpdates = partialGameSchema.parse(updates);
      
      const game = await storage.updateGame(id, validUpdates);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      res.json(game);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update game" });
    }
  });

  // Update game status (convenience endpoint)
  app.patch("/api/games/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!status || !["owned", "wishlist", "playing", "completed"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      
      const game = await storage.updateGame(id, { status });
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }
      res.json(game);
    } catch (error) {
      res.status(500).json({ error: "Failed to update game status" });
    }
  });

  // Delete game
  app.delete("/api/games/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteGame(id);
      if (!deleted) {
        return res.status(404).json({ error: "Game not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete game" });
    }
  });

  // Stats endpoint for dashboard
  app.get("/api/stats", async (req, res) => {
    try {
      const allGames = await storage.getAllGames();
      const stats = {
        total: allGames.length,
        owned: allGames.filter(g => g.status === "owned").length,
        wishlist: allGames.filter(g => g.status === "wishlist").length,
        playing: allGames.filter(g => g.status === "playing").length,
        completed: allGames.filter(g => g.status === "completed").length,
        platforms: [...new Set(allGames.flatMap(g => g.platforms))],
        genres: [...new Set(allGames.map(g => g.genre))]
      };
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // IGDB Discovery routes
  app.get("/api/discover/search", async (req, res) => {
    try {
      const { q, limit } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query is required" });
      }
      
      const limitNum = limit ? parseInt(limit as string) : 20;
      const games = await igdbService.searchGames(q, limitNum);
      res.json(games);
    } catch (error) {
      console.error("IGDB search error:", error);
      res.status(500).json({ error: "Failed to search games" });
    }
  });

  app.get("/api/discover/popular", async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      const games = await igdbService.getPopularGames(limitNum);
      res.json(games);
    } catch (error) {
      console.error("IGDB popular games error:", error);
      res.status(500).json({ error: "Failed to fetch popular games" });
    }
  });

  app.get("/api/discover/recent", async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      const games = await igdbService.getRecentGames(limitNum);
      res.json(games);
    } catch (error) {
      console.error("IGDB recent games error:", error);
      res.status(500).json({ error: "Failed to fetch recent games" });
    }
  });

  app.get("/api/discover/upcoming", async (req, res) => {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string) : 20;
      const games = await igdbService.getUpcomingGames(limitNum);
      res.json(games);
    } catch (error) {
      console.error("IGDB upcoming games error:", error);
      res.status(500).json({ error: "Failed to fetch upcoming games" });
    }
  });

  // Add game from IGDB to user's collection
  app.post("/api/games/add-from-igdb", async (req, res) => {
    try {
      const gameData = insertGameSchema.parse(req.body);
      const game = await storage.createGame(gameData);
      res.status(201).json(game);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid game data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to add game to collection" });
    }
  });

  // Placeholder image endpoint
  app.get("/api/placeholder/:width/:height", (req, res) => {
    const { width, height } = req.params;
    const w = parseInt(width) || 300;
    const h = parseInt(height) || 400;
    
    // Generate a simple SVG placeholder
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="14" fill="#6b7280" text-anchor="middle" dy=".3em">
        ${w} × ${h}
      </text>
    </svg>`;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  });

  const httpServer = createServer(app);

  return httpServer;
}
