/**
 * Play-time analytics, computed from a user's play sessions.
 *
 * Pure functions with no database or clock access, so the server route and the tests share one
 * implementation. Days, weeks and months are bucketed in the viewer's local time: the caller
 * passes the browser's offset (`Date#getTimezoneOffset`, in minutes, UTC minus local).
 */

import { computeGoalProgress, recentPlayMinutes, type PlayGoalProgress } from "./play-goal.js";

export interface PlaySessionInput {
  gameId: string;
  startedAt: Date;
  /** `null` while the timer is still running; such sessions are left out of the totals. */
  endedAt: Date | null;
  /**
   * Where the session came from. `steam`, `steam_import` and `playnite_import` sessions are estimates built from
   * playtime totals (Steam deltas, or the total Playnite already knew):
   * their minutes count in the totals, but they say nothing about when or how long one sitting
   * lasted, so they stay out of the longest session and the streaks.
   */
  source?: string | null;
}

export interface PlayGameInput {
  id: string;
  title: string;
  genres?: string[] | null;
  platforms?: string[] | null;
  /** IGDB "normally" estimate, in hours. */
  timeToBeatNormally?: number | null;
  /** Personal target day, `YYYY-MM-DD`. */
  finishBy?: string | null;
  status?: string | null;
}

export interface PlayGoalEntry extends PlayGoalProgress {
  gameId: string;
  title: string;
  finishBy: string;
  playedMinutes: number;
  timeToBeatHours: number | null;
}

export interface PlayTimeBucket {
  /** Local calendar date the bucket starts on, `YYYY-MM-DD` (weeks start on Monday). */
  start: string;
  minutes: number;
}

export interface PlayTimeByGame {
  gameId: string;
  title: string;
  minutes: number;
  sessions: number;
  /** Hours IGDB estimates to beat the game, for comparison with `minutes`. */
  timeToBeatHours: number | null;
}

/** Inclusive local-day bounds (`YYYY-MM-DD`) for the range-aware part of the statistics. */
export interface PlayStatsRange {
  from?: string | null;
  to?: string | null;
}

export interface PlayDurationBucket {
  /** Readable label such as `30–60 min`. */
  label: string;
  count: number;
}

export interface PlaySessionDurationStats {
  /** Finished sessions that are not estimates (timer, manual, Playnite). */
  sampleSize: number;
  averageMinutes: number;
  medianMinutes: number;
  buckets: PlayDurationBucket[];
}

export interface PlayHeatmap {
  /** One entry per local day, oldest first, from the window's first day to its last. */
  days: PlayTimeBucket[];
  /** Minutes per weekday, Monday first. */
  perWeekday: number[];
  /** Minutes per local hour of the day the session started (0-23). */
  perHour: number[];
}

export interface PlayTimeStats {
  /** The local days the range-aware figures cover (`null` = unbounded). */
  range: { from: string | null; to: string | null };
  totalMinutes: number;
  sessionCount: number;
  /** The single longest finished session, if any. */
  longestSession: { gameId: string; title: string; minutes: number } | null;
  /** Consecutive local days with play, counting back from today (or yesterday). */
  currentStreakDays: number;
  longestStreakDays: number;
  topGames: PlayTimeByGame[];
  /** Games with a "finish by" goal that are not completed, soonest target first. */
  goals: PlayGoalEntry[];
  topGenres: { name: string; minutes: number }[];
  topPlatforms: { name: string; minutes: number }[];
  /** Oldest first, one entry per week/month including empty ones. Not narrowed by the range. */
  perWeek: PlayTimeBucket[];
  perMonth: PlayTimeBucket[];
  sessionStats: PlaySessionDurationStats;
  heatmap: PlayHeatmap;
}

/** Longest window the heatmap draws, in weeks. */
export const HEATMAP_WEEKS = 53;
const DURATION_BUCKETS: { label: string; max: number }[] = [
  { label: "Under 30 min", max: 30 },
  { label: "30–60 min", max: 60 },
  { label: "1–2 h", max: 120 },
  { label: "2–4 h", max: 240 },
  { label: "4 h or more", max: Number.POSITIVE_INFINITY },
];

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const WEEKS_SHOWN = 12;
export const MONTHS_SHOWN = 12;
const TOP_GAMES = 10;
const TOP_TAGS = 6;

