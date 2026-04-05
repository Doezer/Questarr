import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import EmptyState from "@/components/EmptyState";
import GameFilterPills from "@/components/GameFilterPills";
import { Star, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewControls } from "@/hooks/use-view-controls";
import PageToolbar from "@/components/PageToolbar";
import { useDownloadSummary } from "@/hooks/use-download-summary";

type SortOption = "release-asc" | "release-desc" | "added-desc" | "title-asc";

const SORT_OPTIONS = [
  { value: "release-desc", label: "Release (Newest)" },
  { value: "release-asc", label: "Release (Oldest)" },
  { value: "added-desc", label: "Recently Added" },
  { value: "title-asc", label: "Title (A–Z)" },
];

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

  const wishlistGames = useMemo(() => {
    if (showSearchResultsOnly) return games.filter((g) => g.searchResultsAvailable);
    return games;
  }, [games, showSearchResultsOnly]);

  const filteredGames = useMemo(
    () =>
      showDownloadsOnly ? wishlistGames.filter((g) => downloadSummaries[g.id]) : wishlistGames,
    [wishlistGames, showDownloadsOnly, downloadSummaries]
  );

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
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wishlist</h1>
          {games.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{games.length}</span> game
              {games.length !== 1 ? "s" : ""} wanted
            </p>
          )}
        </div>

        <PageToolbar
          filterPills={
            <>
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
            {releasedGames.length > 0 && (
              <section>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Released
                  </h2>
                  <span className="text-xs text-muted-foreground/60">{releasedGames.length}</span>
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
              </section>
            )}

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

            {showUnreleased && tbaGames.length > 0 && (
              <section>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    To Be Announced
                  </h2>
                  <span className="text-xs text-muted-foreground/60">{tbaGames.length}</span>
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
    </div>
  );
}
