import { storage } from "./storage.js";
import { logger } from "./logger.js";
import { normalizeTitle } from "../shared/title-utils.js";
import type { Game } from "../shared/schema.js";
import { readRommSettings, rommClient, ROMM_CONFIG_KEYS } from "./romm.js";

export interface RommSyncSummary {
  totalRoms: number;
  matched: number;
  alreadyOwned: number;
  markedOwned: number;
  notInLibrary: number;
}

// "wanted" is the only status a RomM file can settle: every other one already says the user
// has the game (or is downloading it), and playing/shelved/completed are the user's own.
const SETTLEABLE_STATUS = "wanted";

/**
 * Pulls the RomM library and marks matching Questarr games as owned. A ROM matches a game by
 * IGDB id first, then by normalized title. Games RomM has and Questarr does not know are only
 * counted; nothing is created, and nothing is ever downgraded.
 */
export async function syncFromRomm(userId: string): Promise<RommSyncSummary> {
  const settings = await readRommSettings();
  if (!settings.enabled || !settings.url || !settings.apiToken) {
    throw new Error("RomM is not configured");
  }

  const roms = await rommClient.listAllRoms(settings);
  const games = await storage.getUserGames(userId, true);
  const byIgdbId = new Map<number, Game>();
  const byTitle = new Map<string, Game>();
  for (const game of games) {
    if (game.igdbId != null) byIgdbId.set(game.igdbId, game);
    const key = normalizeTitle(game.title);
    if (key && !byTitle.has(key)) byTitle.set(key, game);
  }

  const summary: RommSyncSummary = {
    totalRoms: roms.length,
    matched: 0,
    alreadyOwned: 0,
    markedOwned: 0,
    notInLibrary: 0,
  };
  const seen = new Set<string>();

  for (const rom of roms) {
    const game =
      (rom.igdb_id != null ? byIgdbId.get(rom.igdb_id) : undefined) ??
      byTitle.get(normalizeTitle(rom.name));
    if (!game) {
      summary.notInLibrary++;
      continue;
    }
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    summary.matched++;
    if (game.status !== SETTLEABLE_STATUS) {
      summary.alreadyOwned++;
      continue;
    }
    await storage.updateGame(game.id, { status: "owned" });
    summary.markedOwned++;
  }

  await storage.setSystemConfig(ROMM_CONFIG_KEYS.lastSync, new Date().toISOString());
  logger.info(summary, "RomM sync complete");
  return summary;
}

let syncRunning = false;

/** Scheduled entry point: syncs every user when auto-sync is on. Never overlaps itself. */
export async function runScheduledRommSync(): Promise<void> {
  if (syncRunning) return;
  syncRunning = true;
  try {
    const settings = await readRommSettings();
    if (!settings.enabled || !settings.syncEnabled || !settings.apiToken) return;
    for (const user of await storage.getAllUsers()) {
      try {
        await syncFromRomm(user.id);
      } catch (error) {
        logger.warn({ userId: user.id, error }, "Scheduled RomM sync failed");
      }
    }
  } finally {
    syncRunning = false;
  }
}
