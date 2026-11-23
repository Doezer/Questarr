/**
 * Backlog burn-down: how the pile of owned-but-unfinished games shrinks (or grows) over time.
 *
 * Pure functions, like `play-stats.ts`, with the same time zone handling. The backlog is every game
 * whose status is `owned` or `playing`; `completed` and `shelved` games are out of it. History comes
 * from the status events (one row per status change); the time still to play is the IGDB "normally"
 * Time to Beat of each backlog game minus what was played on it by then.
 */

import {
  formatDayNumber,
  localDayNumber,
  monthStartOfDay,
  sessionMinutes,
  weekStartOfDay,
  type PlayStatsZone,
} from "./play-stats.js";

export const BACKLOG_STATUSES: readonly string[] = ["owned", "playing"];
export const BURNDOWN_WEEKS = 12;
export const BURNDOWN_MONTHS = 12;
/** Days of play the projection averages over. */
export const PACE_DAYS = 28;
/** A projection further away than this is not worth showing. */
const MAX_PROJECTION_DAYS = 3650;

export interface BacklogGameInput {
  id: string;
  status: string;
  /** IGDB "normally" estimate, in hours. */
  timeToBeatNormally?: number | null;
}

export interface BacklogEventInput {
  gameId: string;
  status: string;
  at: Date;
}

export interface BacklogSessionInput {
  gameId: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface BacklogBucket {
  /** First local day of the bucket, `YYYY-MM-DD` (weeks start on Monday). */
  start: string;
  /** Games in the backlog at the end of the bucket (the last one ends today). */
  backlog: number;
  /** Games that entered the backlog during the bucket. */
  added: number;
  /** Games completed during the bucket. */
  completed: number;
  /** Hours still to play at the end of the bucket, for backlog games with a Time to Beat. */
  remainingHours: number;
}

export interface BacklogBurndown {
  current: {
    backlog: number;
    remainingHours: number;
    /** Backlog games with no Time to Beat, which the remaining hours leave out. */
    withoutEstimate: number;
  };
  perWeek: BacklogBucket[];
  perMonth: BacklogBucket[];
  projection: {
    /** Average hours played per day over the last 28 days, all games. */
    hoursPerDay: number;
    /** `YYYY-MM-DD` the remaining hours run out at that pace, or `null` when it cannot be told. */
    clearedOn: string | null;
  };
}

const inBacklog = (status: string): boolean => BACKLOG_STATUSES.includes(status);

interface Span {
  start: number;
  end: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

type HistoryEntry = { day: number; status: string };

/** Per game: its status changes in order, as [local day, status]. */
function buildHistory(
  events: readonly BacklogEventInput[],
  gameById: ReadonlyMap<string, unknown>,
  toDay: (d: Date) => number
): Map<string, HistoryEntry[]> {
  const history = new Map<string, HistoryEntry[]>();
  for (const event of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (!gameById.has(event.gameId)) continue;
    const list = history.get(event.gameId) ?? [];
    list.push({ day: toDay(event.at), status: event.status });
    history.set(event.gameId, list);
  }
  return history;
}

/** Per game: finished sessions by local day, oldest first, with running totals for lookups. */
function buildPlayed(
  sessions: readonly BacklogSessionInput[],
  toDay: (d: Date) => number,
  today: number
): { played: Map<string, { day: number; total: number }[]>; recentMinutes: number } {
  const played = new Map<string, { day: number; total: number }[]>();
  let recentMinutes = 0;
  const sorted = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const session of sorted) {
    if (!session.endedAt) continue;
    const minutes = sessionMinutes(session.startedAt, session.endedAt);
    if (minutes <= 0) continue;
    const day = toDay(session.startedAt);
    const list = played.get(session.gameId) ?? [];
    list.push({ day, total: (list.at(-1)?.total ?? 0) + minutes });
    played.set(session.gameId, list);
    if (day > today - PACE_DAYS && day <= today) recentMinutes += minutes;
  }
  return { played, recentMinutes };
}

/** Games added to the backlog and games completed by status changes inside the span. */
function countMoves(
  list: readonly HistoryEntry[],
  span: Span
): { added: number; completed: number } {
  let added = 0;
  let completed = 0;
  let previous: string | null = null;
  for (const entry of list) {
    if (entry.day >= span.start && entry.day <= span.end) {
      if (inBacklog(entry.status) && (previous === null || !inBacklog(previous))) added++;
      if (entry.status === "completed" && previous !== "completed") completed++;
    }
    previous = entry.status;
  }
  return { added, completed };
}

function buildSpans(today: number): { weekSpans: Span[]; monthSpans: Span[] } {
  const weekSpans: Span[] = [];
  const thisWeek = weekStartOfDay(today);
  for (let i = BURNDOWN_WEEKS - 1; i >= 0; i--) {
    const start = thisWeek - i * 7;
    weekSpans.push({ start, end: Math.min(start + 6, today) });
  }
  const monthSpans: Span[] = [];
  const thisMonth = new Date(monthStartOfDay(today) * 86_400_000);
  for (let i = BURNDOWN_MONTHS - 1; i >= 0; i--) {
    const start = Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - i, 1) / 86_400_000;
    const next =
      Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - i + 1, 1) / 86_400_000;
    monthSpans.push({ start, end: Math.min(next - 1, today) });
  }
  return { weekSpans, monthSpans };
}

