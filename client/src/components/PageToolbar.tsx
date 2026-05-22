import React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ViewControlsToolbar from "./ViewControlsToolbar";
import type { ViewMode, ListDensity } from "@/hooks/use-view-controls";

export interface SortOption {
  value: string;
  label: string;
}

export interface ViewControlsConfig {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  listDensity: ListDensity;
  onListDensityChange: (density: ListDensity) => void;
}

interface PageToolbarProps {
  /** Controlled search value. A search input is rendered when this prop is provided. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Content rendered on the left (filter pills, custom toggles). */
  filterPills?: React.ReactNode;
  /** Sort select. Rendered when sortOptions is non-empty. */
  sortValue?: string;
  onSortChange?: (value: string) => void;
  sortOptions?: SortOption[];
  /** Grid/list view toggle and list density selector. */
  viewControls?: ViewControlsConfig;
  /** Extra elements at the far right (e.g. settings button, refresh). */
  actions?: React.ReactNode;
}

export default function PageToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  filterPills,
  sortValue,
  onSortChange,
  sortOptions,
  viewControls,
  actions,
}: PageToolbarProps) {
  const hasSearch = onSearchChange !== undefined;
  const hasSort = Boolean(sortOptions?.length && onSortChange);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      {/* Left: search input + filter pills */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {hasSearch && (
          <div className="relative h-10 w-full min-w-0 sm:h-8 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={search ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 pl-9 pr-8 text-sm sm:h-8"
              aria-label={searchPlaceholder}
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0 hover:bg-transparent sm:h-6 sm:w-6 no-default-hover-elevate no-default-active-elevate"
                onClick={() => onSearchChange?.("")}
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
        {filterPills && <div className="flex flex-wrap items-center gap-2">{filterPills}</div>}
      </div>

      {/* Right: sort + view controls + extra actions */}
      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
        {hasSort && (
          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <span className="text-xs text-muted-foreground hidden sm:inline">Sort</span>
            <Select value={sortValue} onValueChange={onSortChange}>
              <SelectTrigger className="h-10 w-full text-sm sm:h-8 sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortOptions?.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {viewControls && (
          <ViewControlsToolbar
            viewMode={viewControls.viewMode}
            onViewModeChange={viewControls.onViewModeChange}
            listDensity={viewControls.listDensity}
            onListDensityChange={viewControls.onListDensityChange}
          />
        )}
        {actions}
      </div>
    </div>
  );
}
