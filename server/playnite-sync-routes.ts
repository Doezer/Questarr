import { Router } from "express";
import { authenticateToken } from "./auth.js";
import { storage } from "./storage.js";
import { routesLogger as logger } from "./logger.js";
import { getPlayniteSyncState } from "./playnite-sync-state.js";
import type { User } from "../shared/schema.js";

export const playniteSyncRoutes = Router();

/**
 * Where the library's synced data comes from: when Playnite last sent each kind of data, what
 * failed, and how many game statuses a sync (rather than the user) currently owns, per store.
 */
playniteSyncRoutes.get("/api/playnite/sync", authenticateToken, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const userId = (req.user as User).id;
    const [state, games] = await Promise.all([
      getPlayniteSyncState(userId),
      storage.getUserGames(userId, true),
    ]);
    const syncedStatuses: Record<string, number> = {};
    for (const game of games) {
      if (game.statusSyncSource) {
        syncedStatuses[game.statusSyncSource] = (syncedStatuses[game.statusSyncSource] ?? 0) + 1;
      }
    }
    return res.json({ ...state, syncedStatuses });
  } catch (error) {
    logger.error({ error }, "Could not load the Playnite sync state");
    return res.status(500).json({ error: "Could not load the Playnite sync state." });
  }
});
