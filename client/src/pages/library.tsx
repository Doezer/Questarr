import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import EmptyState from "@/components/EmptyState";
import { Gamepad2, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useViewControls } from "@/hooks/use-view-controls";
import ViewControlsToolbar from "@/components/ViewControlsToolbar";
import { useDownloadSummary } from "@/hooks/use-download-summary";

export default function LibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { viewMode, setViewMode, listDensity, setListDensity } = useViewControls("library");
  const [showDownloadsOnly, setShowDownloadsOnly] = useState(false);
  const downloadSummaries = useDownloadSummary();

  const [showSearchResultsOnly, setShowSearchResultsOnly] = useState(false);

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games", "?status=owned,completed,downloading"],
  });

  // Library typically contains owned, completed, or actively downloading games
  const libraryGames = useMemo(() => {
    let result = games;
    if (showSearchResultsOnly) result = result.filter((g) => g.searchResultsAvailable);
    return result;
  }, [games, showSearchResultsOnly]);

  const displayedGames = useMemo(
    () => (showDownloadsOnly ? libraryGames.filter((g) => downloadSummaries[g.id]) : libraryGames),
    [libraryGames, showDownloadsOnly, downloadSummaries]
  );

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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Library</h1>
          {games.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{games.length}</span> game
              {games.length !== 1 ? "s" : ""} collected
            </p>
          )}
        </div>
        <div className="shrink-0 pt-1">
          <ViewControlsToolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            listDensity={listDensity}
            onListDensityChange={setListDensity}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Button
          variant={showSearchResultsOnly ? "default" : "outline"}
          size="sm"
          className={`h-7 gap-1.5 text-xs ${showSearchResultsOnly ? "text-violet-300 bg-violet-700 hover:bg-violet-600 border-violet-600" : ""}`}
          onClick={() => setShowSearchResultsOnly(!showSearchResultsOnly)}
          aria-label="Show games with search results only"
        >
          <Search className="h-3 w-3" />
          Has Results
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showDownloadsOnly ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowDownloadsOnly((v) => !v)}
              aria-label={showDownloadsOnly ? "Show all games" : "Show games with downloads only"}
            >
              <Download className="h-3 w-3" />
              Has Downloads
            </Button>
          </TooltipTrigger>
          <TooltipContent>{showDownloadsOnly ? "Show all" : "Has downloads"}</TooltipContent>
        </Tooltip>
      </div>

      {libraryGames.length === 0 && !isLoading ? (
        <EmptyState
          icon={Gamepad2}
          title="No games in library"
          description="Your library is looking a bit empty. Track games you own or want to play from the Discover page."
          actionLabel="Discover Games"
          actionLink="/discover"
        />
      ) : (
        <GameGrid
          games={displayedGames}
          onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
          onToggleHidden={(id, hidden) => hiddenMutation.mutate({ gameId: id, hidden })}
          isLoading={isLoading}
          viewMode={viewMode}
          density={listDensity}
          downloadSummaries={downloadSummaries}
        />
      )}
    </div>
  );
}
