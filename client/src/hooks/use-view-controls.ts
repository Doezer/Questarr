import { useLocalStorageState } from "./use-local-storage-state";

export type ViewMode = "grid" | "list";
export type ListDensity = "comfortable" | "compact" | "ultra-compact";

const VALID_VIEW_MODES: ViewMode[] = ["grid", "list"];
const VALID_DENSITIES: ListDensity[] = ["comfortable", "compact", "ultra-compact"];

export function useViewControls(pageKey: string) {
  const [viewMode, setViewMode] = useLocalStorageState<string>(`${pageKey}ViewMode`, "grid");
  const [listDensity, setListDensity] = useLocalStorageState<string>(
    `${pageKey}ListDensity`,
    "comfortable"
  );

  return {
    viewMode: (VALID_VIEW_MODES.includes(viewMode as ViewMode) ? viewMode : "grid") as ViewMode,
    setViewMode: (mode: ViewMode) => setViewMode(mode),
    listDensity: (VALID_DENSITIES.includes(listDensity as ListDensity)
      ? listDensity
      : "comfortable") as ListDensity,
    setListDensity: (density: ListDensity) => setListDensity(density),
  };
}