export function computeBacklogBurndown(
  games: readonly BacklogGameInput[],
  events: readonly BacklogEventInput[],
  sessions: readonly BacklogSessionInput[],
  now: Date,
  zone: PlayStatsZone = 0
): BacklogBurndown {
  const toDay = localDayNumber(zone);
  const today = toDay(now);
  const gameById = new Map(games.map((g) => [g.id, g]));

  const history = buildHistory(events, gameById, toDay);
  const { played, recentMinutes } = buildPlayed(sessions, toDay, today);

  const playedBy = (gameId: string, day: number): number => {
    const list = played.get(gameId);
    if (!list) return 0;
    let total = 0;
    for (const entry of list) {
      if (entry.day > day) break;
      total = entry.total;
    }
    return total;
  };

  const statusOn = (gameId: string, day: number): string | null => {
    let status: string | null = null;
    for (const entry of history.get(gameId) ?? []) {
      if (entry.day > day) break;
      status = entry.status;
    }
    return status;
  };

  const remainingFor = (game: BacklogGameInput, day: number): number | null => {
    const hours = game.timeToBeatNormally;
    if (!hours || hours <= 0) return null;
    return Math.max(0, hours * 60 - playedBy(game.id, day)) / 60;
  };

  const buckets = (spans: Span[]): BacklogBucket[] =>
    spans.map((span) => {
      let backlog = 0;
      let added = 0;
      let completed = 0;
      let remaining = 0;
      for (const game of games) {
        const list = history.get(game.id) ?? [];
        const status = statusOn(game.id, span.end);
        if (status !== null && inBacklog(status)) {
          backlog++;
          remaining += remainingFor(game, span.end) ?? 0;
        }
        const moves = countMoves(list, span);
        added += moves.added;
        completed += moves.completed;
      }
      return {
        start: formatDayNumber(span.start),
        backlog,
        added,
        completed,
        remainingHours: round1(remaining),
      };
    });

  const { weekSpans, monthSpans } = buildSpans(today);

  // Today's figures come from the games themselves, which are always right, not from the history.
  let backlog = 0;
  let remaining = 0;
  let withoutEstimate = 0;
  for (const game of games) {
    if (!inBacklog(game.status)) continue;
    backlog++;
    const left = remainingFor(game, today);
    if (left === null) withoutEstimate++;
    else remaining += left;
  }

  const hoursPerDay = recentMinutes / 60 / PACE_DAYS;
  let clearedOn: string | null = null;
  if (remaining > 0 && hoursPerDay > 0) {
    const days = Math.ceil(remaining / hoursPerDay);
    if (days <= MAX_PROJECTION_DAYS) clearedOn = formatDayNumber(today + days);
  }

  return {
    current: { backlog, remainingHours: round1(remaining), withoutEstimate },
    perWeek: buckets(weekSpans),
    perMonth: buckets(monthSpans),
    projection: { hoursPerDay: Math.round(hoursPerDay * 100) / 100, clearedOn },
  };
}
