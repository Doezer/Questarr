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
import EmptyState from "@/components/EmptyState";
import GameFilterPills from "@/components/GameFilterPills";
import { Star, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewControls } from "@/hooks/use-view-controls";
import ViewControlsToolbar from "@/components/ViewControlsToolbar";
import { useDownloadSummary } from "@/hooks/use-download-summary";

type SortOption = "release-asc" | "release-desc" | "added-desc" | "title-asc";

// ⚡ Bolt: Move sortGames outside of the component to prevent it from being recreated
// on every render, which would break the `useMemo` dependencies below if it were
// included in the dependency array.
export const sortGames = (gameList: Game[], currentSortBy: SortOption): Game[] => {
  const sorted = [...gameList];

  return sorted.sort((a, b) => {
    switch (currentSortBy) {
      case "release-asc": {
        if (!a.releaseDate && !b.releaseDate) return 0;
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime();
      }
      case "release-desc": {
        if (!a.releaseDate && !b.releaseDate) return 0;
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime();
      }
      case "added-desc": {
        if (!a.addedAt && !b.addedAt) return 0;
        if (!a.addedAt) return 1;
        if (!b.addedAt) return -1;
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      }
      case "title-asc":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
};

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

  // ⚡ Bolt: Memoize the sorted arrays to prevent re-sorting on every render
  // previously, `sortGames()` was called directly in the JSX render function
  const sortedUpcomingGames = useMemo(() => {
    return sortGames(upcomingGames, sortBy);
  }, [upcomingGames, sortBy]);

  const sortedReleasedGames = useMemo(() => {
    return sortGames(releasedGames, sortBy);
  }, [releasedGames, sortBy]);

  const sortedTbaGames = useMemo(() => {
    return sortGames(tbaGames, sortBy);
  }, [tbaGames, sortBy]);

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
      {/* Page header + display controls */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wishlist</h1>
          {games.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{games.length}</span> game
              {games.length !== 1 ? "s" : ""} wanted
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          <span className="text-xs text-muted-foreground hidden sm:inline">Sort</span>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-[160px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="release-desc">Release (Newest)</SelectItem>
              <SelectItem value="release-asc">Release (Oldest)</SelectItem>
              <SelectItem value="added-desc">Recently Added</SelectItem>
              <SelectItem value="title-asc">Title (A–Z)</SelectItem>
            </SelectContent>
          </Select>
          <ViewControlsToolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            listDensity={listDensity}
            onListDensityChange={setListDensity}
          />
        </div>
      </div>

      {/* Content filter pills */}
      <div className="flex items-center gap-2 mb-3">
        <Button
          variant={showUnreleased ? "secondary" : "outline"}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setShowUnreleased(!showUnreleased)}
        >
          {showUnreleased ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          Unreleased
        </Button>
        <GameFilterPills
          showSearchResultsOnly={showSearchResultsOnly}
          setShowSearchResultsOnly={setShowSearchResultsOnly}
          showDownloadsOnly={showDownloadsOnly}
          setShowDownloadsOnly={setShowDownloadsOnly}
        />
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
        <div className="space-y-12">
          {/* Released Section */}
          {releasedGames.length > 0 && (
            <section>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Released
                </h2>
                <span className="text-xs text-muted-foreground/60">{releasedGames.length}</span>
              </div>
              <GameGrid
                games={sortedReleasedGames}
                onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
                onToggleHidden={(id, hidden) => hiddenMutation.mutate({ gameId: id, hidden })}
                isLoading={isLoading}
                viewMode={viewMode}
                density={listDensity}
                downloadSummaries={downloadSummaries}
              />
            </section>
          )}

          {/* Upcoming Section */}
          {showUnreleased && upcomingGames.length > 0 && (
            <section>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Upcoming
                </h2>
                <span className="text-xs text-muted-foreground/60">{upcomingGames.length}</span>
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
            </section>
          )}

          {/* TBA Section */}
          {showUnreleased && tbaGames.length > 0 && (
            <section>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  To Be Announced
                </h2>
                <span className="text-xs text-muted-foreground/60">{tbaGames.length}</span>
              </div>
              <GameGrid
                games={sortedTbaGames}
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
