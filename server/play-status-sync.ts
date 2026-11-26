import { normalizeTitle } from "../shared/title-utils.js";
import { isUserCuratedGameStatus, type GameStatus } from "../shared/schema.js";

/**
 * Playnite's completion statuses, lower-cased, mapped to Questarr's. Playnite only lists games the
 * person has, so the "not started" ones mean "owned" rather than "wanted".
 */
const PLAYNITE_STATUS_MAP: Readonly<Record<string, GameStatus>> = {
  "not played": "owned",
  "plan to play": "owned",
  played: "owned",
  playing: "playing",
  "on hold": "shelved",
  abandoned: "shelved",
  beaten: "completed",
  completed: "completed",
};

/** Maps a Playnite completion status (case/spacing-insensitive); undefined when unknown. */
export function mapPlayniteStatus(status: string): GameStatus | undefined {
  const key = status.trim().toLowerCase().replace(/\s+/g, " ");
  // Own keys only: "constructor" or "__proto__" must not resolve to an inherited value.
  return Object.hasOwn(PLAYNITE_STATUS_MAP, key) ? PLAYNITE_STATUS_MAP[key] : undefined;
}

/** Sources a sync can attribute a status to; anything else is recorded as "playnite". */
export const SYNC_PLATFORMS = ["steam", "gog", "epic"] as const;

export function toSyncSource(platform: string | undefined): string {
  const key = platform?.trim().toLowerCase();
  return (SYNC_PLATFORMS as readonly string[]).includes(key ?? "") ? key! : "playnite";
}

export type PlayStatusDecision =
  | { action: "apply" }
  | { action: "unchanged" }
  | { action: "skip"; reason: "manual_status" | "downloading" | "wanted" };

/**
 * Whether a synced status may be written to a game. A status the user set by hand (a curated one
 * with no `statusSyncSource`) always wins; a previously synced one can be replaced by a newer sync.
 * A game still wanted or downloading is left alone unless `promoteWanted` opts in for wanted ones.
 */
export function decidePlayStatus(
  game: { status: string; statusSyncSource: string | null },
  target: GameStatus,
  options: { promoteWanted: boolean }
): PlayStatusDecision {
  if (isUserCuratedGameStatus(game.status) && game.statusSyncSource === null) {
    return { action: "skip", reason: "manual_status" };
  }
  if (game.status === "downloading") return { action: "skip", reason: "downloading" };
  if (game.status === "wanted" && !options.promoteWanted) {
    return { action: "skip", reason: "wanted" };
  }
  if (game.status === target) return { action: "unchanged" };
  return { action: "apply" };
}

/**
 * True when an IGDB match is plausibly the game a store library listed: the normalized titles are
 * equal, or one starts with the other on a word boundary ("Hades" / "Hades II" is NOT accepted
 * because a sequel is a different game, so only the shorter side may be the full title when the
 * rest is an edition suffix such as "Game of the Year Edition").
 */
const EDITION_WORDS: ReadonlySet<string> = new Set([
  "edition",
  "remastered",
  "remaster",
  "definitive",
  "complete",
  "goty",
  "deluxe",
  "enhanced",
  "director",
  "cut",
  "gold",
  "ultimate",
  "special",
  "anniversary",
  "collection",
  "hd",
  "version",
]);
/** Words that may sit between edition markers ("Game of the Year", "Director's Cut"). */
const EDITION_GLUE: ReadonlySet<string> = new Set(["game", "of", "the", "year", "s"]);

export function libraryTitlesAgree(requested: string, matched: string): boolean {
  return normalizedTitlesAgree(normalizeTitle(requested), normalizeTitle(matched));
}

/** Same check on titles already passed through `normalizeTitle`, for scans over a library. */
export function normalizedTitlesAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.startsWith(`${short} `)) return false;
  // Every extra word must be an edition marker (or glue between them), and at least one must be
  // a marker: "Hades II Deluxe Edition" is a sequel and "Hades Of The" is nothing.
  const extra = long.slice(short.length + 1).split(" ");
  return (
    extra.every((w) => EDITION_WORDS.has(w) || EDITION_GLUE.has(w)) &&
    extra.some((w) => EDITION_WORDS.has(w))
  );
}

/** Whole minutes of play time recorded for a game, from its finished sessions. */
export function recordedMinutes(
  sessions: Array<{ startedAt: Date; endedAt: Date | null }>
): number {
  let total = 0;
  for (const s of sessions) {
    if (!s.endedAt) continue;
    total += Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000));
  }
  return total;
}

/**
 * Smallest gap between Playnite's total and the recorded time that is imported. Each finished
 * session is rounded to whole minutes on both sides, so a few sessions can drift by a few
 * minutes; importing that would add a bogus session after every sync.
 */
export const MIN_PLAYTIME_IMPORT_MINUTES = 10;
