import { LayoutGrid, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GRID_COLUMNS_MIN, GRID_COLUMNS_MAX } from "@/hooks/use-grid-columns";

interface GridColumnsControlProps {
  readonly columns: number;
  readonly onColumnsChange: (value: number[]) => void;
}

/** The "Configure grid columns" popover/slider shared by the Library, Wishlist, and Playing toolbars. */
export default function GridColumnsControl({ columns, onColumnsChange }: GridColumnsControlProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Configure grid columns"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <LayoutGrid className="h-4 w-4" />
              Grid Columns
            </Label>
            <span className="w-4 text-center text-sm font-bold">{columns}</span>
          </div>
          <Slider
            value={[columns]}
            onValueChange={onColumnsChange}
            min={GRID_COLUMNS_MIN}
            max={GRID_COLUMNS_MAX}
            step={1}
            aria-label="Grid columns"
          />
          <p className="text-xs text-muted-foreground">
            Number of columns in the game grid ({GRID_COLUMNS_MIN}-{GRID_COLUMNS_MAX}).
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
