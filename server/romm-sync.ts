import { storage } from "./storage.js";
import { logger } from "./logger.js";
import { normalizeTitle } from "../shared/title-utils.js";
import type { Game } from "../shared/schema.js";
import { rommSlugForPlatformId } from "../shared/romm-platforms.js";
import { readRommSettings, rommClient, ROMM_CONFIG_KEYS } from "./romm.js";
import type { RommRom } from "./romm.js";

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
 * The game a ROM settles, or undefined. By IGDB id first (several games can share one: the one
 * whose target platform fits the ROM best wins), then by normalized title for a ROM without an id.
 * A target platform is enforced on a title match, and on an id match when it has a RomM slug.
 */
function matchRomToGame(
  rom: RommRom,
  byIgdbId: Map<number, Game[]>,
  byTitle: Map<string, Game | null>,
  seen: ReadonlySet<string>
): Game | undefined {
  const fits = (game: Game): boolean => {
    if (game.targetPlatformId == null) return true;
    const targetSlug = rommSlugForPlatformId(game.targetPlatformId);
    if (targetSlug === undefined && rom.igdb_id != null) return true;
    return targetSlug === rom.platform_slug;
  };
  if (rom.igdb_id != null) {
    const all = byIgdbId.get(rom.igdb_id) ?? [];
    // Games a previous ROM already settled come last; an exact platform match beats a lenient one.
    const candidates = [
      ...all.filter((g) => !seen.has(g.id)),
      ...all.filter((g) => seen.has(g.id)),
    ];
    const exact = (g: Game) =>
      g.targetPlatformId != null && rommSlugForPlatformId(g.targetPlatformId) === rom.platform_slug;
    return candidates.find(exact) ?? candidates.find(fits);
  }
  // Title fallback only without an IGDB id: an original and its remake must not be mixed up.
  const game = rom.name ? byTitle.get(normalizeTitle(rom.name)) : undefined;
  return game && fits(game) ? game : undefined;
}

/**
 * Pulls the RomM library and marks matching Questarr games as owned. A ROM matches a game by
 * IGDB id first, then by normalized title. Games RomM has and Questarr does not know are only
 * counted; nothing is created, and nothing is ever downgraded.
 */
export async function syncFromRomm(
  userId: string,
  preloadedRoms?: RommRom[]
): Promise<RommSyncSummary> {
  const settings = await readRommSettings();
  if (!settings.enabled || !settings.url || !settings.apiToken) {
    throw new Error("RomM is not configured");
  }

  // A scheduled run fetches the shared library once and hands it to every user.
  const roms = preloadedRoms ?? (await rommClient.listAllRoms(settings));
  const games = await storage.getUserGames(userId, true);
  // games.igdbId is not unique: the same title can sit in the library once per platform.
  const byIgdbId = new Map<number, Game[]>();
  // A title shared by several games is ambiguous: it is never used for matching.
  const byTitle = new Map<string, Game | null>();
  for (const game of games) {
    if (game.igdbId != null)
      byIgdbId.set(game.igdbId, [...(byIgdbId.get(game.igdbId) ?? []), game]);
    const key = normalizeTitle(game.title);
    if (key) byTitle.set(key, byTitle.has(key) ? null : game);
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
    const game = matchRomToGame(rom, byIgdbId, byTitle, seen);
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
    // The library was read before the ROM walk: a game that started downloading meanwhile stays.
    const current = await storage.getGame(game.id);
    if (current?.status !== SETTLEABLE_STATUS) {
      summary.alreadyOwned++;
      continue;
    }
    // The status updater also clears the search-availability flags a wanted game carries.
    await storage.updateGameStatus(game.id, { status: "owned" }, { preserveCurated: true });
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
    const users = await storage.getAllUsers();
    if (users.length === 0) return;
    const roms = await rommClient.listAllRoms(settings);
    for (const user of users) {
      try {
        await syncFromRomm(user.id, roms);
      } catch (error) {
        logger.warn({ userId: user.id, error }, "Scheduled RomM sync failed");
      }
    }
  } finally {
    syncRunning = false;
  }
}
