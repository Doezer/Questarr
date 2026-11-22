/**
 * Backlog quests: a few optional challenges per week and per month, picked from the user's own
 * library to help empty the backlog (games with the `owned` or `playing` status).
 *
 * Pure functions, like `backlog-burndown.ts`, with the same time zone handling. A period's quests
 * are picked with a seeded shuffle (user + period), so the same library gives the same quests all
 * through the period. Durations are the IGDB "normally" Time to Beat; a game without one is never
 * given to a quest that depends on a duration.
 */

import {
  formatDayNumber,
  localDayNumber,
  monthStartOfDay,
  weekStartOfDay,
  type PlayStatsZone,
} from "./play-stats.js";
import { BACKLOG_STATUSES } from "./backlog-burndown.js";

export const QUEST_PERIODS = ["week", "month"] as const;
export type QuestPeriod = (typeof QUEST_PERIODS)[number];

export const QUEST_KINDS = [
  "weekend_sprint",
  "backlog_cleanup",
  "backlog_slayer",
  "retro_explorer",
  "monthly_finisher",
] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

export const QUEST_STATUSES = ["active", "completed", "missed"] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

/** Most quests offered for one period. */
export const QUESTS_PER_PERIOD = 2;
/** A "Weekend Sprint" game takes at most this many hours to beat. */
export const SPRINT_MAX_HOURS = 6;
/** A "Backlog Slayer" game was added at least this many days before the month started. */
export const SLAYER_MIN_AGE_DAYS = 365;
export const SLAYER_TARGET = 3;
/** A "Retro Explorer" game was released before this year. */
export const RETRO_BEFORE_YEAR = 2005;
export const FINISHER_TARGET = 2;

const DAY_MS = 86_400_000;

export const QUEST_PERIOD_OF: Record<QuestKind, QuestPeriod> = {
  weekend_sprint: "week",
  backlog_cleanup: "week",
  backlog_slayer: "month",
  retro_explorer: "month",
  monthly_finisher: "month",
};

export interface QuestGameInput {
  id: string;
  status: string;
  releaseDate?: string | null;
  addedAt?: Date | null;
  /** IGDB "normally" estimate, in hours. */
  timeToBeatNormally?: number | null;
}

export interface QuestEventInput {
  gameId: string;
  status: string;
  at: Date;
}

export interface QuestSessionInput {
  gameId: string;
  startedAt: Date;
}

/** What the generator decides for one quest; stored as a row. */
export interface QuestDraft {
  kind: QuestKind;
  period: QuestPeriod;
  /** First local day of the period, `YYYY-MM-DD`. */
  periodStart: string;
  /** The game a single-game quest is about. */
  gameId: string | null;
  target: number;
}

export interface QuestProgressInput {
  kind: QuestKind;
  period: QuestPeriod;
  periodStart: string;
  gameId: string | null;
}

export interface Period {
  period: QuestPeriod;
  /** Local day numbers; `endDay` is the first day after the period. */
  startDay: number;
  endDay: number;
  start: string;
}

