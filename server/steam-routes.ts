import { Router } from "express";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import { syncUserSteamWishlist } from "./cron.js";
import { authenticateToken } from "./auth.js";
import { type User } from "@shared/schema";

const router = Router();

// Manual Steam ID Update
router.put("/api/user/steam-id", authenticateToken, async (req, res) => {
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

    res.json({ success: true, steamId });
  } catch (error) {
    console.error("Error setting Steam ID:", error);
    res.status(500).json({ error: "Failed to set Steam ID" });
  }
});

// Sync Wishlist
router.post("/api/steam/wishlist/sync", authenticateToken, async (req, res) => {
  try {
    const user = req.user as User;

    const result = await syncUserSteamWishlist(user.id);

    if (!result) {
      return res.status(400).json({ error: "Steam ID not linked" });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json(result);
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ error: "Sync failed" });
  }
});

export const steamRoutes = router;
