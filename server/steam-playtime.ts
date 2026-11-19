import { z } from "zod";
import { storage } from "./storage.js";
import { config } from "./config.js";
import { steamService } from "./steam.js";
import { routesLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { sessionMinutes } from "../shared/play-stats.js";
import { MIN_PLAYTIME_IMPORT_MINUTES, recordedMinutes } from "./play-status-sync.js";

/**
 * Steam play-time sync.
 *
 * Steam only reports a cumulative `playtime_forever` per game. Each sync compares that total
 * with the one seen last time and records the difference as an estimated play session
 * (`source: "steam"`). The first sync of a game only records the baseline, so no history is
 * invented. Minutes already recorded by hand, by the timer or by Playnite since the previous
 * sync are subtracted so nothing is counted twice, and a game with a running timer is left for
 * the next sync.
 *
 * State lives in `systemConfig` (one JSON document per user), like the Steam import checkpoint,
 * so it needs no table and no migration on either database.
 */

/** Never sync one account more often than this, whatever triggers the run. */
export const STEAM_PLAYTIME_MIN_GAP_MS = 30 * 60 * 1000;

/** How long a deferred window may stay open while Steam reports no growth for the game. */
const STEAM_DEFER_MAX_MS = 24 * 60 * 60 * 1000;

const stateSchema = z.object({
  enabled: z.boolean().default(false),
  /**
   * Bumped whenever the sync is turned on or off. A run that started under an older value must
   * not write its result back: that would undo the user's toggle or restore stale baselines.
   */
  epoch: z.number().int().nonnegative().default(0),
  /** The Steam ID the baselines belong to; another account's totals are never compared with them. */
  steamId: z.string().nullable().default(null),
  /** `steamAppId` → cumulative minutes at the last sync. */
  baselines: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /**
   * Games skipped because a timer was running, with the time their recorded sessions are counted
   * from. Without it, minutes the timer records later would fall before the next window.
   */
  deferred: z.record(z.string(), z.number()).default({}),
  lastSyncAt: z.number().nullable().default(null),
  lastSessionsAdded: z.number().int().nonnegative().default(0),
  lastMinutesAdded: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
});
type State = z.infer<typeof stateSchema>;

export interface SteamPlaytimeStatus {
  /** The server has a Steam API key and the user saved a Steam ID. */
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSessionsAdded: number;
  lastMinutesAdded: number;
  lastError: string | null;
}

export interface SteamPlaytimeResult {
  sessionsAdded: number;
  minutesAdded: number;
  /** Games seen for the first time: their current total became the baseline. */
  baselined: number;
}

export class SteamPlaytimeUnavailableError extends Error {}
export class SteamPlaytimeBusyError extends Error {}
/** Steam could not be read; the message is sanitized and safe to show. */
export class SteamPlaytimeUpstreamError extends Error {}

const key = (userId: string) => `steam.playtime.${userId}`;
const running = new Set<string>();

async function readState(userId: string): Promise<State> {
  const raw = await storage.getSystemConfig(key(userId));
  if (!raw) return stateSchema.parse({});
  try {
    return stateSchema.parse(JSON.parse(raw));
  } catch {
    // A damaged document must not stop the feature: start again from fresh baselines.
    return stateSchema.parse({});
  }
}

async function writeState(userId: string, state: State): Promise<void> {
  await storage.setSystemConfig(key(userId), JSON.stringify(state));
}

/**
 * Save a run's outcome on top of the newest state, unless the sync was turned on or off since the
 * run read it (its result is then stale and the user's choice wins). Returns whether it saved.
 */
async function persistRun(userId: string, epoch: number, patch: Partial<State>): Promise<boolean> {
  return withStateLock(userId, async () => {
    const latest = await readState(userId);
    if (latest.epoch !== epoch) return false;
    await writeState(userId, { ...latest, ...patch });
    return true;
  });
}

const stateQueues = new Map<string, Promise<unknown>>();

/** Run read-modify-write steps on one user's state one after another (single process). */
function withStateLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const run = (stateQueues.get(userId) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => undefined);
  stateQueues.set(userId, tail);
  void tail.then(() => {
    if (stateQueues.get(userId) === tail) stateQueues.delete(userId);
  });
  return run;
}

export async function getSteamPlaytimeStatus(userId: string): Promise<SteamPlaytimeStatus> {
  const [state, user] = await Promise.all([readState(userId), storage.getUser(userId)]);
  return {
    available: config.steam.isConfigured && Boolean(user?.steamId64),
    enabled: state.enabled,
    lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    lastSessionsAdded: state.lastSessionsAdded,
    lastMinutesAdded: state.lastMinutesAdded,
    lastError: state.lastError,
  };
}