/** Whole minutes between two instants (never negative). */
export function sessionMinutes(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / MINUTE_MS));
}

/** True when `zone` is an IANA time zone name this runtime understands (e.g. `Europe/Paris`). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The viewer's time zone: an IANA name (DST-aware per instant) or a fixed `getTimezoneOffset()`. */
export type PlayStatsZone = string | number;

/**
 * Builds a function that shifts an instant so its UTC fields read as the viewer's local time.
 * An IANA name applies the zone's offset at that very instant, so daylight saving time is right
 * for every session; a number is a fixed `getTimezoneOffset()` kept for older clients.
 */
function localizer(zone: PlayStatsZone): (date: Date) => Date {
  if (typeof zone === "string" && isValidTimeZone(zone)) {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    return (date) => {
      const parts: Record<string, number> = {};
      for (const part of format.formatToParts(date)) {
        if (part.type !== "literal") parts[part.type] = Number(part.value);
      }
      return new Date(
        Date.UTC(
          parts.year ?? 1970,
          (parts.month ?? 1) - 1,
          parts.day ?? 1,
          parts.hour ?? 0,
          parts.minute ?? 0,
          parts.second ?? 0
        )
      );
    };
  }
  const offset = typeof zone === "number" ? zone : 0;
  return (date) => new Date(date.getTime() - offset * MINUTE_MS);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Days since the epoch of the (already local-shifted) date's calendar day. */
function dayNumber(local: Date): number {
  return Math.floor(local.getTime() / DAY_MS);
}

/** Local Monday of the week containing the (already local-shifted) date. */
function weekStart(local: Date): number {
  const day = dayNumber(local);
  // 1970-01-01 was a Thursday, so (day + 3) % 7 is 0 for Monday.
  return day - ((day + 3) % 7);
}

function monthStart(local: Date): number {
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) / DAY_MS;
}

function dayToDateString(day: number): string {
  return isoDate(new Date(day * DAY_MS));
}

/** Adds minutes to the bucket keyed by a local day number. A session counts on its start day. */
function addToDays(days: Map<number, number>, local: Date, minutes: number): void {
  const key = dayNumber(local);
  days.set(key, (days.get(key) ?? 0) + minutes);
}

