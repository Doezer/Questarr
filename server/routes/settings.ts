import { Router } from "express";
import { storage } from "../storage.js";
import { updateUserSettingsSchema } from "../../shared/schema.js";
import { z } from "zod";
import { authenticateToken } from "../auth.js";
import { sensitiveEndpointLimiter } from "../middleware.js";

export const settingsRouter = Router();

// Retrieve user settings
settingsRouter.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const settings = await storage.getUserSettings(userId);

    if (!settings) {
      const newSettings = await storage.createUserSettings({ userId });
      return res.json(newSettings);
    }

    res.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update user settings
settingsRouter.patch("/", authenticateToken, sensitiveEndpointLimiter, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const settings = await storage.getUserSettings(userId);

    if (!settings) {
      return res.status(404).json({ error: "Settings not found" });
    }

    const updates = updateUserSettingsSchema.parse(req.body);
    const updated = await storage.updateUserSettings(settings.id, updates);

    res.json({ success: true, settings: updated, successMessage: "Settings updated successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid settings data", details: error.errors });
    }
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update IGDB credentials (System Config)
settingsRouter.post("/igdb", authenticateToken, sensitiveEndpointLimiter, async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: "Client ID and Secret required" });
    }

    await storage.setSystemConfig("igdb.clientId", clientId);
    await storage.setSystemConfig("igdb.clientSecret", clientSecret);

    res.json({ success: true, message: "IGDB credentials updated" });
  } catch (error) {
    console.error("Error updating IGDB config:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update xREL settings (User Settings subset)
settingsRouter.patch("/xrel", authenticateToken, sensitiveEndpointLimiter, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { apiBase, xrelSceneReleases, xrelP2pReleases } = req.body;

    if (apiBase) {
      await storage.setSystemConfig("xrel_api_base", apiBase);
    }

    const settings = await storage.getUserSettings(userId);
    if (settings) {
      await storage.updateUserSettings(settings.id, {
        xrelSceneReleases,
        xrelP2pReleases,
      });
    }

    res.json({ success: true, message: "xREL settings updated" });
  } catch (error) {
    console.error("Error updating xREL settings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
