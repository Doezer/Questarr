/**
 * Budgets for the recursive Scan Disk walk (`GET /api/games/:gameId/files`).
 *
 * A very large library tree can exhaust filesystem I/O and memory if walked
 * without limits, so the traversal stops once either budget is exceeded and
 * reports the result as truncated (see issue #944).
 */

/** Maximum number of files a single scan will return before truncating. */
export let SCAN_MAX_FILES = 5000;

/** Wall-clock budget (in ms) for a single scan traversal. */
export let SCAN_TIME_BUDGET_MS = 5000;

/**
 * Override the budgets. Intended for tests that need to trip the caps
 * without creating thousands of files or waiting for real timers.
 */
export function setScanBudgets(overrides: { maxFiles?: number; timeBudgetMs?: number }): void {
  if (overrides.maxFiles !== undefined) SCAN_MAX_FILES = overrides.maxFiles;
  if (overrides.timeBudgetMs !== undefined) SCAN_TIME_BUDGET_MS = overrides.timeBudgetMs;
}

/** Restore the production budgets (call from test teardown). */
export function resetScanBudgets(): void {
  SCAN_MAX_FILES = 5000;
  SCAN_TIME_BUDGET_MS = 5000;
}
