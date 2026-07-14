import React from "react";
import { LayoutGrid, List, Rows2, Rows3 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ViewControlsToolbarProps {
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  listDensity: "comfortable" | "compact";
  onListDensityChange: (density: "comfortable" | "compact") => void;
}

export default function ViewControlsToolbar({
  viewMode,
  onViewModeChange,
  listDensity,
  onListDensityChange,
}: ViewControlsToolbarProps) {
  const toggleDensity = () =>
    onListDensityChange(listDensity === "comfortable" ? "compact" : "comfortable");

  return (
    <>
      {viewMode === "list" && (
        <span className="hidden sm:contents">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={toggleDensity}>
                {listDensity === "comfortable" ? (
                  <Rows3 className="h-3.5 w-3.5" />
                ) : (
                  <Rows2 className="h-3.5 w-3.5" />
                )}
                <span className="sr-only sm:not-sr-only sm:inline-block">
                  {listDensity === "comfortable" ? "Comfortable" : "Compact"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Switch to {listDensity === "comfortable" ? "compact" : "comfortable"}
            </TooltipContent>
          </Tooltip>
        </span>
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
