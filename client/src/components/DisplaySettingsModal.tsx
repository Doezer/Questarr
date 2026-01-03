import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LayoutGrid, EyeOff } from "lucide-react";

interface DisplaySettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gridColumns: number;
  onGridColumnsChange: (columns: number) => void;
  showHiddenGames: boolean;
  onShowHiddenGamesChange: (show: boolean) => void;
}

export default function DisplaySettingsModal({
  open,
  onOpenChange,
  gridColumns,
  onGridColumnsChange,
  showHiddenGames,
  onShowHiddenGamesChange,
}: DisplaySettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Display Settings</DialogTitle>
          <DialogDescription>Customize how your game library is displayed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-4">
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
