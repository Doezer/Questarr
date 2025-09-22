import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, TrendingUp, AlertCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gameAPI, statsAPI } from "@/lib/api";
import { transformGame, calculateDaysUntil, formatDate } from "@/lib/gameUtils";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";

export default function Wishlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ["stats"],
    queryFn: statsAPI.get,
  });

  const { data: allGames = [], isLoading: gamesLoading, isError: gamesError } = useQuery({
    queryKey: ["games"],
    queryFn: gameAPI.getAll,
  });

  const isLoading = statsLoading || gamesLoading;
  const hasError = statsError || gamesError;

  const updateStatusMutation = useMutation({
    mutationFn: ({ gameId, status }: { gameId: string; status: GameStatus }) =>
      gameAPI.updateStatus(gameId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["games"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      toast({
        title: "Game updated",
        description: "Status updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update game status",
        variant: "destructive",
      });
    },
  });

  const wishlistedGames = allGames
    .filter(game => game.status === "wishlist")
    .map(transformGame);

  const today = new Date().toISOString().split('T')[0];
  const upcomingReleases = allGames
    .filter(game => game.status === "wishlist" && game.releaseDate && game.releaseDate > today)
    .sort((a, b) => new Date(a.releaseDate || 0).getTime() - new Date(b.releaseDate || 0).getTime())
    .slice(0, 3)
    .map(game => ({
      title: game.title,
      date: formatDate(game.releaseDate),
      daysUntil: calculateDaysUntil(game.releaseDate)
    }));

  const handleStatusChange = (gameId: string, status: GameStatus) => {
    updateStatusMutation.mutate({ gameId, status });
  };

  if (hasError) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium">Failed to load wishlist</h3>
          <p className="text-muted-foreground">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  const handleGameClick = (game: Game) => {
    console.log(`Clicked on wishlist game: ${game.title}`);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-wishlist-title">Wishlist</h1>
        <p className="text-muted-foreground">Games you're tracking for release</p>
      </div>

      {/* Wishlist Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Wishlisted</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-wishlist-total">{stats?.wishlist || 0}</div>
            <p className="text-xs text-muted-foreground">{upcomingReleases.length} releasing soon</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-wishlist-month">{upcomingReleases.filter(r => r.daysUntil <= 30).length}</div>
            <p className="text-xs text-muted-foreground">Games releasing this month</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Next Release</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingReleases.length > 0 ? (
              <>
                <div className="text-lg font-semibold">{upcomingReleases[0].title.split(':')[0]}</div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">{upcomingReleases[0].daysUntil} days</Badge>
                  <span className="text-xs text-muted-foreground">{upcomingReleases[0].date}</span>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No upcoming releases</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Wishlist Games */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="text-lg">Loading your wishlist...</div>
            </div>
          ) : (
            <GameGrid
              games={wishlistedGames}
              title="Your Wishlist"
              onGameClick={handleGameClick}
              onStatusChange={handleStatusChange}
              showFilters={true}
            />
          )}
        </div>

        {/* Release Timeline */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Release Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingReleases.map((release, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-sm leading-tight">{release.title}</p>
                      <p className="text-xs text-muted-foreground">{release.date}</p>
                    </div>
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {release.daysUntil} days
                    </Badge>
                  </div>
                  {index < upcomingReleases.length - 1 && (
                    <div className="border-l-2 border-muted h-4 ml-2"></div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}