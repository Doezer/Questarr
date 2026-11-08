import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { sensitiveEndpointLimiter } from "./middleware.js";
import {
  getSteamPlaytimeStatus,
  setSteamPlaytimeEnabled,
  syncSteamPlaytime,
  SteamPlaytimeBusyError,
  SteamPlaytimeUnavailableError,
} from "./steam-playtime.js";
import type { User } from "../shared/schema.js";

export const steamPlaytimeRoutes = Router();

const bodySchema = z.object({ enabled: z.boolean() }).strict();

steamPlaytimeRoutes.get("/api/steam/playtime", authenticateToken, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    return res.json(await getSteamPlaytimeStatus((req.user as User).id));
  } catch {
    return res.status(500).json({ error: "Could not load the Steam play-time status." });
  }
});

steamPlaytimeRoutes.put(
  "/api/steam/playtime",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Expected { enabled: boolean }." });
    try {
      const userId = (req.user as User).id;
      await setSteamPlaytimeEnabled(userId, parsed.data.enabled);
      return res.json(await getSteamPlaytimeStatus(userId));
    } catch {
      return res.status(500).json({ error: "Could not save the Steam play-time setting." });
    }
  }
);

steamPlaytimeRoutes.post(
  "/api/steam/playtime/sync",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const userId = (req.user as User).id;
    try {
      const status = await getSteamPlaytimeStatus(userId);
      if (!status.enabled) {
        return res.status(400).json({ error: "Turn on the Steam play-time sync first." });
      }
      const result = await syncSteamPlaytime(userId, { force: true });
      return res.json({ result, status: await getSteamPlaytimeStatus(userId) });
    } catch (error) {
      if (error instanceof SteamPlaytimeUnavailableError) {
        return res
          .status(400)
          .json({ error: "Configure STEAM_API_KEY on the server and save your Steam ID first." });
      }
      if (error instanceof SteamPlaytimeBusyError) {
        return res.status(409).json({ error: "A Steam play-time sync is already running." });
      }
      return res.status(502).json({
        error: error instanceof Error ? error.message : "Could not sync your Steam play time.",
        status: await getSteamPlaytimeStatus(userId).catch(() => null),
      });
    }
  }
);
