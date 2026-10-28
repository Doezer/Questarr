import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { config } from "./config.js";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import type { User } from "../shared/schema.js";
import {
  importSteamLibraryBatch,
  steamLibraryImporting as importing,
} from "./steam-library-import.js";
import {
  getSteamLibraryJob,
  startSteamLibraryJob,
  retrySteamLibraryJob,
  steamLibrarySelectionSchema,
  SteamLibraryBusyError,
} from "./steam-library-jobs.js";

export const steamLibraryRoutes = Router();
const selectionSchema = z
  .object({
    appIds: z
      .array(
        z
          .number()
          .int()
          .positive()
          .max(2 ** 31 - 1)
      )
      .min(1)
      .max(50),
  })
  .strict();

// Progress remains readable even if the Steam configuration changes during a job.
steamLibraryRoutes.get(
  "/api/steam/library/import/jobs/current",
  authenticateToken,
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      return res.json({ job: await getSteamLibraryJob((req.user as User).id) });
    } catch {
      return res.status(500).json({ error: "Could not load import progress." });
    }
  }
);

steamLibraryRoutes.use("/api/steam/library", authenticateToken, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!config.steam.isConfigured) {
    return res.status(400).json({ error: "Configure STEAM_API_KEY on the server first." });
  }
  if (!(req.user as User).steamId64) {
    return res.status(400).json({ error: "Save your Steam ID in Settings first." });
  }
  return next();
});

steamLibraryRoutes.post("/api/steam/library/import/jobs", async (req, res) => {
  const parsed = steamLibrarySelectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select between 1 and 20,000 games." });
  try {
    return res
      .status(202)
      .json({ job: await startSteamLibraryJob(req.user as User, parsed.data.appIds) });
  } catch (error) {
    return res.status(error instanceof SteamLibraryBusyError ? 409 : 500).json({
      error:
        error instanceof SteamLibraryBusyError
          ? "An import is already running. Follow its progress below."
          : "Could not start the import. Try again.",
    });
  }
});

steamLibraryRoutes.post("/api/steam/library/import/jobs/retry", async (req, res) => {
  try {
    const job = await retrySteamLibraryJob(req.user as User);
    return job
      ? res.status(202).json({ job })
      : res.status(400).json({ error: "No unfinished games to retry." });
  } catch (error) {
    return res.status(error instanceof SteamLibraryBusyError ? 409 : 500).json({
      error:
        error instanceof SteamLibraryBusyError
          ? "An import is already running."
          : "Could not retry the import. Try again.",
    });
  }
});

steamLibraryRoutes.get("/api/steam/library", async (req, res) => {
  try {
    const user = req.user as User;
    const [games, library] = await Promise.all([
      steamService.getOwnedGames(config.steam.apiKey!, user.steamId64!),
      storage.getUserGames(user.id, true),
    ]);
    const tracked = new Set(library.map((game) => game.steamAppId));
    return res.json({
      games: games.map((game) => ({
        ...game,
        alreadyTracked: tracked.has(game.steamAppId),
      })),
    });
  } catch {
    return res.status(502).json({
      error:
        "Could not read your Steam library. Check STEAM_API_KEY and public Game details, then retry.",
    });
  }
});

steamLibraryRoutes.post("/api/steam/library/import", async (req, res) => {
  const selection = selectionSchema.safeParse(req.body);
  if (!selection.success) {
    return res.status(400).json({ error: "Select between 1 and 50 Steam app IDs." });
  }
  const user = req.user as User;
  if (importing.has(user.id)) {
    return res.status(409).json({ error: "A Steam library import is already running." });
  }
  importing.add(user.id);
  try {
    // Revalidate ownership server-side; never trust a client-supplied title or IGDB mapping.
    const owned = await steamService.getOwnedGames(config.steam.apiKey!, user.steamId64!);
    const byAppId = new Map(owned.map((game) => [game.steamAppId, game]));
    const ids = [...new Set(selection.data.appIds)];
    if (ids.some((id) => !byAppId.has(id))) {
      return res.status(400).json({
        error: "Selection changed or contains a game not in your Steam library. Preview again.",
      });
    }
    const results = await importSteamLibraryBatch(
      user.id,
      ids.map((id) => byAppId.get(id)!)
    );
    return res.json({ results });
  } catch {
    return res
      .status(502)
      .json({ error: "Steam library import unavailable. Preview your library and try again." });
  } finally {
    importing.delete(user.id);
  }
});