/**
 * Turn the sync on or off. Turning it on starts from fresh baselines, so play time from the
 * period it was off is never imported as one large session.
 */
export async function setSteamPlaytimeEnabled(userId: string, enabled: boolean): Promise<void> {
  await withStateLock(userId, async () => {
    const state = await readState(userId);
    if (state.enabled === enabled) return;
    await writeState(userId, {
      ...state,
      enabled,
      epoch: state.epoch + 1,
      baselines: {},
      deferred: {},
      lastSyncAt: null,
      lastSessionsAdded: 0,
      lastMinutesAdded: 0,
      lastError: null,
    });
  });
}

/**
 * Sync one user. `force` ignores the minimum gap (the "Sync now" button). Errors from Steam are
 * remembered in the state (without URLs: they can carry the API key) and rethrown generically.
 */
export async function syncSteamPlaytime(
  userId: string,
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {}
): Promise<SteamPlaytimeResult> {
  if (running.has(userId)) throw new SteamPlaytimeBusyError();
  running.add(userId);
  // Sessions inserted so far: any exit after the first insert (stale run, error) still changes
  // what open pages show, so the notification is sent from `finally`.
  let inserted = 0;
  let statusSaved = false;
  try {
    const user = await storage.getUser(userId);
    if (!config.steam.isConfigured || !user?.steamId64) throw new SteamPlaytimeUnavailableError();

    const stored = await readState(userId);
    // The user linked another Steam account: its totals must not be compared with the old one's.
    const state: State =
      stored.steamId === user.steamId64
        ? stored
        : { ...stored, steamId: user.steamId64, baselines: {}, deferred: {}, lastSyncAt: null };
    if (
      !force &&
      state.lastSyncAt &&
      now.getTime() - state.lastSyncAt < STEAM_PLAYTIME_MIN_GAP_MS
    ) {
      return { sessionsAdded: 0, minutesAdded: 0, baselined: 0 };
    }

    let totals: Map<number, number>;
    try {
      totals = await steamService.getOwnedPlaytimes(config.steam.apiKey!, user.steamId64);
    } catch (error) {
      // Do not log the error: Steam request URLs contain the API key.
      const message =
        error instanceof Error && error.message.startsWith("Steam library unavailable")
          ? error.message
          : "Could not read your Steam play time. Check the API key and make Game details public.";
      statusSaved = await persistRun(userId, state.epoch, { lastError: message });
      throw new SteamPlaytimeUpstreamError(message, { cause: error });
    }

    const sinceMs = state.lastSyncAt ?? 0;
    const [games, runningTimer] = await Promise.all([
      storage.getUserGames(userId, true),
      storage.getRunningPlaySession(userId),
    ]);
    // Games with a finished session that is not Steam's own, ended after the last sync. Loaded
    // once: a per-game query for every unchanged game would cost one query per library entry.
    const recordedSince = new Set(
      (await storage.getUserPlaySessions(userId))
        .filter(
          (s) =>
            s.source !== "steam" &&
            s.source !== "steam_import" &&
            s.endedAt &&
            s.endedAt.getTime() > sinceMs
        )
        .map((s) => s.gameId)
    );

    const baselines: Record<string, number> = {};
    const deferred: Record<string, number> = {};
    let sessionsAdded = 0;
    let minutesAdded = 0;
    let baselined = 0;

    for (const game of games) {
      if (game.steamAppId == null) continue;
      const appKey = String(game.steamAppId);
      const total = totals.get(game.steamAppId);
      // Not in the account any more (refund, family share ended): keep the old baseline so a
      // return does not look like a fresh game.
      if (total === undefined) {
        const kept = state.baselines[appKey];
        if (kept !== undefined) baselines[appKey] = kept;
        continue;
      }
      const previous = state.baselines[appKey];
      if (previous === undefined) {
        baselines[appKey] = total;
        baselined++;
        continue;
      }
      const delta = total - previous;
      // A timer is running on this game: its minutes are not recorded yet, and Steam may not have
      // reported them yet either. Keep the window open (even with no growth) and try again next time.
      const timerRunning = runningTimer?.gameId === game.id;
      const openedAt = state.deferred[appKey];
      // Without growth the window only stays open for a day: if Steam never reports the minutes
      // (a copy it does not track), later Steam play time must not lose them.
      const stillOpen =
        openedAt !== undefined && delta <= 0 && now.getTime() - openedAt < STEAM_DEFER_MAX_MS;
      if (timerRunning || stillOpen) deferred[appKey] = openedAt ?? sinceMs;
      if (delta <= 0) {
        // Unchanged, or Steam corrected the total downwards: follow it without a session.
        baselines[appKey] = total;
        // Time recorded since the last sync that Steam has not reported yet: keep its window open
        // so the next growth is not added on top of it.
        if (deferred[appKey] === undefined && recordedSince.has(game.id)) {
          deferred[appKey] = sinceMs;
        }
        continue;
      }
      if (timerRunning) {
        baselines[appKey] = previous;
        continue;
      }

      const from = state.deferred[appKey] ?? sinceMs;
      // Every session since the last saved sync counts, Steam's own too: a run that inserted one
      // and then failed before saving its baseline must not insert the same minutes again.
      const recorded = (await storage.getGamePlaySessions(game.id, userId))
        // The history import sets the baseline itself, so its session is never part of a window.
        .filter((s) => s.source !== "steam_import" && s.endedAt && s.endedAt.getTime() > from)
        .reduce((sum, s) => {
          // A session only counts for its part inside the window [from, now]; the rest belongs to
          // the previous or the next window. Steam's own sessions are estimates ending at a sync
          // time, so they always count in full.
          if (s.source === "steam") return sum + sessionMinutes(s.startedAt, s.endedAt!);
          const start = s.startedAt.getTime() >= from ? s.startedAt : new Date(from);
          const end = s.endedAt!.getTime() <= now.getTime() ? s.endedAt! : now;
          return end.getTime() > start.getTime() ? sum + sessionMinutes(start, end) : sum;
        }, 0);
      const net = delta - recorded;
      if (net < 0 && now.getTime() - from < STEAM_DEFER_MAX_MS) {
        // Recorded time exceeds what Steam has reported so far: Steam may report the rest later.
        // Keep the old baseline and the window so the later growth is matched against the same
        // recorded time instead of being imported again (bounded to a day, like the other windows).
        baselines[appKey] = previous;
        deferred[appKey] = from;
        continue;
      }
      baselines[appKey] = total;
      if (net <= 0) continue;

      // The sync was turned on or off since this run began: its result is stale, so write nothing.
      // The linked Steam account changed meanwhile: this delta belongs to the old account.
      const [current, currentUser] = await Promise.all([
        readState(userId),
        storage.getUser(userId),
      ]);
      if (current.epoch !== state.epoch || currentUser?.steamId64 !== user.steamId64) {
        return { sessionsAdded, minutesAdded, baselined };
      }
      await storage.addGamePlaySession({
        gameId: game.id,
        userId,
        startedAt: new Date(now.getTime() - net * 60_000),
        endedAt: now,
        source: "steam",
      });
      sessionsAdded++;
      inserted++;
      minutesAdded += net;
    }

    statusSaved = await persistRun(userId, state.epoch, {
      steamId: user.steamId64,
      baselines,
      deferred,
      lastSyncAt: now.getTime(),
      lastSessionsAdded: sessionsAdded,
      lastMinutesAdded: minutesAdded,
      lastError: null,
    });
    return { sessionsAdded, minutesAdded, baselined };
  } finally {
    running.delete(userId);
    // Open pages (stats, journal, sync card) refresh themselves instead of waiting for a reload.
    // Only when something changed for them: new sessions, or the saved run status.
    if (inserted > 0 || statusSaved) notifyUser("playSessionsUpdated", { source: "steam" }, userId);
  }
}

