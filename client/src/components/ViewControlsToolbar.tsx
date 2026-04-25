import React from "react";
import { LayoutGrid, List, Settings2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ViewControlsToolbarProps {
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  listDensity: "comfortable" | "compact" | "ultra-compact";
  onListDensityChange: (density: "comfortable" | "compact" | "ultra-compact") => void;
}

export default function ViewControlsToolbar({
  viewMode,
  onViewModeChange,
  listDensity,
  onListDensityChange,
}: ViewControlsToolbarProps) {
  return (
    <>
      {viewMode === "list" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Settings2 className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only sm:inline-block">
                {listDensity === "comfortable"
                  ? "Comfortable"
                  : listDensity === "compact"
                    ? "Compact"
                    : "Ultra-compact"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Row Density</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onListDensityChange("comfortable")}>
              Comfortable
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onListDensityChange("compact")}>
              Compact
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onListDensityChange("ultra-compact")}>
              Ultra-compact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ToggleGroup
        type="single"
        value={viewMode}
        onValueChange={(value) => value && onViewModeChange(value as "grid" | "list")}
      >
        <ToggleGroupItem value="grid" aria-label="Grid View">
          <LayoutGrid className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List View">
          <List className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </>
  );
}
