import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "./storage.js";
import { config } from "./config.js";
import { steamService, type SteamAchievement } from "./steam.js";
import { routesLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { appriseClient } from "./apprise.js";
import { resolvePrefs } from "./notification-prefs.js";
import { OWNED_GAME_STATUSES, type Game, type Notification } from "../shared/schema.js";

/**
 * Steam achievements sync.
 *
 * For every game with a Steam app id that is owned or being played, the sync reads the user's
 * achievements from Steam and stores the totals (unlocked / total) and the rarest unlock in
 * `game_achievement_progress`. A game whose count went up since the previous sync produces one
 * notification for the run. The first sync of a game only records the baseline, so existing
 * achievements never flood the user with notifications.
 *
 * The per-user switch and last-run status live in `systemConfig` (one JSON document per user),
 * like the Steam play-time sync, so they need no extra table.
 */

/** Never sync one account more often than this, whatever triggers the run. */
export const STEAM_ACHIEVEMENTS_MIN_GAP_MS = 30 * 60 * 1000;

const PROVIDER = "steam";

const stateSchema = z.object({
  enabled: z.boolean().default(false),
  /** Bumped on every toggle so a run started before it cannot write a stale result. */
  epoch: z.number().int().nonnegative().default(0),
  lastSyncAt: z.number().nullable().default(null),
  lastGamesSynced: z.number().int().nonnegative().default(0),
  lastNewUnlocks: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
});
type State = z.infer<typeof stateSchema>;

export interface SteamAchievementsStatus {
  /** The server has a Steam API key and the user saved a Steam ID. */
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

export interface SteamAchievementsResult {
  gamesSynced: number;
  newUnlocks: number;
}

export class SteamAchievementsUnavailableError extends Error {}
export class SteamAchievementsBusyError extends Error {}

const running = new Set<string>();

/** The user's saved switch and last-run status, read leniently: damaged JSON means defaults. */
async function readState(userId: string): Promise<State> {
  const raw = await storage.getSystemConfig(`steam.achievements.${userId}`);
  try {
    return stateSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return stateSchema.parse({});
  }
}

const writeState = (userId: string, state: State) =>
  storage.setSystemConfig(`steam.achievements.${userId}`, JSON.stringify(state));

export async function getSteamAchievementsStatus(userId: string): Promise<SteamAchievementsStatus> {
  const [state, user] = await Promise.all([readState(userId), storage.getUser(userId)]);
  return {
    available: config.steam.isConfigured && Boolean(user?.steamId64),
    enabled: state.enabled,
    lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    lastGamesSynced: state.lastGamesSynced,
    lastNewUnlocks: state.lastNewUnlocks,
    lastError: state.lastError,
  };
}

export async function setSteamAchievementsEnabled(userId: string, enabled: boolean): Promise<void> {
  const state = await readState(userId);
  if (state.enabled === enabled) return;
  await writeState(userId, {
    ...state,
    enabled,
    epoch: state.epoch + 1,
    lastSyncAt: null,
    lastGamesSynced: 0,
    lastNewUnlocks: 0,
    lastError: null,
  });
}

/** What the stored row for one game is made of, worked out from Steam's list. */
export function summarizeAchievements(achievements: SteamAchievement[]) {
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

/**
 * Sync one user. `force` ignores the minimum gap (the "Sync now" button). A game Steam cannot
 * read (no achievements, private details) is skipped; a failure on one game never stops the rest.
 */
export async function syncSteamAchievements(
  userId: string,
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {}
): Promise<SteamAchievementsResult> {
  if (running.has(userId)) throw new SteamAchievementsBusyError();
  running.add(userId);
  let changed = false;
  try {
    const user = await storage.getUser(userId);
    if (!config.steam.isConfigured || !user?.steamId64)
      throw new SteamAchievementsUnavailableError();

    const state = await readState(userId);
    if (
      !force &&
      state.lastSyncAt &&
      now.getTime() - state.lastSyncAt < STEAM_ACHIEVEMENTS_MIN_GAP_MS
    ) {
      return { gamesSynced: 0, newUnlocks: 0 };
    }

    const [games, stored] = await Promise.all([
      storage.getUserGames(userId, true),
      storage.getUserAchievementProgress(userId),
    ]);
    const previous = new Map(
      stored.filter((r) => r.provider === PROVIDER).map((r) => [r.gameId, r])
    );

    let gamesSynced = 0;
    let failed = 0;
    const unlockedNow: { title: string; added: number }[] = [];
    for (const game of games.filter(isTracked)) {
      let summary: ReturnType<typeof summarizeAchievements>;
      try {
        const achievements = await steamService.getPlayerAchievements(
          config.steam.apiKey!,
          user.steamId64,
          game.steamAppId!
        );
        if (achievements.length === 0) continue;
        summary = summarizeAchievements(achievements);
        await storage.upsertAchievementProgress({
          gameId: game.id,
          userId,
          provider: PROVIDER,
          ...summary,
          syncedAt: now,
        });
      } catch {
        // Do not log the error: Steam request URLs contain the API key. A game deleted while its
        // request was pending also lands here and must not stop the others.
        failed++;
        continue;
      }
      changed = true;
      gamesSynced++;
      const before = previous.get(game.id);
      if (before && summary.unlocked > before.unlocked) {
        unlockedNow.push({ title: game.title, added: summary.unlocked - before.unlocked });
      }
    }

    const newUnlocks = unlockedNow.reduce((sum, g) => sum + g.added, 0);
    // The sync was turned on or off meanwhile: the user's choice wins over this run's status.
    const latest = await readState(userId);
    if (latest.epoch === state.epoch) {
      await writeState(userId, {
        ...latest,
        lastSyncAt: now.getTime(),
        lastGamesSynced: gamesSynced,
        lastNewUnlocks: newUnlocks,
        lastError:
          failed > 0 && gamesSynced === 0
            ? "Could not read your Steam achievements. Check the API key and make Game details public."
            : null,
      });
    }
    if (newUnlocks > 0) await notifyUnlocks(userId, unlockedNow, newUnlocks);
    return { gamesSynced, newUnlocks };
  } finally {
    running.delete(userId);
    if (changed) notifyUser("achievementsUpdated", { source: "steam" }, userId);
  }
}

async function notifyUnlocks(
  userId: string,
  games: { title: string; added: number }[],
  total: number
): Promise<void> {
  try {
    const prefs = resolvePrefs(await storage.getUserSettings(userId));
    const { inApp, apprise } = prefs.achievementUnlocked;
    if (!inApp && !apprise) return;
    const first = games[0]!;
    const message =
      games.length === 1
        ? `${first.added} new achievement${first.added === 1 ? "" : "s"} unlocked in ${first.title}.`
        : `${total} new achievements unlocked across ${games.length} games, including ${first.title}.`;
    const content = {
      userId,
      type: "success" as const,
      title: "Achievements unlocked",
      message,
      link: "/stats",
    };
    // The in-app switch only controls the stored row and the live event; Apprise has its own.
    const notification = inApp
      ? await storage.addNotification(content)
      : ({ id: randomUUID(), read: false, createdAt: new Date(), ...content } as Notification);
    if (inApp) notifyUser("notification", notification, notification.userId);
    if (apprise) void appriseClient.send(notification);
  } catch {
    routesLogger.warn({ userId }, "Could not send the achievements notification");
  }
}

/** Scheduled run: every user who turned the sync on. A failure for one never stops the others. */
export async function runScheduledSteamAchievementsSync(): Promise<void> {
  if (!config.steam.isConfigured) return;
  for (const user of await storage.getAllUsers()) {
    if (!user.steamId64) continue;
    try {
      if (!(await readState(user.id)).enabled) continue;
      await syncSteamAchievements(user.id);
    } catch (error) {
      if (error instanceof SteamAchievementsBusyError) continue;
      routesLogger.warn({ userId: user.id }, "Steam achievements sync failed");
    }
  }
}
