export type IgdbContentSlotCategory = "dlc" | "update" | "packs" | "extra";
export type StoredIgdbContentCategory = "main" | "dlc" | "update" | "extra" | "packs";

/** Preserve the pre-rebase Content-tab mapping for IGDB game categories. */
export function igdbContentSlotCategory(igdbCategory?: number | null): IgdbContentSlotCategory {
  if (igdbCategory === 14) return "update";
  if (igdbCategory === 13) return "packs";
  if ([1, 2, 4].includes(igdbCategory ?? -1)) return "dlc";
  return "extra";
}

export function igdbCategoryForStoredCategory(category: StoredIgdbContentCategory): number {
  if (category === "update") return 14;
  if (category === "packs") return 13;
  if (category === "extra") return 5;
  return 2;
}

/**
 * Resolve a content slot using the same precedence in the Content tab and import suggestions:
 * live IGDB category/type, cached IGDB metadata, cached slot category, then group fallback.
 */
export function resolveIgdbContentSlotCategory(options: {
  liveCategory?: number | null | undefined;
  liveGameType?: number | null | undefined;
  cachedIgdbCategory?: number | null | undefined;
  cachedCategory?: StoredIgdbContentCategory | null | undefined;
  fallbackIgdbCategory?: number | null | undefined;
}): IgdbContentSlotCategory {
  const cachedCategory =
    options.cachedCategory == null
      ? undefined
      : igdbCategoryForStoredCategory(options.cachedCategory);
  const igdbCategory =
    options.liveCategory ??
    options.liveGameType ??
    options.cachedIgdbCategory ??
    cachedCategory ??
    options.fallbackIgdbCategory;
  return igdbContentSlotCategory(igdbCategory);
}
