import { Request, Router } from "express";
import { storage } from "../storage.js";
import { updateUserSettingsSchema } from "../../shared/schema.js";
import { z } from "zod";
import { authenticateToken } from "../auth.js";
import { sensitiveEndpointLimiter } from "../middleware.js";

export const settingsRouter = Router();

type AuthedRequest = Request & { user?: { id: string } };

// Retrieve user settings
settingsRouter.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
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
    const userId = (req as AuthedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
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
