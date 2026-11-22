import type { Game } from "./schema";

/** How the roulette favours some games over others; "random" is the uniform draw. */
export const ROULETTE_BIASES = ["random", "oldest", "quick", "rated"] as const;
export type RouletteBias = (typeof ROULETTE_BIASES)[number];

export const ROULETTE_BIAS_LABELS: Record<RouletteBias, string> = {
  random: "Pure chance",
  oldest: "Oldest first",
  quick: "Quick wins",
  rated: "Highest rated",
};

/** Mood presets derived from the genres, themes and modes stored on each game. */
export const ROULETTE_MOODS = ["any", "relaxing", "short", "coop"] as const;
export type RouletteMood = (typeof ROULETTE_MOODS)[number];

export const ROULETTE_MOOD_LABELS: Record<RouletteMood, string> = {
  any: "Any mood",
  relaxing: "Relaxing",
  short: "Short and sweet",
  coop: "Co-op",
};

export type RouletteGame = Pick<
  Game,
  | "id"
  | "hidden"
  | "status"
  | "genres"
  | "themes"
  | "platforms"
  | "gameModes"
  | "timeToBeatNormally"
  | "rating"
  | "aggregatedRating"
  | "userRating"
  | "addedAt"
  | "installedVersion"
  | "libraryPath"
>;

export interface RouletteFilters {
  pool: "owned" | "playing" | "all";
  /** Longest acceptable normal completion time in hours; null for no limit. */
  maxHours: number | null;
  /** Exact genre name, or null for any. */
  genre: string | null;
  /** Exact platform name, or null for any. */
  platform: string | null;
  mood: RouletteMood;
  installedOnly: boolean;
}

const MS_PER_DAY = 86_400_000;
const RELAXING_GENRES = /puzzle|simulator|visual novel|point-and-click|card|board|music|casual/i;
const RELAXING_THEMES = /sandbox|comedy|educational|kids|farming|non-fiction/i;
const TENSE = /horror|thriller|warfare|survival|shooter|fighting|hack and slash/i;
const COOP = /co-?operative|split screen/i;

function hasMatch(values: readonly string[] | null | undefined, pattern: RegExp) {
  return !!values?.some((value) => pattern.test(value));
}

function knownHours(game: Pick<Game, "timeToBeatNormally">): number | null {
  const hours = game.timeToBeatNormally;
  return typeof hours === "number" && Number.isFinite(hours) && hours > 0 ? hours : null;
}

/** True when the game's stored genres, themes, modes and length fit the mood. */
export function matchesMood(game: RouletteGame, mood: RouletteMood): boolean {
  switch (mood) {
    case "any":
      return true;
    case "relaxing":
      return (
        (hasMatch(game.genres, RELAXING_GENRES) || hasMatch(game.themes, RELAXING_THEMES)) &&
        !hasMatch(game.genres, TENSE) &&
        !hasMatch(game.themes, TENSE)
      );
    case "short": {
      const hours = knownHours(game);
      return hours !== null && hours <= 5;
    }
    case "coop":
      return hasMatch(game.gameModes, COOP);
  }
}

export function isInstalled(game: Pick<RouletteGame, "installedVersion" | "libraryPath">) {
  return !!(game.installedVersion?.trim() || game.libraryPath?.trim());
}

/** Games that can enter the draw: visible, and matching every filter. */
export function filterRouletteGames<T extends RouletteGame>(
  games: readonly T[],
  filters: RouletteFilters
): T[] {
  return games.filter((game) => {
    if (game.hidden) return false;
    if (filters.pool !== "all" && game.status !== filters.pool) return false;
    if (filters.maxHours !== null) {
      const hours = knownHours(game);
      if (hours === null || hours > filters.maxHours) return false;
    }
    if (filters.genre && !game.genres?.includes(filters.genre)) return false;
    if (filters.platform && !game.platforms?.includes(filters.platform)) return false;
    if (filters.installedOnly && !isInstalled(game)) return false;
    return matchesMood(game, filters.mood);
  });
}

/** Rating on a 0-100 scale: the user's own (0.5-10) first, then IGDB's; null when unrated. */
function ratingOutOf100(game: RouletteGame): number | null {
  if (typeof game.userRating === "number" && game.userRating > 0) return game.userRating * 10;
  for (const value of [game.rating, game.aggregatedRating]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** Relative chance of a game being drawn under a bias; always positive and finite. */
export function rouletteWeight(game: RouletteGame, bias: RouletteBias, now = Date.now()): number {
  switch (bias) {
    case "random":
      return 1;
    case "oldest": {
      const added = game.addedAt ? new Date(game.addedAt).getTime() : NaN;
      if (!Number.isFinite(added)) return 1;
      return 1 + Math.max(0, now - added) / MS_PER_DAY;
    }
    case "quick": {
      const hours = knownHours(game);
      // Unknown lengths stay in the draw, but behind every game with a known short length.
      return hours === null ? 0.01 : 1 / Math.max(hours, 1);
    }
    case "rated": {
      const rating = ratingOutOf100(game);
      // Squared so the best games stand out; unrated games get a modest middle-low chance.
      return (rating ?? 40) ** 2;
    }
  }
}

/**
 * Pick one item with probability proportional to its weight. `unit` is a random number in
 * [0, 1); with equal weights it selects index `floor(unit * length)`.
 */
export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  unit: number
): T | undefined {
  if (!items.length) return undefined;
  const weights = items.map((item) => {
    const weight = weightOf(item);
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(unit * items.length))];
  let target = Math.min(Math.max(unit, 0), 1 - Number.EPSILON) * total;
  for (let index = 0; index < items.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (target < weight) return items[index];
    target -= weight;
  }
  return items[items.length - 1];
}

/** Sorted distinct values of a string-array field across the games, for filter options. */
export function distinctValues(
  games: readonly RouletteGame[],
  field: "genres" | "platforms"
): string[] {
  const values = new Set<string>();
  for (const game of games) for (const value of game[field] ?? []) if (value) values.add(value);
  return [...values].sort((a, b) => a.localeCompare(b));
}
