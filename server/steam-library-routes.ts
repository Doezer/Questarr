import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "./auth.js";
import { config } from "./config.js";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import { igdbClient } from "./igdb.js";
import { getContentFilterFlags, isContentFiltered } from "./content-filter.js";
import { normalizeInitialReleaseStatus } from "./game-status.js";
import { insertGameSchema, type User } from "../shared/schema.js";

export const steamLibraryRoutes = Router();
const importing = new Set<string>();
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
    const library = await storage.getUserGames(user.id, true);
    const tracked = new Set(library.map((game) => game.steamAppId));
    const mappings = await igdbClient.getGameIdsBySteamAppIds(ids.filter((id) => !tracked.has(id)));
    const byIgdb = new Map(
      library.filter((game) => game.igdbId != null).map((game) => [game.igdbId!, game])
    );
    const newIgdbIds = [...new Set(mappings.values())].filter((id) => !byIgdb.has(id));
    const [details, filterFlags] = await Promise.all([
      igdbClient.getGamesByIds(newIgdbIds),
      getContentFilterFlags(user.id),
    ]);
    const detailsById = new Map(details.map((game) => [game.id, game]));
    const results: Array<{
      steamAppId: number;
      title: string;
      outcome: "added" | "duplicate" | "not_found" | "failed";
    }> = [];
    for (const id of ids) {
      const game = byAppId.get(id)!;
      if (tracked.has(id)) {
        results.push({ ...game, outcome: "duplicate" });
        continue;
      }
      const igdbId = mappings.get(id);
      if (!igdbId) {
        results.push({ ...game, outcome: "not_found" });
        continue;
      }
      try {
        const existing = byIgdb.get(igdbId);
        if (existing) {
          // Link an exact match once so later previews recognize it. Never replace
          // another edition's App ID or alter the existing game's status/progress.
          if (existing.steamAppId == null) {
            await storage.updateGame(existing.id, { steamAppId: id });
            existing.steamAppId = id;
          }
          results.push({ ...game, outcome: "duplicate" });
          continue;
        }
        const detail = detailsById.get(igdbId);
        if (!detail) {
          results.push({ ...game, outcome: "not_found" });
          continue;
        }
        const data = insertGameSchema.parse({
          ...igdbClient.formatGameData(detail),
          userId: user.id,
          igdbId,
          steamAppId: id,
          status: "owned",
          source: "steam",
        });
        if (isContentFiltered(data, filterFlags)) {
          results.push({ ...game, outcome: "not_found" });
          continue;
        }
        const added = await storage.addGame(normalizeInitialReleaseStatus(data));
        byIgdb.set(igdbId, added);
        results.push({ ...game, outcome: "added" });
      } catch {
        // Keep successful rows and let the user retry only failures. Never log provider URLs/keys.
        results.push({ ...game, outcome: "failed" });
      }
    }
    return res.json({ results });
  } catch {
    return res
      .status(502)
      .json({ error: "Steam library import unavailable. Preview your library and try again." });
  } finally {
    importing.delete(user.id);
  }
});
