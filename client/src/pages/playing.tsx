import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, LayoutGrid, Settings2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import EmptyState from "@/components/EmptyState";
import GameFilterPills from "@/components/GameFilterPills";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useViewControls } from "@/hooks/use-view-controls";
import PageToolbar from "@/components/PageToolbar";
import { useDownloadSummary } from "@/hooks/use-download-summary";
import { compareDates } from "@/lib/game-sort";

type SortOption = "added-desc" | "added-asc" | "title-asc";

const GRID_COLUMNS_MIN = 2;
const GRID_COLUMNS_MAX = 10;

function sanitizeGridColumns(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(GRID_COLUMNS_MAX, Math.max(GRID_COLUMNS_MIN, Math.round(value)));
}

const SORT_OPTIONS = [
  { value: "added-desc", label: "Recently Added" },
  { value: "added-asc", label: "Oldest Added" },
  { value: "title-asc", label: "Title (A-Z)" },
];

function sortGames(gameList: Game[], currentSortBy: SortOption): Game[] {
  const sorted = [...gameList];
  return sorted.sort((a, b) => {
    switch (currentSortBy) {
      case "added-desc":
        return compareDates(a.addedAt, b.addedAt, false);
      case "added-asc":
        return compareDates(a.addedAt, b.addedAt, true);
      case "title-asc":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}

export default function PlayingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sortBy, setSortBy] = useState<SortOption>("added-desc");
  const { viewMode, setViewMode, listDensity, setListDensity } = useViewControls("playing");
  const [showDownloadsOnly, setShowDownloadsOnly] = useState(false);
  const downloadSummaries = useDownloadSummary();
  const [showSearchResultsOnly, setShowSearchResultsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [gridColumns, setGridColumns] = useLocalStorageState("playingGridColumns", 5);
  // localStorage can hold an out-of-range value (0, 1.5, 11, Infinity);
  // clamp to a finite integer in range and persist the corrected value.
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

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games", "?status=playing"],
  });

  const { filteredGames, filteredCount } = useMemo(() => {
    const lowercaseQuery = searchQuery?.toLowerCase() || "";
    const filtered = games.filter((game) => {
      if (showSearchResultsOnly && !game.searchResultsAvailable) return false;
      if (showDownloadsOnly && !downloadSummaries?.[game.id]) return false;
      if (searchQuery && !game.title.toLowerCase().includes(lowercaseQuery)) return false;
      return true;
    });
    return { filteredGames: filtered, filteredCount: filtered.length };
  }, [games, showSearchResultsOnly, showDownloadsOnly, downloadSummaries, searchQuery]);

  const sortedGames = useMemo(() => sortGames(filteredGames, sortBy), [filteredGames, sortBy]);

  const emptyStateContent = useMemo(() => {
    if (searchQuery) {
      return {
        title: "No games match your search",
        description: `No games currently playing found for "${searchQuery}".`,
      };
    }
    if (showDownloadsOnly && showSearchResultsOnly) {
      return {
        title: "No games match your filters",
        description: "Try disabling one or more filters to see more games.",
      };
    }
    if (showDownloadsOnly) {
      return {
        title: "No games with active downloads",
        description: "Try disabling one or more filters to see more games.",
      };
    }
    if (showSearchResultsOnly) {
      return {
        title: "No games with search results",
        description: "Try disabling one or more filters to see more games.",
      };
    }
    return {
      title: "No games match your filters",
      description: "Try adjusting your filters.",
    };
  }, [searchQuery, showDownloadsOnly, showSearchResultsOnly]);

  const statusMutation = useMutation({
    mutationFn: async ({ gameId, status }: { gameId: string; status: GameStatus }) => {
      const response = await apiRequest("PATCH", `/api/games/${gameId}/status`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: "Game status updated successfully" });
    },
    onError: () => {
      toast({ description: "Failed to update game status", variant: "destructive" });
    },
  });

  const hiddenMutation = useHiddenMutation({
    hiddenSuccessMessage: "Game hidden from library",
    unhiddenSuccessMessage: "Game unhidden",
    errorMessage: "Failed to update game visibility",
  });

  let playingContent: React.ReactNode;

  if (!isLoading && games.length === 0) {
    playingContent = (
      <EmptyState
        icon={Gamepad2}
        title="Nothing in progress"
        description="Mark a game as Playing from your Library to track it here — journal entries, screenshots, and milestones live on its details page."
        actionLabel="Go to Library"
        actionLink="/"
      />
    );
  } else if (!isLoading && filteredCount === 0) {
    playingContent = (
      <EmptyState
        icon={Gamepad2}
        title={emptyStateContent.title}
        description={emptyStateContent.description}
      />
    );
  } else {
    playingContent = (
      <GameGrid
        games={sortedGames}
        onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
        onToggleHidden={(id, hidden) => hiddenMutation.mutate({ gameId: id, hidden })}
        isLoading={isLoading}
        viewMode={viewMode}
        density={listDensity}
        downloadSummaries={downloadSummaries}
        columns={safeGridColumns}
      />
    );
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playing</h1>
          {games.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{games.length}</span> game
              {games.length !== 1 ? "s" : ""} in progress
            </p>
          )}
        </div>

        <PageToolbar
          search={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Filter playing..."
          actions={
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
                    <span className="w-4 text-center text-sm font-bold">{safeGridColumns}</span>
                  </div>
                  <Slider
                    value={[safeGridColumns]}
                    onValueChange={handleGridColumnsChange}
                    min={2}
                    max={10}
                    step={1}
                    aria-label="Grid columns"
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of columns in the game grid (2-10).
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          }
          filterPills={
            <>
              <GameFilterPills
                showSearchResultsOnly={showSearchResultsOnly}
                setShowSearchResultsOnly={setShowSearchResultsOnly}
                showDownloadsOnly={showDownloadsOnly}
                setShowDownloadsOnly={setShowDownloadsOnly}
              />
              {showSearchResultsOnly && showDownloadsOnly && (
                <p className="text-xs text-muted-foreground">Multiple filters active</p>
              )}
            </>
          }
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortOption)}
          sortOptions={SORT_OPTIONS}
          viewControls={{
            viewMode,
            onViewModeChange: setViewMode,
            listDensity,
            onListDensityChange: setListDensity,
          }}
        />

        {playingContent}
      </div>
    </div>
  );
}
