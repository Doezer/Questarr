import { useCallback, useEffect } from "react";
import { useLocalStorageState } from "./use-local-storage-state";

const GRID_COLUMNS_MIN = 2;
const GRID_COLUMNS_MAX = 10;

function sanitizeGridColumns(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, Math.round(value)));
}

/**
 * Persists a page's game-grid column count (2-10) in localStorage under `storageKey`,
 * clamping any out-of-range stored value (0, 1.5, 11, Infinity) back into range.
 */
export function useGridColumns(storageKey: string, defaultValue = 5) {
  const [gridColumns, setGridColumns] = useLocalStorageState(storageKey, defaultValue);
  const safeGridColumns = sanitizeGridColumns(gridColumns);

  useEffect(() => {
    if (safeGridColumns !== gridColumns) {
      setGridColumns(safeGridColumns);
    }
  }, [safeGridColumns, gridColumns, setGridColumns]);

  const handleGridColumnsChange = useCallback(
    ([value]: number[]) => setGridColumns(sanitizeGridColumns(value)),
    [setGridColumns]
  );

  return { gridColumns: safeGridColumns, handleGridColumnsChange };
}

export { GRID_COLUMNS_MIN, GRID_COLUMNS_MAX };
