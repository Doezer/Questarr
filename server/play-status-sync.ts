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
  return PLAYNITE_STATUS_MAP[status.trim().toLowerCase().replace(/\s+/g, " ")];
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
