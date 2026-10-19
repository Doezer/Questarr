import type { Collection, CollectionRules, Game } from "@shared/schema";

/** Collection row as the API returns it (dates are serialized to strings). */
export type CollectionDto = Omit<Collection, "createdAt" | "type"> & {
  type: "manual" | "smart";
  createdAt: string | null;
};

export type CollectionSummary = CollectionDto & { gameCount: number; coverUrls: string[] };

export type CollectionDetail = CollectionDto & { games: Game[] };

/** Short human description of a smart collection's rules, for cards and headers. */
export function describeRules(rules: CollectionRules | null | undefined): string {
  if (!rules) return "";
  const parts: string[] = [];
  if (rules.statuses?.length) parts.push(`Status: ${rules.statuses.join(", ")}`);
  if (rules.genres?.length) parts.push(`Genre: ${rules.genres.join(", ")}`);
  if (rules.platforms?.length) parts.push(`Platform: ${rules.platforms.join(", ")}`);
  if (rules.minRating !== undefined) parts.push(`IGDB rating ≥ ${rules.minRating}`);
  if (rules.minUserRating !== undefined) parts.push(`My rating ≥ ${rules.minUserRating}`);
  if (rules.releaseYearFrom !== undefined || rules.releaseYearTo !== undefined) {
    parts.push(`Released ${rules.releaseYearFrom ?? "…"}–${rules.releaseYearTo ?? "…"}`);
  }
  if (rules.titleContains) parts.push(`Title contains “${rules.titleContains}”`);
  return parts.join(" · ");
}