function monthEndOfDay(startDay: number): number {
  const date = new Date(startDay * DAY_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / DAY_MS;
}

/** The week (Monday first) or month that contains `now`, in the viewer's time zone. */
export function currentPeriod(period: QuestPeriod, now: Date, zone: PlayStatsZone = 0): Period {
  const today = localDayNumber(zone)(now);
  const startDay = period === "week" ? weekStartOfDay(today) : monthStartOfDay(today);
  const endDay = period === "week" ? startDay + 7 : monthEndOfDay(startDay);
  return { period, startDay, endDay, start: formatDayNumber(startDay) };
}

/** Period described by its stored first day. */
export function periodFromStart(period: QuestPeriod, start: string): Period {
  const startDay = Date.parse(`${start}T00:00:00Z`) / DAY_MS;
  const endDay = period === "week" ? startDay + 7 : monthEndOfDay(startDay);
  return { period, startDay, endDay, start };
}

/** Small seeded generator (mulberry32) over a string hash, so a period's picks are reproducible. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

function releaseYear(game: QuestGameInput): number | null {
  const match = /^(\d{4})/.exec(game.releaseDate ?? "");
  return match ? Number(match[1]) : null;
}

const inBacklog = (game: QuestGameInput): boolean => BACKLOG_STATUSES.includes(game.status);

function isRetro(game: QuestGameInput): boolean {
  const year = releaseYear(game);
  return year !== null && year < RETRO_BEFORE_YEAR;
}

function isOld(game: QuestGameInput, periodStartDay: number): boolean {
  if (!game.addedAt) return false;
  return game.addedAt.getTime() <= periodStartDay * DAY_MS - SLAYER_MIN_AGE_DAYS * DAY_MS;
}

/** The quests a period can offer for this library, before the seeded pick. */
function eligibleDrafts(
  games: readonly QuestGameInput[],
  p: Period,
  random: () => number
): QuestDraft[] {
  const backlog = games.filter(inBacklog);
  if (backlog.length === 0) return [];
  const base = { period: p.period, periodStart: p.start };
  const drafts: QuestDraft[] = [];

  if (p.period === "week") {
    const sprint = backlog.filter(
      (g) =>
        typeof g.timeToBeatNormally === "number" &&
        g.timeToBeatNormally > 0 &&
        g.timeToBeatNormally <= SPRINT_MAX_HOURS
    );
    if (sprint.length > 0) {
      const game = shuffle(sprint, random)[0]!;
      drafts.push({ ...base, kind: "weekend_sprint", gameId: game.id, target: 1 });
    }
    drafts.push({ ...base, kind: "backlog_cleanup", gameId: null, target: 1 });
  } else {
    const old = backlog.filter((g) => isOld(g, p.startDay));
    if (old.length >= SLAYER_TARGET) {
      drafts.push({ ...base, kind: "backlog_slayer", gameId: null, target: SLAYER_TARGET });
    }
    if (backlog.some(isRetro)) {
      drafts.push({ ...base, kind: "retro_explorer", gameId: null, target: 1 });
    }
    if (backlog.length >= FINISHER_TARGET) {
      drafts.push({ ...base, kind: "monthly_finisher", gameId: null, target: FINISHER_TARGET });
    }
  }
  return drafts;
}

/**
 * Picks the quests of one period. A library with nothing in the backlog (or too little for any
 * quest) gets none; the caller shows an empty state rather than an invented challenge.
 */
export function generateQuests(
  userId: string,
  games: readonly QuestGameInput[],
  p: Period
): QuestDraft[] {
  const random = seededRandom(`${userId}:${p.period}:${p.start}`);
  const drafts = eligibleDrafts(games, p, random);
  return shuffle(drafts, random).slice(0, QUESTS_PER_PERIOD);
}

/**
 * How far a quest got. Single-game quests follow their game; the others count games of the
 * backlog (as it stood at the start of the period) that were played or completed in the period.
 */
export function questProgress(
  quest: QuestProgressInput,
  games: readonly QuestGameInput[],
  events: readonly QuestEventInput[],
  sessions: readonly QuestSessionInput[],
  zone: PlayStatsZone = 0
): number {
  const toDay = localDayNumber(zone);
  const p = periodFromStart(quest.period, quest.periodStart);
  const within = (date: Date): boolean => {
    const day = toDay(date);
    return day >= p.startDay && day < p.endDay;
  };
  const gameById = new Map(games.map((g) => [g.id, g]));

  const completed = new Set(
    events.filter((e) => e.status === "completed" && within(e.at)).map((e) => e.gameId)
  );
  const played = new Set(sessions.filter((s) => within(s.startedAt)).map((s) => s.gameId));
  const touched = new Set([...completed, ...played]);

  switch (quest.kind) {
    case "weekend_sprint":
      return quest.gameId && completed.has(quest.gameId) ? 1 : 0;
    case "backlog_cleanup":
    case "monthly_finisher":
      return completed.size;
    case "backlog_slayer": {
      let count = 0;
      for (const id of touched) {
        const game = gameById.get(id);
        if (game && isOld(game, p.startDay)) count++;
      }
      return count;
    }
    case "retro_explorer": {
      let count = 0;
      for (const id of touched) {
        const game = gameById.get(id);
        if (game && isRetro(game)) count++;
      }
      return count;
    }
  }
}

export interface QuestMedal {
  id: string;
  /** Quest kinds that count toward it. */
  kinds: readonly QuestKind[];
  /** Completed quests needed. */
  needed: number;
}

export const QUEST_MEDALS: readonly QuestMedal[] = [
  { id: "backlog_slayer", kinds: ["backlog_slayer"], needed: 1 },
  { id: "retro_explorer", kinds: ["retro_explorer"], needed: 1 },
  { id: "sprinter", kinds: ["weekend_sprint"], needed: 1 },
  { id: "regular", kinds: [...QUEST_KINDS], needed: 5 },
];

/** Medals unlocked by the completed quests, derived each time rather than stored. */
export function unlockedMedals(completedKinds: readonly QuestKind[]): string[] {
  return QUEST_MEDALS.filter(
    (m) => completedKinds.filter((k) => m.kinds.includes(k)).length >= m.needed
  ).map((m) => m.id);
}
