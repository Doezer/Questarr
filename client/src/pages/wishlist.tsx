import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type SortOption = "release-asc" | "release-desc" | "added-desc" | "title-asc";

export default function WishlistPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sortBy, setSortBy] = useState<SortOption>("release-desc");

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  // Wishlist contains 'wanted' games
  const wishlistGames = games.filter((g) => g.status === "wanted");

  // Separate released and unreleased games
  const { releasedGames, upcomingGames, tbaGames } = useMemo(() => {
    const now = new Date();
    const released: Game[] = [];
    const upcoming: Game[] = [];
    const tba: Game[] = [];

    wishlistGames.forEach((game) => {
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
  }, [wishlistGames]);

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
      const response = await fetch(`/api/games/${gameId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update status");
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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Wishlist</h1>
          <p className="text-muted-foreground">Games you want to play</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort by:</span>
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

      {wishlistGames.length === 0 && !isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Your wishlist is empty. Add games from the Discover page.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Upcoming Section */}
          {upcomingGames.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-semibold">Upcoming</h2>
                <Badge variant="default">{upcomingGames.length}</Badge>
              </div>
              <GameGrid
                games={sortGames(upcomingGames)}
                onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
                isLoading={isLoading}
              />
              <Separator className="mt-8" />
            </section>
          )}

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
                isLoading={isLoading}
              />
              <Separator className="mt-8" />
            </section>
          )}

          {/* TBA Section */}
          {tbaGames.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-semibold">To Be Announced</h2>
                <Badge variant="secondary">{tbaGames.length}</Badge>
              </div>
              <GameGrid
                games={sortGames(tbaGames)}
                onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
                isLoading={isLoading}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
