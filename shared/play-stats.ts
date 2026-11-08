/**
 * Play-time analytics, computed from a user's play sessions.
 *
 * Pure functions with no database or clock access, so the server route and the tests share one
 * implementation. Days, weeks and months are bucketed in the viewer's local time: the caller
 * passes the browser's offset (`Date#getTimezoneOffset`, in minutes, UTC minus local).
 */

export interface PlaySessionInput {
  gameId: string;
  startedAt: Date;
  /** `null` while the timer is still running; such sessions are left out of the totals. */
  endedAt: Date | null;
}

export interface PlayGameInput {
  id: string;
  title: string;
  genres?: string[] | null;
  platforms?: string[] | null;
  /** IGDB "normally" estimate, in hours. */
  timeToBeatNormally?: number | null;
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

export interface PlayTimeStats {
  totalMinutes: number;
  sessionCount: number;
  /** The single longest finished session, if any. */
  longestSession: { gameId: string; title: string; minutes: number } | null;
  /** Consecutive local days with play, counting back from today (or yesterday). */
  currentStreakDays: number;
  longestStreakDays: number;
  topGames: PlayTimeByGame[];
  topGenres: { name: string; minutes: number }[];
  topPlatforms: { name: string; minutes: number }[];
  /** Oldest first, one entry per week/month including empty ones. */
  perWeek: PlayTimeBucket[];
  perMonth: PlayTimeBucket[];
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
  zone: PlayStatsZone = 0
): PlayTimeStats {
  const toLocal = localizer(zone);
  const gameById = new Map(games.map((g) => [g.id, g]));
  const perGame = new Map<string, { minutes: number; sessions: number }>();
  const perGenre = new Map<string, number>();
  const perPlatform = new Map<string, number>();
  const weekMinutes = new Map<number, number>();
  const monthMinutes = new Map<number, number>();
  const activeDays = new Set<number>();
  let totalMinutes = 0;
  let sessionCount = 0;
  let longest: { gameId: string; minutes: number } | null = null;

  for (const session of sessions) {
    if (!session.endedAt) continue;
    // Every finished session counts, even one that rounds to zero minutes...
    sessionCount++;
    const minutes = sessionMinutes(session.startedAt, session.endedAt);
    const entry = perGame.get(session.gameId) ?? { minutes: 0, sessions: 0 };
    entry.sessions++;
    perGame.set(session.gameId, entry);
    // ...but only real time feeds the time-based statistics.
    if (minutes <= 0) continue;
    const local = toLocal(session.startedAt);

    totalMinutes += minutes;
    if (!longest || minutes > longest.minutes) longest = { gameId: session.gameId, minutes };
    entry.minutes += minutes;

    const game = gameById.get(session.gameId);
    for (const genre of game?.genres ?? []) {
      perGenre.set(genre, (perGenre.get(genre) ?? 0) + minutes);
    }
    for (const platform of game?.platforms ?? []) {
      perPlatform.set(platform, (perPlatform.get(platform) ?? 0) + minutes);
    }

    addToDays(weekMinutes, new Date(weekStart(local) * DAY_MS), minutes);
    addToDays(monthMinutes, new Date(monthStart(local) * DAY_MS), minutes);
    activeDays.add(dayNumber(local));
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

  const topGames: PlayTimeByGame[] = [...perGame.entries()]
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

  const { current, longest: longestStreak } = streaks(activeDays, dayNumber(localNow));

  return {
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
    topGenres: topEntries(perGenre, TOP_TAGS),
    topPlatforms: topEntries(perPlatform, TOP_TAGS),
    perWeek,
    perMonth,
  };
}
