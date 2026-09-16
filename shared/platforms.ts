/**
 * Shared platform-selection helpers.
 * One user setting governs every platform selector in the app: the Library
 * platform filter, the download-search platform filter, the Discover and
 * Add Game dropdowns, and the import engine's eligibility check. The stored
 * shape is a list of IGDB platform ids (`importPlatformIds`).
 *
 * Checked = the platforms the user uses. Anything unchecked is hidden from
 * every selector. An empty list means "no restriction" and shows everything,
 * matching the import engine's long-standing eligibility rule.
 */

import { matchesPlatformFilter, type CanonicalPlatform } from "./title-utils.js";

/** Shape of one entry in the `/api/igdb/platforms` response. */
export interface IgdbPlatform {
  id: number;
  name: string;
}

/**
 * IGDB platform ids for the canonical release labels that
 * `parseReleaseMetadata` can detect in a release name.
 *
 * Library, Discover and Add Game filter by IGDB id, so they work for every
 * platform IGDB reports. The download-search filter only sees release-title
 * labels, so it can be narrowed for these ids and no others.
 */
export const IGDB_ID_TO_CANONICAL_PLATFORM: Record<number, CanonicalPlatform> = {
  6: "PC",
  167: "PS5",
  48: "PS4",
  9: "PS3",
  130: "Switch",
  169: "Xbox Series",
  11: "Xbox",
  14: "Mac",
  3: "Linux",
};

function normalizeSelectedIds(selectedIds: unknown): number[] {
  // The settings API returns persisted JSON without revalidating it, so a
  // non-array would otherwise reach `.map`/`.includes` and throw mid-render.
  if (!Array.isArray(selectedIds)) return [];
  return selectedIds.filter((id): id is number => typeof id === "number");
}

/**
 * Release-title labels covered by the selected IGDB platform ids.
 */
export function canonicalPlatformsForIgdbIds(selectedIds: unknown): CanonicalPlatform[] {
  const ids = normalizeSelectedIds(selectedIds);
  const labels: CanonicalPlatform[] = [];
  for (const id of ids) {
    const label = IGDB_ID_TO_CANONICAL_PLATFORM[id];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * Filters IGDB platforms down to the selected ids. An empty selection returns
 * every platform so an unconfigured setting never blanks a dropdown.
 */
export function visibleIgdbPlatforms<T extends { id: number }>(
  platforms: T[],
  selectedIds: unknown
): T[] {
  const list = Array.isArray(platforms) ? platforms : [];
  const ids = normalizeSelectedIds(selectedIds);
  if (ids.length === 0) return list;
  const selected = new Set(ids);
  return list.filter((platform) => selected.has(platform.id));
}

/**
 * Names of the selected platforms, for surfaces that match on IGDB platform
 * *names* (the Library's `games.platforms` values) rather than ids.
 *
 * An empty selection yields an empty set, which callers treat as "no
 * restriction" — the naming is deliberately about the selection, not the
 * visible result, so the two surfaces cannot disagree about an unset value.
 */
export function selectedPlatformNames<T extends { id: number; name: string }>(
  platforms: T[],
  selectedIds: unknown
): Set<string> {
  return new Set(visibleIgdbPlatforms(platforms, selectedIds).map((platform) => platform.name));
}

/**
 * True when a platform name is allowed by the selection. An empty selection
 * allows everything.
 */
export function isPlatformNameSelected(
  platformName: string,
  allowedNames: Set<string>,
  selectedIds: unknown
): boolean {
  if (normalizeSelectedIds(selectedIds).length === 0) return true;
  return allowedNames.has(platformName);
}

/**
 * True when a release's detected platform label satisfies the selection.
 *
 * Returns true when nothing is selected, and also when the selection covers no
 * release label at all (e.g. only "Nintendo Switch 2" is checked) — release
 * names cannot express that platform, so the filter stays out of the way
 * instead of hiding every result.
 */
export function matchesSelectedIgdbPlatform(
  releasePlatform: string | undefined,
  selectedIds: unknown
): boolean {
  const ids = normalizeSelectedIds(selectedIds);
  if (ids.length === 0) return true;
  const labels = canonicalPlatformsForIgdbIds(ids);
  if (labels.length === 0) return true;
  return labels.some((label) => matchesPlatformFilter(releasePlatform, label));
}
