/**
 * Library-driven game recommendations (mgmt #74).
 *
 * A small, explainable heuristic, entirely local: the taste profile is built from what the user
 * has in the library (genres, themes, developers, game modes), weighted by how much they seem to
 * like each game (status and personal rating). Candidates (fetched from IGDB by the server) are
 * scored against that profile, and each result carries the reasons behind its score so the UI can
 * say "because you rated X 9/10".
 */

export interface TasteGame {
  igdbId?: number | null | undefined;
  title: string;
  status: string;
  /** Personal rating on the 0.5–10 scale. */
  userRating?: number | null | undefined;
  genres?: string[] | null | undefined;
  themes?: string[] | null | undefined;
  developers?: string[] | null | undefined;
  gameModes?: string[] | null | undefined;
}

export type TasteCategory = "genres" | "themes" | "developers" | "gameModes";

export interface TasteAnchor {
  igdbId: number;
  title: string;
  weight: number;
  userRating: number | null;
}

export interface TasteProfile {
  /** Affinity per feature, normalized per category into [-1, 1]. */
  genres: Map<string, number>;
  themes: Map<string, number>;
  developers: Map<string, number>;
  gameModes: Map<string, number>;
  /** Games the user likes most (positive weight, known IGDB id), strongest first. */
  anchors: TasteAnchor[];
  /** True when the library holds nothing that says what the user likes. */
  empty: boolean;
}

export interface RecommendationCandidate {
  igdbId: number;
  title: string;
  genres?: string[] | undefined;
  themes?: string[] | undefined;
  developers?: string[] | undefined;
  gameModes?: string[] | undefined;
  /** IGDB aggregated critic rating, 0–100. */
  aggregatedRating?: number | null | undefined;
  /** Library games IGDB lists this candidate as similar to. */
  similarToIgdbIds?: number[] | undefined;
}

export type RecommendationReasonKind =
  "similar" | "developer" | "genre" | "theme" | "mode" | "acclaimed";

export interface RecommendationReason {
  kind: RecommendationReasonKind;
  /** The matching feature (genre, theme, developer) or the library game it is similar to. */
  label: string;
  /** For "similar": the user's rating of that game, when they gave one. */
  userRating?: number | null;
}

export interface Recommendation {
  score: number;
  reasons: RecommendationReason[];
}

export interface RankedRecommendation<T extends RecommendationCandidate> {
  candidate: T;
  recommendation: Recommendation;
}

/** How much a game's status says the user likes it (shelved = probably abandoned). */
const STATUS_WEIGHT: Record<string, number> = {
  completed: 1,
  playing: 1,
  owned: 0.6,
  downloading: 0.5,
  wanted: 0.4,
  shelved: 0.15,
};
const DEFAULT_STATUS_WEIGHT = 0.4;

const CATEGORY_FACTOR: Record<TasteCategory, number> = {
  genres: 3,
  themes: 2,
  developers: 2.5,
  gameModes: 0.5,
};
const SIMILAR_FACTOR = 3;
const ACCLAIM_FACTOR = 1;
/** Minimum critic rating (0–100) before a candidate counts as acclaimed. */
const ACCLAIM_THRESHOLD = 80;
const MAX_ANCHORS = 10;

/** 10 → 2, 7.5 → 1, 5 → 0, 2.5 → -1: a low rating pushes the game's features down. */
export function ratingMultiplier(userRating: number | null | undefined): number {
  if (userRating == null || !Number.isFinite(userRating)) return 1;
  return Math.max(-1, Math.min(2, (userRating - 5) / 2.5));
}

/** How strongly a library game shapes the profile; negative when the user rated it low. */
export function gameAffinityWeight(game: Pick<TasteGame, "status" | "userRating">): number {
  const base = STATUS_WEIGHT[game.status] ?? DEFAULT_STATUS_WEIGHT;
  return base * ratingMultiplier(game.userRating);
}

function accumulate(
  into: Map<string, number>,
  values: string[] | null | undefined,
  weight: number
) {
  if (!values) return;
  for (const raw of new Set(values)) {
    const key = raw.trim();
    if (key) into.set(key, (into.get(key) ?? 0) + weight);
  }
}

function normalize(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of map.values()) max = Math.max(max, Math.abs(v));
  const out = new Map<string, number>();
  if (max === 0) return out;
  for (const [k, v] of map) out.set(k, v / max);
  return out;
}

export function buildTasteProfile(games: TasteGame[]): TasteProfile {
  const genres = new Map<string, number>();
  const themes = new Map<string, number>();
  const developers = new Map<string, number>();
  const gameModes = new Map<string, number>();
  const anchors: TasteAnchor[] = [];

  for (const game of games) {
    const weight = gameAffinityWeight(game);
    if (weight === 0) continue;
    accumulate(genres, game.genres, weight);
    accumulate(themes, game.themes, weight);
    accumulate(developers, game.developers, weight);
    accumulate(gameModes, game.gameModes, weight);
    if (weight > 0 && game.igdbId != null) {
      anchors.push({
        igdbId: game.igdbId,
        title: game.title,
        weight,
        userRating: game.userRating ?? null,
      });
    }
  }

  anchors.sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
  const normalized = {
    genres: normalize(genres),
    themes: normalize(themes),
    developers: normalize(developers),
    gameModes: normalize(gameModes),
  };
  return {
    ...normalized,
    anchors: anchors.slice(0, MAX_ANCHORS),
    // Game modes only refine a score: they cannot seed candidate queries (anchors, genres, themes
    // and developers do), so a profile holding nothing else counts as empty.
    empty:
      anchors.length === 0 &&
      ![normalized.genres, normalized.themes, normalized.developers].some((map) =>
        [...map.values()].some((v) => v > 0)
      ),
  };
}