/** Scheduled run: every user who turned the sync on. A failure for one never stops the others. */
export async function runScheduledSteamPlaytimeSync(): Promise<void> {
  if (!config.steam.isConfigured) return;
  for (const user of await storage.getAllUsers()) {
    if (!user.steamId64) continue;
    try {
      if (!(await readState(user.id)).enabled) continue;
      await syncSteamPlaytime(user.id);
    } catch (error) {
      if (error instanceof SteamPlaytimeBusyError) continue;
      routesLogger.warn({ userId: user.id }, "Steam play-time sync failed");
    }
  }
}

export interface SteamImportCandidate {
  gameId: string;
  title: string;
  /** Total Steam reports for the game. */
  steamMinutes: number;
  /** Minutes already recorded in Questarr (timer, manual, Playnite, earlier syncs). */
  recordedMinutes: number;
  /** What the import would add: Steam's total minus the recorded time. */
  importMinutes: number;
  /** The imported session ends here: Steam's last-played time, or now when Steam has none. */
  lastPlayedAt: string | null;
}

export interface SteamImportPreview {
  candidates: SteamImportCandidate[];
  /** Games already imported once, or with a timer running: left out. */
  skipped: number;
}

interface Planned extends SteamImportCandidate {
  appKey: string;
  total: number;
}

