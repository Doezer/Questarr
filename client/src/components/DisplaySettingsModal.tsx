import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LayoutGrid, EyeOff, List, Rows, AlignJustify } from "lucide-react";
import { Label } from "@/components/ui/label";

interface DisplaySettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gridColumns: number;
  onGridColumnsChange: (columns: number) => void;
  showHiddenGames: boolean;
  onShowHiddenGamesChange: (show: boolean) => void;
  viewMode?: "grid" | "list";
  onViewModeChange?: (mode: "grid" | "list") => void;
  density?: "comfortable" | "compact" | "ultra-compact";
  onDensityChange?: (density: "comfortable" | "compact" | "ultra-compact") => void;
}

export default function DisplaySettingsModal({
  open,
  onOpenChange,
  gridColumns,
  onGridColumnsChange,
  showHiddenGames,
  onShowHiddenGamesChange,
  viewMode = "grid",
  onViewModeChange,
  density,
  onDensityChange,
}: DisplaySettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Display Settings</DialogTitle>
          <DialogDescription>Customize how your game library is displayed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          {onViewModeChange && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>View Mode</Label>
              </div>
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => value && onViewModeChange(value as "grid" | "list")}
                className="justify-start"
              >
                <ToggleGroupItem value="grid" aria-label="Grid View">
                  <LayoutGrid className="h-4 w-4 mr-2" />
                  Grid
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List View">
                  <List className="h-4 w-4 mr-2" />
                  List
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}

          {onDensityChange && viewMode === "list" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Row Density</Label>
              </div>
              <ToggleGroup
                type="single"
                value={density}
                onValueChange={(value) =>
                  value && onDensityChange(value as "comfortable" | "compact" | "ultra-compact")
                }
                className="justify-start"
              >
                <ToggleGroupItem value="comfortable" aria-label="Comfortable">
                  <Rows className="h-4 w-4 mr-2" />
                  Comfortable
                </ToggleGroupItem>
                <ToggleGroupItem value="compact" aria-label="Compact">
                  <AlignJustify className="h-4 w-4 mr-2" />
                  Compact
                </ToggleGroupItem>
                <ToggleGroupItem value="ultra-compact" aria-label="Ultra Compact">
                  <List className="h-4 w-4 mr-2" />
                  Ultra Compact
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}

          <div
            className={`space-y-4 ${viewMode === "list" ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <LayoutGrid className="w-4 h-4" />
                Grid Columns
              </div>
              <span className="text-sm font-bold w-4 text-center">{gridColumns}</span>
            </div>
            <div className="flex items-center gap-4">
              <Slider
                value={[gridColumns]}
                onValueChange={([val]) => onGridColumnsChange(val)}
                min={2}
                max={10}
                step={1}
                className="flex-1"
                disabled={viewMode === "list"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Adjust the number of columns in the game grid (from 2 to 10).
            </p>
          </div>

          <div className="flex items-center justify-between space-x-2 pt-4 border-t">
            <div className="flex flex-col space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <EyeOff className="w-4 h-4" />
                Show Hidden Games
              </div>
              <span className="text-xs text-muted-foreground">
                Display games that you have hidden from your library.
              </span>
            </div>
            <Switch checked={showHiddenGames} onCheckedChange={onShowHiddenGamesChange} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
