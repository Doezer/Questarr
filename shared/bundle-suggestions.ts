/**
 * Size-aware extras for the "download with updates" bundle: updates are preselected, and a
 * smaller DLC or extra is offered (unticked) only when its measured size is small next to the
 * main release. A larger or unknown-size extra is not suggested: grabbing it blind could
 * double the download.
 */

export const DEFAULT_BUNDLE_EXTRA_MAX_PERCENT = 25;

/** Whether an extra of `extraSize` bytes is small enough, next to a main release of `mainSize`. */
export function isSuggestedExtra(
  mainSize: number | null | undefined,
  extraSize: number | null | undefined,
  maxPercent: number = DEFAULT_BUNDLE_EXTRA_MAX_PERCENT
): boolean {
  if (!mainSize || !extraSize || mainSize <= 0 || extraSize <= 0) return false;
  // cross-multiplied so a percentage like 12.5 needs no float division
  return extraSize * 100 <= mainSize * maxPercent;
}

/** The extras worth suggesting with a main release, in their given order. */
export function suggestBundleExtras<T extends { size?: number | null }>(
  mainSize: number | null | undefined,
  extras: readonly T[],
  maxPercent: number = DEFAULT_BUNDLE_EXTRA_MAX_PERCENT
): T[] {
  return extras.filter((extra) => isSuggestedExtra(mainSize, extra.size, maxPercent));
}
