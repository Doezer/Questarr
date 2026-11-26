import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "./storage.js";
import { routesLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { appriseClient } from "./apprise.js";
import { resolvePrefs } from "./notification-prefs.js";
import type { Game, Notification } from "../shared/schema.js";

/**
 * Achievement sync engine shared by every provider (Steam, RetroAchievements, ...).
 *
 * A provider is a small adapter: it says whether it can run for a user, which account the
 * progress belongs to, and reads the progress of the user's games. The engine owns everything
 * else: the per-user switch and last-run status (one JSON document per user in `systemConfig`),
 * the minimum gap between runs, storing the rows in `game_achievement_progress` and the
 * notification for new unlocks. The first sync of a game only records its baseline, so existing
 * achievements never flood the user with notifications.
 */

/** Never sync one account more often than this, whatever triggers the run. */
export const ACHIEVEMENTS_MIN_GAP_MS = 30 * 60 * 1000;

/** What the stored row for one game is made of. */
export interface ProgressSummary {
  unlocked: number;
  total: number;
  rarestName: string | null;
  rarestPercent: number | null;
  lastUnlockedAt: Date | null;
}

export interface ProviderCollectResult {
  entries: { game: Game; summary: ProgressSummary }[];
  /** Games the provider could not read. A failure on one game never stops the others. */
  failed: number;
  /**
   * Games the provider read successfully and found no progress for (for example a game whose
   * target platform changed). Their stored rows are removed.
   */
  dropped?: string[];
}

export interface AchievementProvider {
  /** Stored in `game_achievement_progress.provider`. */
  readonly id: string;
  /** Shown in messages, e.g. "Steam". */
  readonly label: string;
  /** Shown when every game failed. */
  readonly failureMessage: string;
  /** `systemConfig` key of the user's switch and last-run status. */
  stateKey(userId: string): string;
  /** The provider has everything it needs for this user (credentials, account id). */
  isAvailable(userId: string): Promise<boolean>;
  /**
   * The account the progress belongs to. When it changes during a run, the run's counts belong
   * to the old account and are dropped.
   */
  identity(userId: string): Promise<string | null>;
  /** Users the scheduled run should look at. */
  scheduledUserIds(): Promise<string[]>;
  collect(userId: string, games: Game[]): Promise<ProviderCollectResult>;
}

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

export interface AchievementsStatus {
  /** The provider has what it needs to sync for this user. */
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

export interface AchievementsResult {
  gamesSynced: number;
  newUnlocks: number;
}

export class AchievementsUnavailableError extends Error {}
export class AchievementsBusyError extends Error {}

/** The user's saved switch and last-run status, read leniently: damaged JSON means defaults. */
async function readState(provider: AchievementProvider, userId: string): Promise<State> {
  const raw = await storage.getSystemConfig(provider.stateKey(userId));
  try {
    return stateSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return stateSchema.parse({});
  }
}

const writeState = (provider: AchievementProvider, userId: string, state: State) =>
  storage.setSystemConfig(provider.stateKey(userId), JSON.stringify(state));

export async function getAchievementsStatus(
  provider: AchievementProvider,
  userId: string
): Promise<AchievementsStatus> {
  const [state, available] = await Promise.all([
    readState(provider, userId),
    provider.isAvailable(userId),
  ]);
  return {
    available,
    enabled: state.enabled,
    lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    lastGamesSynced: state.lastGamesSynced,
    lastNewUnlocks: state.lastNewUnlocks,
    lastError: state.lastError,
  };
}

/** Turn the sync on or off. For callers that already hold the user's commit lock. */
export async function setAchievementsEnabledUnlocked(
  provider: AchievementProvider,
  userId: string,
  enabled: boolean
): Promise<void> {
  const state = await readState(provider, userId);
  if (state.enabled === enabled) return;
  await writeState(provider, userId, {
    ...state,
    enabled,
    epoch: state.epoch + 1,
    lastSyncAt: null,
    lastGamesSynced: 0,
    lastNewUnlocks: 0,
    lastError: null,
  });
}

/** Turn the sync on or off; never in the middle of a sync run's commit, which would undo it. */
export const setAchievementsEnabled = (
  provider: AchievementProvider,
  userId: string,
  enabled: boolean
): Promise<void> =>
  withCommitLock(provider, userId, () => setAchievementsEnabledUnlocked(provider, userId, enabled));

/** Forget the last run, so the next sync of a changed account records a fresh baseline. */
export async function resetAchievementsRun(
  provider: AchievementProvider,
  userId: string
): Promise<void> {
  const state = await readState(provider, userId);
  await writeState(provider, userId, {
    ...state,
    epoch: state.epoch + 1,
    lastSyncAt: null,
    lastGamesSynced: 0,
    lastNewUnlocks: 0,
    lastError: null,
  });
}

const running = new Set<string>();

const commitLocks = new Map<string, Promise<unknown>>();

/**
 * Run `task` while no other commit or account change of the same user and provider runs. Sync
 * runs hold it only while they write, never while they wait for the provider.
 */
export function withCommitLock<T>(
  provider: AchievementProvider,
  userId: string,
  task: () => Promise<T>
): Promise<T> {
  const key = `${provider.id}:${userId}`;
  const result = (commitLocks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  commitLocks.set(key, tail);
  void tail.then(() => {
    if (commitLocks.get(key) === tail) commitLocks.delete(key);
  });
  return result;
}

/**
 * Sync one user. `force` ignores the minimum gap (the "Sync now" button). A failure on one game
 * never stops the rest.
 */
export async function syncAchievements(
  provider: AchievementProvider,
  userId: string,
  {
    force = false,
    now = new Date(),
    requireEnabled = false,
  }: { force?: boolean; now?: Date; requireEnabled?: boolean } = {}
): Promise<AchievementsResult> {
  const lock = `${provider.id}:${userId}`;
  if (running.has(lock)) throw new AchievementsBusyError();
  running.add(lock);
  let changed = false;
  try {
    // The baseline (availability, epoch, identity, stored rows) is read under the commit lock: a
    // removal or a replacement either finished before this snapshot (and is seen) or runs after
    // the commit below (and deletes what it writes). Collection itself stays outside the lock.
    const snapshot = await withCommitLock(provider, userId, async () => {
      if (!(await provider.isAvailable(userId))) throw new AchievementsUnavailableError();
      const state = await readState(provider, userId);
      // Turned off after the caller looked: nothing is fetched or written.
      if (requireEnabled && !state.enabled) return null;
      if (
        !force &&
        state.lastSyncAt &&
        now.getTime() - state.lastSyncAt < ACHIEVEMENTS_MIN_GAP_MS
      ) {
        return null;
      }
      const startIdentity = await provider.identity(userId);
      const [games, stored] = await Promise.all([
        storage.getUserGames(userId, true),
        storage.getUserAchievementProgress(userId),
      ]);
      return { state, startIdentity, games, stored };
    });
    if (!snapshot) return { gamesSynced: 0, newUnlocks: 0 };
    const { state, startIdentity, games, stored } = snapshot;
    const previous = new Map(
      stored.filter((r) => r.provider === provider.id).map((r) => [r.gameId, r])
    );

    const { entries, failed, dropped: dropIds } = await provider.collect(userId, games);

    // The account changed during the run: these counts belong to the old account.
    const sameAccount = (await provider.identity(userId)) === startIdentity;
    const unlockedNow: { title: string; added: number }[] = [];
    let gamesSynced = 0;
    let stale = !sameAccount;
    // The commit holds the user's lock, as does every account change: a reset or a removal either
    // finishes before the epoch check below (and the run is dropped) or waits for the writes, then
    // deletes them. No row of an old account can land after the cleanup.
    await withCommitLock(provider, userId, async () => {
      const latest = await readState(provider, userId);
      // The sync was turned on or off, or the account changed meanwhile: the user's choice wins.
      if (latest.epoch !== state.epoch) stale = true;
      if (stale) return;
      const dropped = (dropIds ?? []).filter((id) => previous.has(id));
      if (dropped.length > 0) {
        await storage.deleteAchievementProgress(userId, provider.id, dropped);
        changed = true;
      }
      for (const { game, summary } of entries) {
        try {
          await storage.upsertAchievementProgress({
            gameId: game.id,
            userId,
            provider: provider.id,
            ...summary,
            syncedAt: now,
          });
        } catch {
          // A game deleted while the request was pending lands here and must not stop the others.
          continue;
        }
        changed = true;
        gamesSynced++;
        const before = previous.get(game.id);
        if (before && summary.unlocked > before.unlocked) {
          unlockedNow.push({ title: game.title, added: summary.unlocked - before.unlocked });
        }
      }
      await writeState(provider, userId, {
        ...latest,
        lastSyncAt: now.getTime(),
        lastGamesSynced: gamesSynced,
        lastNewUnlocks: unlockedNow.reduce((sum, g) => sum + g.added, 0),
        lastError: failed > 0 && gamesSynced === 0 ? provider.failureMessage : null,
      });
    });
    const newUnlocks = unlockedNow.reduce((sum, g) => sum + g.added, 0);
    if (newUnlocks > 0 && !stale) await notifyUnlocks(userId, unlockedNow, newUnlocks);
    return { gamesSynced, newUnlocks };
  } finally {
    running.delete(lock);
    if (changed) notifyUser("achievementsUpdated", { source: provider.id }, userId);
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
export async function runScheduledAchievementsSync(provider: AchievementProvider): Promise<void> {
  for (const userId of await provider.scheduledUserIds()) {
    try {
      if (!(await readState(provider, userId)).enabled) continue;
      await syncAchievements(provider, userId, { requireEnabled: true });
    } catch (error) {
      if (error instanceof AchievementsBusyError) continue;
      routesLogger.warn({ userId }, `${provider.label} achievements sync failed`);
    }
  }
}
