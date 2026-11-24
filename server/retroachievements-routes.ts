import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { sensitiveEndpointLimiter } from "./middleware.js";
import { AchievementsBusyError, AchievementsUnavailableError } from "./achievement-sync.js";
import { RetroAchievementsAuthError, RetroAchievementsRequestError } from "./retroachievements.js";
import {
  clearRetroAchievements,
  credentialsSchema,
  getRetroAchievementsStatus,
  RetroAchievementsKeyRequiredError,
  saveRetroAchievementsCredentials,
  setRetroAchievementsEnabled,
  syncRetroAchievements,
} from "./retroachievements-sync.js";
import type { User } from "../shared/schema.js";

export const retroAchievementsRoutes = Router();

const enabledSchema = z.object({ enabled: z.boolean() }).strict();

retroAchievementsRoutes.get("/api/retroachievements", authenticateToken, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    return res.json(await getRetroAchievementsStatus((req.user as User).id));
  } catch {
    return res.status(500).json({ error: "Could not load the RetroAchievements status." });
  }
});

retroAchievementsRoutes.put(
  "/api/retroachievements/credentials",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Enter your RetroAchievements username and a Web API key (letters and digits only).",
      });
    }
    const userId = (req.user as User).id;
    try {
      await saveRetroAchievementsCredentials(userId, parsed.data);
      return res.json(await getRetroAchievementsStatus(userId));
    } catch (error) {
      if (error instanceof RetroAchievementsKeyRequiredError) {
        return res.status(400).json({ error: "Enter your RetroAchievements Web API key." });
      }
      if (error instanceof RetroAchievementsAuthError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof RetroAchievementsRequestError) {
        return res.status(502).json({ error: error.message });
      }
      return res.status(500).json({ error: "Could not save the RetroAchievements account." });
    }
  }
);

retroAchievementsRoutes.delete(
  "/api/retroachievements/credentials",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const userId = (req.user as User).id;
    try {
      await clearRetroAchievements(userId);
      return res.json(await getRetroAchievementsStatus(userId));
    } catch {
      return res.status(500).json({ error: "Could not remove the RetroAchievements account." });
    }
  }
);

retroAchievementsRoutes.put(
  "/api/retroachievements",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const parsed = enabledSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Expected { enabled: boolean }." });
    const userId = (req.user as User).id;
    try {
      await setRetroAchievementsEnabled(userId, parsed.data.enabled);
      return res.json(await getRetroAchievementsStatus(userId));
    } catch {
      return res.status(500).json({ error: "Could not save the RetroAchievements setting." });
    }
  }
);

retroAchievementsRoutes.post(
  "/api/retroachievements/sync",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const userId = (req.user as User).id;
    try {
      const status = await getRetroAchievementsStatus(userId);
      if (!status.enabled) {
        return res.status(400).json({ error: "Turn on the RetroAchievements sync first." });
      }
      const result = await syncRetroAchievements(userId, { force: true });
      return res.json({ result, status: await getRetroAchievementsStatus(userId) });
    } catch (error) {
      if (error instanceof AchievementsUnavailableError) {
        return res
          .status(400)
          .json({ error: "Save your RetroAchievements username and Web API key first." });
      }
      if (error instanceof AchievementsBusyError) {
        return res.status(409).json({ error: "A RetroAchievements sync is already running." });
      }
      return res.status(500).json({ error: "Could not sync your RetroAchievements progress." });
    }
  }
);
