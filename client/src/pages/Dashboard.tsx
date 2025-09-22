import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { TrendingUp, Library, Heart, Calendar, Clock, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { gameAPI, statsAPI } from "@/lib/api";
import { transformGame, formatDate } from "@/lib/gameUtils";

export default function Dashboard() {
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

  // Get recent games (last 3 added) - sort by createdAt with safety
  const recentlyAdded = allGames
    .filter(game => game.createdAt) // Filter out games without createdAt
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 3)
    .map(transformGame);

  // Get upcoming releases (games with future release dates) with safety
  const today = new Date().toISOString().split('T')[0];
  const upcomingReleases = allGames
    .filter(game => game.releaseDate && game.releaseDate > today)
    .sort((a, b) => new Date(a.releaseDate || 0).getTime() - new Date(b.releaseDate || 0).getTime())
    .slice(0, 3)
    .map(game => ({
      title: game.title,
      date: formatDate(game.releaseDate),
      status: game.status
    }));

  if (hasError) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium">Failed to load dashboard</h3>
          <p className="text-muted-foreground">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your game collection and activity</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Games</CardTitle>
            <Library className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-total">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground">+{Math.floor((stats?.total || 0) / 10)} from last month</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wishlist</CardTitle>
            <Heart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-wishlist">{stats?.wishlist || 0}</div>
            <p className="text-xs text-muted-foreground">{upcomingReleases.length} releasing soon</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Currently Playing</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-playing">{stats?.playing || 0}</div>
            <p className="text-xs text-muted-foreground">Currently active</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-stat-month">{stats?.completed || 0}</div>
            <p className="text-xs text-muted-foreground">Games completed</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recently Added */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-6 bg-muted rounded w-48"></div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="aspect-[3/4] bg-muted rounded"></div>
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <GameGrid 
              games={recentlyAdded} 
              title="Recently Added"
              showFilters={false}
            />
          )}
        </div>

        {/* Upcoming Releases */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Upcoming Releases
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingReleases.map((release, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{release.title}</p>
                    <p className="text-xs text-muted-foreground">{release.date}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {release.status}
                  </Badge>
                </div>
              ))}
              <div className="text-center pt-2">
                <Badge variant="secondary" className="text-xs">
                  View All Upcoming
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}