function topEntries(map: Map<string, number>, limit: number): { name: string; minutes: number }[] {
  return [...map.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Longest and current runs of consecutive days present in `activeDays`. */
function streaks(activeDays: Set<number>, today: number): { current: number; longest: number } {
  const sorted = [...activeDays].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  // A streak is still alive if the last play was today or yesterday.
  let cursor = activeDays.has(today) ? today : today - 1;
  let current = 0;
  while (activeDays.has(cursor)) {
    current++;
    cursor--;
  }
  return { current, longest };
}

export function computePlayStats(
  sessions: readonly PlaySessionInput[],
  games: readonly PlayGameInput[],
  now: Date,
  zone: PlayStatsZone = 0,
  range: PlayStatsRange = {}
): PlayTimeStats {
  const toLocal = localizer(zone);
  const gameById = new Map(games.map((g) => [g.id, g]));
  // `perGame` feeds the finish-by goals and so ignores the range; `rangeGame` feeds "most played".
  const perGame = new Map<string, { minutes: number; sessions: number }>();
  const rangeGame = new Map<string, { minutes: number; sessions: number }>();
  const perGenre = new Map<string, number>();
  const perPlatform = new Map<string, number>();
  const weekMinutes = new Map<number, number>();
  const monthMinutes = new Map<number, number>();
  const activeDays = new Set<number>();
  const dayMinutes = new Map<number, number>();
  const perWeekday: number[] = new Array<number>(7).fill(0);
  const perHour: number[] = new Array<number>(24).fill(0);
  const realDurations: number[] = [];
  const fromDay = range.from ? Date.parse(`${range.from}T00:00:00Z`) / DAY_MS : null;
  const toDay = range.to ? Date.parse(`${range.to}T00:00:00Z`) / DAY_MS : null;
  let totalMinutes = 0;
  let sessionCount = 0;
  let longest: { gameId: string; minutes: number } | null = null;

  for (const session of sessions) {
    if (!session.endedAt) continue;
    const minutes = sessionMinutes(session.startedAt, session.endedAt);
    const local = toLocal(session.startedAt);
    const day = dayNumber(local);
    const inRange = (fromDay === null || day >= fromDay) && (toDay === null || day <= toDay);
    // Every finished session counts, even one that rounds to zero minutes...
    const entry = perGame.get(session.gameId) ?? { minutes: 0, sessions: 0 };
    entry.sessions++;
    perGame.set(session.gameId, entry);
    const rangeEntry = rangeGame.get(session.gameId) ?? { minutes: 0, sessions: 0 };
    if (inRange) {
      sessionCount++;
      rangeEntry.sessions++;
      rangeGame.set(session.gameId, rangeEntry);
    }
    // ...but only real time feeds the time-based statistics.
    const estimated =
      session.source === "steam" ||
      session.source === "playnite_import" ||
      session.source === "steam_import";
    // A short timer rounds to zero minutes but is still a sitting, so it counts as a sample.
    if (inRange && !estimated) realDurations.push(minutes);
    if (minutes <= 0) continue;

    entry.minutes += minutes;
    // Hours played before tracking began belong to no particular week: they count in totals and
    // per-game figures but stay out of the weekly and monthly charts.
    if (session.source !== "steam_import") {
      addToDays(weekMinutes, new Date(weekStart(local) * DAY_MS), minutes);
      addToDays(monthMinutes, new Date(monthStart(local) * DAY_MS), minutes);
    }
    if (!estimated) activeDays.add(day);

    if (!inRange) continue;
    totalMinutes += minutes;
    rangeEntry.minutes += minutes;
    if (!estimated && (!longest || minutes > longest.minutes)) {
      longest = { gameId: session.gameId, minutes };
    }
    const game = gameById.get(session.gameId);
    for (const genre of game?.genres ?? []) {
      perGenre.set(genre, (perGenre.get(genre) ?? 0) + minutes);
    }
    for (const platform of game?.platforms ?? []) {
      perPlatform.set(platform, (perPlatform.get(platform) ?? 0) + minutes);
    }
    // Estimates say nothing about when or how long one sitting lasted.
    if (!estimated) {
      dayMinutes.set(day, (dayMinutes.get(day) ?? 0) + minutes);
      perWeekday[(day + 3) % 7] = (perWeekday[(day + 3) % 7] ?? 0) + minutes;
      const hour = local.getUTCHours();
      perHour[hour] = (perHour[hour] ?? 0) + minutes;
    }
  }

  const localNow = toLocal(now);
  const thisWeek = weekStart(localNow);
  const perWeek: PlayTimeBucket[] = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
    const start = thisWeek - i * 7;
    perWeek.push({ start: dayToDateString(start), minutes: weekMinutes.get(start) ?? 0 });
  }

  const perMonth: PlayTimeBucket[] = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
    const first = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() - i, 1) / DAY_MS;
    perMonth.push({ start: dayToDateString(first), minutes: monthMinutes.get(first) ?? 0 });
  }

  const topGames: PlayTimeByGame[] = [...rangeGame.entries()]
    .filter(([, value]) => value.minutes > 0)
    .map(([gameId, value]) => {
      const game = gameById.get(gameId);
      return {
        gameId,
        title: game?.title ?? "Unknown game",
        minutes: value.minutes,
        sessions: value.sessions,
        timeToBeatHours: game?.timeToBeatNormally ?? null,
      };
    })
    .sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title))
    .slice(0, TOP_GAMES);

  const todayLocal = isoDate(localNow);
  const goals: PlayGoalEntry[] = [];
  for (const game of games) {
    if (!game.finishBy || game.status === "completed") continue;
    const gameSessions = sessions.filter((s) => s.gameId === game.id);
    const progress = computeGoalProgress({
      finishBy: game.finishBy,
      today: todayLocal,
      gameStatus: game.status ?? "",
      playedMinutes: perGame.get(game.id)?.minutes ?? 0,
      recentMinutes: recentPlayMinutes(gameSessions, now),
      timeToBeatHours: game.timeToBeatNormally,
    });
    goals.push({
      ...progress,
      gameId: game.id,
      title: game.title,
      finishBy: game.finishBy,
      playedMinutes: perGame.get(game.id)?.minutes ?? 0,
      timeToBeatHours: game.timeToBeatNormally ?? null,
    });
  }
  goals.sort((a, b) => a.finishBy.localeCompare(b.finishBy) || a.title.localeCompare(b.title));

  const { current, longest: longestStreak } = streaks(activeDays, dayNumber(localNow));

  const today = dayNumber(localNow);
  const heatEnd = toDay === null ? today : Math.min(toDay, today);
  const earliest = weekStart(new Date(heatEnd * DAY_MS)) - (HEATMAP_WEEKS - 1) * 7;
  const heatStart = Math.max(fromDay ?? earliest, earliest);
  const heatDays: PlayTimeBucket[] = [];
  for (let d = heatStart; d <= heatEnd; d++) {
    heatDays.push({ start: dayToDateString(d), minutes: dayMinutes.get(d) ?? 0 });
  }

  const sorted = [...realDurations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2
        ? (sorted[middle] ?? 0)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const buckets = DURATION_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const minutes of sorted) {
    const index = DURATION_BUCKETS.findIndex((b) => minutes < b.max);
    const bucket = buckets[index];
    if (bucket) bucket.count++;
  }

  return {
    range: { from: range.from ?? null, to: range.to ?? null },
    totalMinutes,
    sessionCount,
    longestSession: longest
      ? {
          gameId: longest.gameId,
          title: gameById.get(longest.gameId)?.title ?? "Unknown game",
          minutes: longest.minutes,
        }
      : null,
    currentStreakDays: current,
    longestStreakDays: longestStreak,
    topGames,
    goals,
    topGenres: topEntries(perGenre, TOP_TAGS),
    topPlatforms: topEntries(perPlatform, TOP_TAGS),
    perWeek,
    perMonth,
    sessionStats: {
      sampleSize: sorted.length,
      averageMinutes:
        sorted.length === 0 ? 0 : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      medianMinutes: Math.round(median),
      buckets,
    },
    heatmap: { days: heatDays, perWeekday, perHour },
  };
}

