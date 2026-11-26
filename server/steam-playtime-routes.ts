import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { sensitiveEndpointLimiter } from "./middleware.js";
import {
  getSteamPlaytimeStatus,
  importSteamPlaytime,
  previewSteamPlaytimeImport,
  setSteamPlaytimeEnabled,
  syncSteamPlaytime,
  SteamPlaytimeBusyError,
  SteamPlaytimeUnavailableError,
  SteamPlaytimeUpstreamError,
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
          .json({ error: "Add a Steam Web API key in Settings and save your Steam ID first." });
      }
      if (error instanceof SteamPlaytimeBusyError) {
        return res.status(409).json({ error: "A Steam play-time sync is already running." });
      }
      const upstream = error instanceof SteamPlaytimeUpstreamError;
      return res.status(upstream ? 502 : 500).json({
        error: upstream ? error.message : "Could not sync your Steam play time.",
        status: await getSteamPlaytimeStatus(userId).catch(() => null),
      });
    }
  }
);

function importError(res: import("express").Response, error: unknown) {
  if (error instanceof SteamPlaytimeUnavailableError) {
    return res
      .status(400)
      .json({ error: "Add a Steam Web API key in Settings and save your Steam ID first." });
  }
  if (error instanceof SteamPlaytimeBusyError) {
    return res.status(409).json({ error: "A Steam play-time sync or import is already running." });
  }
  const upstream = error instanceof SteamPlaytimeUpstreamError;
  return res.status(upstream ? 502 : 500).json({
    error: upstream ? error.message : "Could not import your Steam play time.",
  });
}

steamPlaytimeRoutes.get(
  "/api/steam/playtime/import/preview",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      return res.json(await previewSteamPlaytimeImport((req.user as User).id));
    } catch (error) {
      return importError(res, error);
    }
  }
);

const importBodySchema = z
  .object({ gameIds: z.array(z.string().min(1).max(100)).max(5000).optional() })
  .strict();

steamPlaytimeRoutes.post(
  "/api/steam/playtime/import",
  authenticateToken,
  sensitiveEndpointLimiter,
  async (req, res) => {
    const parsed = importBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Expected { gameIds?: string[] }." });
    try {
      return res.json(await importSteamPlaytime((req.user as User).id, parsed.data.gameIds));
    } catch (error) {
      return importError(res, error);
    }
  }
);
