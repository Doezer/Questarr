import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import EmptyState from "@/components/EmptyState";
import { Star, Eye, EyeOff, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useViewControls } from "@/hooks/use-view-controls";
import ViewControlsToolbar from "@/components/ViewControlsToolbar";
import { useDownloadSummary } from "@/hooks/use-download-summary";

type SortOption = "release-asc" | "release-desc" | "added-desc" | "title-asc";

export default function WishlistPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sortBy, setSortBy] = useState<SortOption>("release-desc");
  const { viewMode, setViewMode, listDensity, setListDensity } = useViewControls("wishlist");
  const [showUnreleased, setShowUnreleased] = useLocalStorageState("wishlistShowUnreleased", true);
  const [showDownloadsOnly, setShowDownloadsOnly] = useState(false);
  const downloadSummaries = useDownloadSummary();
  const [showSearchResultsOnly, setShowSearchResultsOnly] = useState(false);

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games", "?status=wanted"],
  });

  // Wishlist contains 'wanted' games, optionally filtered to only those with search results
  const wishlistGames = useMemo(() => {
    if (showSearchResultsOnly) return games.filter((g) => g.searchResultsAvailable);
    return games;
  }, [games, showSearchResultsOnly]);

  const filteredGames = useMemo(
    () =>
      showDownloadsOnly ? wishlistGames.filter((g) => downloadSummaries[g.id]) : wishlistGames,
    [wishlistGames, showDownloadsOnly, downloadSummaries]
  );

  // Separate released and unreleased games
  const { releasedGames, upcomingGames, tbaGames } = useMemo(() => {
    const now = new Date();
    const released: Game[] = [];
    const upcoming: Game[] = [];
    const tba: Game[] = [];

    filteredGames.forEach((game) => {
      if (!game.releaseDate) {
        tba.push(game);
      } else {
        const releaseDate = new Date(game.releaseDate);
        if (releaseDate <= now) {
          released.push(game);
        } else {
          upcoming.push(game);
        }
      }
    });

    return { releasedGames: released, upcomingGames: upcoming, tbaGames: tba };
  }, [filteredGames]);

  // Sort games based on selected option
  const sortGames = (gameList: Game[]): Game[] => {
    const sorted = [...gameList];

    switch (sortBy) {
      case "release-asc":
        return sorted.sort((a, b) => {
          if (!a.releaseDate) return 1;
          if (!b.releaseDate) return -1;
          return new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime();
        });
      case "release-desc":
        return sorted.sort((a, b) => {
          if (!a.releaseDate) return 1;
          if (!b.releaseDate) return -1;
          return new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime();
        });
      case "added-desc":
        return sorted.sort((a, b) => {
          if (!a.addedAt) return 1;
          if (!b.addedAt) return -1;
          return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
        });
      case "title-asc":
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      default:
        return sorted;
    }
  };

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
    hiddenSuccessMessage: "Game hidden from wishlist",
    unhiddenSuccessMessage: "Game unhidden",
    errorMessage: "Failed to update game visibility",
  });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Wishlist</h1>
          <p className="text-muted-foreground">Games you want to play</p>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant={showUnreleased ? "outline" : "secondary"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowUnreleased(!showUnreleased)}
          >
            {showUnreleased ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Unreleased</span>
          </Button>
          <Button
            variant={showSearchResultsOnly ? "default" : "outline"}
            size="sm"
            className={`h-8 gap-1.5 ${showSearchResultsOnly ? "text-violet-300 bg-violet-700 hover:bg-violet-600 border-violet-600" : ""}`}
            onClick={() => setShowSearchResultsOnly(!showSearchResultsOnly)}
            aria-label="Show games with search results only"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search Results</span>
          </Button>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showDownloadsOnly ? "default" : "outline"}
                  size="icon"
                  onClick={() => setShowDownloadsOnly((v) => !v)}
                  aria-label={
                    showDownloadsOnly ? "Show all games" : "Show games with downloads only"
                  }
                >
                  <Download className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showDownloadsOnly ? "Show all" : "Has downloads"}</TooltipContent>
            </Tooltip>
            <ViewControlsToolbar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              listDensity={listDensity}
              onListDensityChange={setListDensity}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline">Sort by:</span>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="release-desc">Release Date (Newest)</SelectItem>
                <SelectItem value="release-asc">Release Date (Oldest)</SelectItem>
                <SelectItem value="added-desc">Recently Added</SelectItem>
                <SelectItem value="title-asc">Title (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {wishlistGames.length === 0 && !isLoading ? (
        <EmptyState
          icon={Star}
          title="Your wishlist is empty"
          description="Keep track of games you want to play. Add them from the Discover page to get notified about releases and updates."
          actionLabel="Find Games"
          actionLink="/discover"
        />
      ) : (
        <div className="space-y-8">
          {/* Released Section */}
          {releasedGames.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-semibold">Released</h2>
                <Badge variant="outline" className="bg-green-500 border-green-600 text-white">
                  {releasedGames.length}
                </Badge>
              </div>
              <GameGrid
                games={sortGames(releasedGames)}
                onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
                onToggleHidden={(id, hidden) => hiddenMutation.mutate({ gameId: id, hidden })}
                isLoading={isLoading}
                viewMode={viewMode}
                density={listDensity}
                downloadSummaries={downloadSummaries}
              />
              {showUnreleased && (upcomingGames.length > 0 || tbaGames.length > 0) && (
                <Separator className="mt-8" />
              )}
            </section>
          )}

          {/* Upcoming Section */}
          {showUnreleased && upcomingGames.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-semibold">Upcoming</h2>
                <Badge variant="default">{upcomingGames.length}</Badge>
              </div>
              <GameGrid
                games={sortGames(upcomingGames)}
                onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
                onToggleHidden={(id, hidden) => hiddenMutation.mutate({ gameId: id, hidden })}
                isLoading={isLoading}
                viewMode={viewMode}
                density={listDensity}
                downloadSummaries={downloadSummaries}
              />
              {tbaGames.length > 0 && <Separator className="mt-8" />}
            </section>
          )}

          {/* TBA Section */}
          {showUnreleased && tbaGames.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-semibold">To Be Announced</h2>
                <Badge variant="secondary">{tbaGames.length}</Badge>
              </div>
              <GameGrid
                games={sortGames(tbaGames)}
                onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
                onToggleHidden={(id, hidden) => hiddenMutation.mutate({ gameId: id, hidden })}
                isLoading={isLoading}
                viewMode={viewMode}
                density={listDensity}
                downloadSummaries={downloadSummaries}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