/** The strongest positive features of one category, for building candidate queries. */
export function topFeatures(profile: TasteProfile, category: TasteCategory, limit: number) {
  return [...profile[category].entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

interface Contribution {
  value: number;
  reason: RecommendationReason | null;
}

function featureContribution(
  category: TasteCategory,
  kind: RecommendationReasonKind,
  profile: TasteProfile,
  values: string[] | undefined
): Contribution {
  if (!values || values.length === 0) return { value: 0, reason: null };
  const affinities = [...new Set(values)].map((v) => [v, profile[category].get(v) ?? 0] as const);
  const positive = affinities.filter(([, a]) => a > 0);
  const negative = affinities.filter(([, a]) => a < 0);
  const sum = positive.reduce((s, [, a]) => s + a, 0) + negative.reduce((s, [, a]) => s + a, 0);
  // Developers are a strong signal on their own (the best match counts), the other categories are
  // averaged over the candidate's features so a long tag list does not inflate the score.
  const value =
    category === "developers"
      ? Math.max(0, ...affinities.map(([, a]) => a)) + negative.reduce((s, [, a]) => s + a, 0)
      : sum / affinities.length;
  positive.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const best = positive[0];
  return {
    value: value * CATEGORY_FACTOR[category],
    reason: best ? { kind, label: best[0] } : null,
  };
}

export function scoreCandidate(
  candidate: RecommendationCandidate,
  profile: TasteProfile
): Recommendation {
  const reasons: Array<RecommendationReason & { weight: number }> = [];
  let score = 0;

  // "Similar to" a game the user likes is the most readable reason, so it ranks first.
  const anchorsById = new Map(profile.anchors.map((a) => [a.igdbId, a]));
  const similar = (candidate.similarToIgdbIds ?? [])
    .map((id) => anchorsById.get(id))
    .filter((a): a is TasteAnchor => a !== undefined)
    .sort((a, b) => b.weight - a.weight);
  if (similar.length > 0) {
    const top = similar[0]!;
    score +=
      Math.min(
        2,
        similar.reduce((s, a) => s + a.weight, 0)
      ) * SIMILAR_FACTOR;
    reasons.push({
      kind: "similar",
      label: top.title,
      userRating: top.userRating,
      weight: 100 + top.weight,
    });
  }

  const parts: Array<[TasteCategory, RecommendationReasonKind, string[] | undefined]> = [
    ["developers", "developer", candidate.developers],
    ["genres", "genre", candidate.genres],
    ["themes", "theme", candidate.themes],
    ["gameModes", "mode", candidate.gameModes],
  ];
  for (const [category, kind, values] of parts) {
    const { value, reason } = featureContribution(category, kind, profile, values);
    score += value;
    if (reason && value > 0) reasons.push({ ...reason, weight: value });
  }

  if (
    candidate.aggregatedRating != null &&
    candidate.aggregatedRating >= ACCLAIM_THRESHOLD &&
    score > 0
  ) {
    score +=
      ((candidate.aggregatedRating - ACCLAIM_THRESHOLD) / (100 - ACCLAIM_THRESHOLD) + 0.5) *
      ACCLAIM_FACTOR;
    reasons.push({
      kind: "acclaimed",
      label: String(Math.round(candidate.aggregatedRating)),
      weight: 0.1,
    });
  }

  reasons.sort((a, b) => b.weight - a.weight);
  return {
    score: Math.round(score * 1000) / 1000,
    reasons: reasons.slice(0, 3).map(({ weight: _weight, ...reason }) => reason),
  };
}

/**
 * Scores and ranks candidates, dropping excluded ids (owned, hidden, wishlisted games) and
 * anything that does not match the user's taste at all.
 */
export function rankRecommendations<T extends RecommendationCandidate>(
  candidates: T[],
  profile: TasteProfile,
  options: { excludeIgdbIds?: ReadonlySet<number>; limit: number }
): Array<RankedRecommendation<T>> {
  const seen = new Set<number>();
  const ranked: Array<RankedRecommendation<T>> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.igdbId) || options.excludeIgdbIds?.has(candidate.igdbId)) continue;
    seen.add(candidate.igdbId);
    const recommendation = scoreCandidate(candidate, profile);
    if (recommendation.score > 0) ranked.push({ candidate, recommendation });
  }
  ranked.sort(
    (a, b) =>
      b.recommendation.score - a.recommendation.score || a.candidate.igdbId - b.candidate.igdbId
  );
  return ranked.slice(0, options.limit);
}
