import { useState, useEffect } from "react";

export type ViewMode = "grid" | "list";
export type ListDensity = "comfortable" | "compact" | "ultra-compact";

export function useViewPreferences(pageKey: string) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem(`${pageKey}ViewMode`) as ViewMode) || "grid";
  });

  useEffect(() => {
    localStorage.setItem(`${pageKey}ViewMode`, viewMode);
  }, [viewMode, pageKey]);

  const [listDensity, setListDensity] = useState<ListDensity>(() => {
    return (
      (localStorage.getItem(`${pageKey}ListDensity`) as ListDensity) || "comfortable"
    );
  });

  useEffect(() => {
    localStorage.setItem(`${pageKey}ListDensity`, listDensity);
  }, [listDensity, pageKey]);

  return {
    viewMode,
    setViewMode,
    listDensity,
    setListDensity,
  };
}
