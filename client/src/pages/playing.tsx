import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gamepad2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import { useGridColumns } from "@/hooks/use-grid-columns";
import EmptyState from "@/components/EmptyState";
import GameFilterPills from "@/components/GameFilterPills";
import GridColumnsControl from "@/components/GridColumnsControl";
import { useViewControls } from "@/hooks/use-view-controls";
import PageToolbar from "@/components/PageToolbar";
import { useDownloadSummary } from "@/hooks/use-download-summary";
import { compareDates } from "@/lib/game-sort";

type SortOption = "added-desc" | "added-asc" | "title-asc";

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
  const { gridColumns: safeGridColumns, handleGridColumnsChange } =
    useGridColumns("playingGridColumns");

  const {
    data: games = [],
    isLoading,
    isError,
  } = useQuery<Game[]>({
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

  if (isError) {
    playingContent = (
      <EmptyState
        icon={Gamepad2}
        title="Failed to load games"
        description="Refresh the page or try again later."
      />
    );
  } else if (!isLoading && games.length === 0) {
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
            <GridColumnsControl
              columns={safeGridColumns}
              onColumnsChange={handleGridColumnsChange}
            />
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
