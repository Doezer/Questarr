import type { CollectionRules, Game } from "./schema.js";

type MatchableGame = Pick<
  Game,
  "title" | "status" | "platforms" | "genres" | "rating" | "userRating" | "releaseDate"
>;

function hasAny(values: readonly string[] | null | undefined, wanted: readonly string[]): boolean {
  if (!values?.length) return false;
  const lowered = new Set(values.map((v) => v.toLowerCase()));
  return wanted.some((w) => lowered.has(w.toLowerCase()));
}

/** True when the rules contain no usable criterion (such rules would match the whole library). */
export function isEmptyCollectionRules(rules: CollectionRules | null | undefined): boolean {
  if (!rules) return true;
  return !(
    rules.statuses?.length ||
    rules.platforms?.length ||
    rules.genres?.length ||
    rules.minRating !== undefined ||
    rules.minUserRating !== undefined ||
    rules.releaseYearFrom !== undefined ||
    rules.releaseYearTo !== undefined ||
    rules.titleContains
  );
}

/**
 * Evaluates a smart collection's rules against a game. All set criteria must hold (AND); list
 * criteria hold when the game has at least one of the listed values (OR, case-insensitive).
 */
export function gameMatchesCollectionRules(game: MatchableGame, rules: CollectionRules): boolean {
  if (rules.statuses?.length && !rules.statuses.includes(game.status)) return false;
  if (rules.platforms?.length && !hasAny(game.platforms, rules.platforms)) return false;
  if (rules.genres?.length && !hasAny(game.genres, rules.genres)) return false;
  if (rules.minRating !== undefined && (game.rating ?? -1) < rules.minRating) return false;
  if (rules.minUserRating !== undefined && (game.userRating ?? -1) < rules.minUserRating) {
    return false;
  }
  if (rules.releaseYearFrom !== undefined || rules.releaseYearTo !== undefined) {
    // releaseDate is an ISO string; the first four characters are the year.
    const year = game.releaseDate ? Number.parseInt(game.releaseDate.slice(0, 4), 10) : Number.NaN;
    if (Number.isNaN(year)) return false;
    if (rules.releaseYearFrom !== undefined && year < rules.releaseYearFrom) return false;
    if (rules.releaseYearTo !== undefined && year > rules.releaseYearTo) return false;
  }
  if (rules.titleContains) {
    if (!game.title.toLowerCase().includes(rules.titleContains.toLowerCase())) return false;
  }
  return true;
}
