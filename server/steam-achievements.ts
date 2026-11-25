import { storage } from "./storage.js";
import { config } from "./config.js";
import { steamService, type SteamAchievement } from "./steam.js";
import {
  AchievementsBusyError,
  AchievementsUnavailableError,
  getAchievementsStatus,
  runScheduledAchievementsSync,
  setAchievementsEnabled,
  syncAchievements,
  ACHIEVEMENTS_MIN_GAP_MS,
  type AchievementProvider,
  type AchievementsResult,
  type AchievementsStatus,
  type ProgressSummary,
} from "./achievement-sync.js";
import { OWNED_GAME_STATUSES, type Game } from "../shared/schema.js";

/**
 * Steam provider of the achievement sync (see `achievement-sync.ts` for the shared rules).
 *
 * For every game with a Steam app id that is owned or being played, it reads the user's
 * achievements from Steam and summarizes them: unlocked / total and the rarest unlock. A game
 * Steam cannot read (no achievements, private Game details) is skipped.
 */

export const STEAM_ACHIEVEMENTS_MIN_GAP_MS = ACHIEVEMENTS_MIN_GAP_MS;

export type SteamAchievementsStatus = AchievementsStatus;
export type SteamAchievementsResult = AchievementsResult;
export const SteamAchievementsUnavailableError = AchievementsUnavailableError;
export const SteamAchievementsBusyError = AchievementsBusyError;

/** What the stored row for one game is made of, worked out from Steam's list. */
export function summarizeAchievements(achievements: SteamAchievement[]): ProgressSummary {
  const unlocked = achievements.filter((a) => a.achieved);
  let rarest: SteamAchievement | null = null;
  for (const a of unlocked) {
    if (a.globalPercent === null) continue;
    if (!rarest || a.globalPercent < (rarest.globalPercent ?? Infinity)) rarest = a;
  }
  const times = unlocked.map((a) => a.unlockedAt).filter((t): t is number => t !== null);
  return {
    unlocked: unlocked.length,
    total: achievements.length,
    rarestName: rarest?.displayName ?? null,
    rarestPercent: rarest?.globalPercent ?? null,
    lastUnlockedAt: times.length > 0 ? new Date(Math.max(...times)) : null,
  };
}

const isTracked = (game: Game) =>
  game.steamAppId != null && (game.status === "playing" || OWNED_GAME_STATUSES.has(game.status));

export const steamProvider: AchievementProvider = {
  id: "steam",
  label: "Steam",
  failureMessage:
    "Could not read your Steam achievements. Check the API key and make Game details public.",
  stateKey: (userId) => `steam.achievements.${userId}`,

  async isAvailable(userId) {
    const user = await storage.getUser(userId);
    return config.steam.isConfigured && Boolean(user?.steamId64);
  },

  async identity(userId) {
    return (await storage.getUser(userId))?.steamId64 ?? null;
  },

  async scheduledUserIds() {
    if (!config.steam.isConfigured) return [];
    return (await storage.getAllUsers()).filter((u) => u.steamId64).map((u) => u.id);
  },

  async collect(userId, games) {
    const steamId = (await storage.getUser(userId))?.steamId64;
    const entries: { game: Game; summary: ProgressSummary }[] = [];
    let failed = 0;
    if (!steamId) return { entries, failed };
    for (const game of games.filter(isTracked)) {
      try {
        const achievements = await steamService.getPlayerAchievements(
          config.steam.apiKey!,
          steamId,
          game.steamAppId!,
          { throwIfPrivate: true }
        );
        if (achievements.length === 0) continue; // the game has no achievements
        entries.push({ game, summary: summarizeAchievements(achievements) });
      } catch {
        // Do not log the error: Steam request URLs contain the API key.
        failed++;
      }
    }
    return { entries, failed };
  },
};

export const getSteamAchievementsStatus = (userId: string) =>
  getAchievementsStatus(steamProvider, userId);

export const setSteamAchievementsEnabled = (userId: string, enabled: boolean) =>
  setAchievementsEnabled(steamProvider, userId, enabled);

export const syncSteamAchievements = (
  userId: string,
  options?: { force?: boolean; now?: Date }
): Promise<AchievementsResult> => syncAchievements(steamProvider, userId, options);

export const runScheduledSteamAchievementsSync = () => runScheduledAchievementsSync(steamProvider);
