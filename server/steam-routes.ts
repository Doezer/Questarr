import { Router, type Request, type Response } from "express";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import { syncUserSteamWishlist } from "./cron.js";
import { authenticateToken } from "./auth.js";
import { type User } from "@shared/schema";
import { routesLogger } from "./logger.js";
import { config } from "./config.js";
import { sanitizeGameId, validateRequest } from "./middleware.js";

const router = Router();

// Manual Steam ID Update
router.patch("/api/user/steam-id", authenticateToken, async (req, res) => {
  try {
    const { steamId } = req.body;
    const user = req.user as User;

    if (!steamId) {
      return res.status(400).json({ error: "Steam ID is required" });
    }

    if (!steamService.validateSteamId(steamId)) {
      return res
        .status(400)
        .json({ error: "Invalid Steam ID format (must be 17 digits starting with 7656)" });
    }

    await storage.updateUserSteamId(user.id, steamId);

    return res.json({ success: true, steamId });
  } catch (error) {
    routesLogger.error({ error }, "Error setting Steam ID");
    return res.status(500).json({ error: "Failed to set Steam ID" });
  }
});

// Sync Wishlist
router.post("/api/steam/wishlist/sync", authenticateToken, async (req, res) => {
  try {
    const user = req.user as User;

    const result = await syncUserSteamWishlist(user.id, "manual");

    if (!result) {
      return res.status(400).json({ error: "Steam ID not linked" });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json(result);
  } catch (error) {
    routesLogger.error({ error }, "Sync error");
    return res.status(500).json({ error: "Sync failed" });
  }
});

// Player achievements for a game, only available when a Steam Web API key is
// configured server-side, the user has linked a Steam ID, and the game has a
// known Steam App ID. Any missing piece returns an empty list rather than an
// error, so the client can simply hide the section.
router.get(
  "/api/games/:id/achievements",
  authenticateToken,
  sanitizeGameId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      if (!config.steam.isConfigured) {
        return res.json({ achievements: [], reason: "not_configured" });
      }

      const { id } = req.params;
      const user = req.user as User;

      const game = await storage.getGame(id);
      if (!game || game.userId !== user.id) {
        return res.status(404).json({ error: "Game not found" });
      }

      if (!game.steamAppId) {
        return res.json({ achievements: [], reason: "no_steam_app_id" });
      }
      if (!user.steamId64) {
        return res.json({ achievements: [], reason: "no_steam_id" });
      }

      const achievements = await steamService.getPlayerAchievements(
        config.steam.apiKey!,
        user.steamId64,
        game.steamAppId
      );
      return res.json({ achievements });
    } catch (error) {
      routesLogger.error({ error }, "Error fetching Steam achievements");
      return res.status(500).json({ error: "Failed to fetch achievements" });
    }
  }
);

export const steamRoutes = router;