/** Work out what an import would add. Nothing is written. */
async function planSteamImport(userId: string): Promise<{ planned: Planned[]; skipped: number }> {
  const user = await storage.getUser(userId);
  if (!config.steam.isConfigured || !user?.steamId64) throw new SteamPlaytimeUnavailableError();
  let totals;
  try {
    totals = await steamService.getOwnedPlaytimesDetailed(config.steam.apiKey!, user.steamId64);
  } catch (error) {
    // Do not log the error: Steam request URLs contain the API key.
    const message =
      error instanceof Error && error.message.startsWith("Steam library unavailable")
        ? error.message
        : "Could not read your Steam play time. Check the API key and make Game details public.";
    throw new SteamPlaytimeUpstreamError(message, { cause: error });
  }
  const [games, runningTimer, sessions] = await Promise.all([
    storage.getUserGames(userId, true),
    storage.getRunningPlaySession(userId),
    storage.getUserPlaySessions(userId),
  ]);
  const byGame = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const list = byGame.get(session.gameId) ?? [];
    list.push(session);
    byGame.set(session.gameId, list);
  }
  const planned: Planned[] = [];
  let skipped = 0;
  for (const game of games) {
    if (game.steamAppId == null) continue;
    const steam = totals.get(game.steamAppId);
    if (!steam || steam.minutes <= 0) continue;
    const own = byGame.get(game.id) ?? [];
    if (runningTimer?.gameId === game.id || own.some((s) => s.source === "steam_import")) {
      skipped++;
      continue;
    }
    const recorded = recordedMinutes(own);
    const missing = steam.minutes - recorded;
    if (missing < MIN_PLAYTIME_IMPORT_MINUTES) continue;
    planned.push({
      gameId: game.id,
      title: game.title,
      steamMinutes: steam.minutes,
      recordedMinutes: recorded,
      importMinutes: missing,
      lastPlayedAt: steam.lastPlayedAt ? steam.lastPlayedAt.toISOString() : null,
      appKey: String(game.steamAppId),
      total: steam.minutes,
    });
  }
  planned.sort((a, b) => b.importMinutes - a.importMinutes);
  return { planned, skipped };
}

/** What importing the play time Steam already holds would add, per game. Writes nothing. */
export async function previewSteamPlaytimeImport(userId: string): Promise<SteamImportPreview> {
  const { planned, skipped } = await planSteamImport(userId);
  return {
    candidates: planned.map(({ appKey: _a, total: _t, ...candidate }) => candidate),
    skipped,
  };
}

/**
 * Import the chosen games (all when `gameIds` is omitted) as one estimated `steam_import` session
 * each, ending at Steam's last-played time. The plan is recomputed here, so the minutes never come
 * from the client, and a game is imported only once. A game the live sync already tracks gets its
 * baseline moved to Steam's total, so the next sync does not add the same minutes again.
 */
export async function importSteamPlaytime(
  userId: string,
  gameIds?: string[],
  now: Date = new Date()
): Promise<{ sessionsAdded: number; minutesAdded: number }> {
  if (running.has(userId)) throw new SteamPlaytimeBusyError();
  running.add(userId);
  let sessionsAdded = 0;
  let minutesAdded = 0;
  try {
    const { planned } = await planSteamImport(userId);
    const wanted = gameIds ? new Set(gameIds) : null;
    const moved: Planned[] = [];
    for (const item of planned) {
      if (wanted && !wanted.has(item.gameId)) continue;
      const last = item.lastPlayedAt ? new Date(item.lastPlayedAt).getTime() : null;
      const end = last !== null && last > 0 && last <= now.getTime() ? new Date(last) : now;
      await storage.addGamePlaySession({
        gameId: item.gameId,
        userId,
        startedAt: new Date(end.getTime() - item.importMinutes * 60_000),
        endedAt: end,
        source: "steam_import",
      });
      sessionsAdded++;
      minutesAdded += item.importMinutes;
      moved.push(item);
    }
    if (moved.length > 0) {
      await withStateLock(userId, async () => {
        const state = await readState(userId);
        const baselines = { ...state.baselines };
        let changed = false;
        for (const item of moved) {
          if (baselines[item.appKey] !== undefined) {
            baselines[item.appKey] = item.total;
            changed = true;
          }
        }
        if (changed) await writeState(userId, { ...state, baselines });
      });
    }
    return { sessionsAdded, minutesAdded };
  } finally {
    running.delete(userId);
    if (sessionsAdded > 0) notifyUser("playSessionsUpdated", { source: "steam" }, userId);
  }
}
