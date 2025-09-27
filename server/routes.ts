import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { igdbClient } from "./igdb";
import { insertGameSchema, updateGameStatusSchema } from "@shared/schema";
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

  const httpServer = createServer(app);
  return httpServer;
}