/**
 * The finished sessions that started inside `range`, in the viewer's time zone, for the export.
 * A running timer has no end yet and is left out.
 */
export function sessionsInRange<T extends PlaySessionInput>(
  sessions: readonly T[],
  zone: PlayStatsZone,
  range: PlayStatsRange
): T[] {
  const toLocal = localizer(zone);
  const fromDay = range.from ? Date.parse(`${range.from}T00:00:00Z`) / DAY_MS : null;
  const toDay = range.to ? Date.parse(`${range.to}T00:00:00Z`) / DAY_MS : null;
  return sessions.filter((session) => {
    if (!session.endedAt) return false;
    const day = dayNumber(toLocal(session.startedAt));
    return (fromDay === null || day >= fromDay) && (toDay === null || day <= toDay);
  });
}

/** Maps an instant to its local calendar day number (days since the epoch) in the viewer's zone. */
export function localDayNumber(zone: PlayStatsZone): (date: Date) => number {
  const toLocal = localizer(zone);
  return (date) => dayNumber(toLocal(date));
}

/** `YYYY-MM-DD` of a local day number. */
export function formatDayNumber(day: number): string {
  return dayToDateString(day);
}

/** Local Monday (day number) of the week containing the local day number. */
export function weekStartOfDay(day: number): number {
  return day - ((day + 3) % 7);
}

/** First day (day number) of the month containing the local day number. */
export function monthStartOfDay(day: number): number {
  const date = new Date(day * DAY_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS;
}
