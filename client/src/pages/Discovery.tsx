import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, Star, Calendar, AlertCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gameAPI, statsAPI } from "@/lib/api";
import { transformGame } from "@/lib/gameUtils";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";

export default function Discovery() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("trending");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allGames = [], isLoading, isError } = useQuery({
    queryKey: ["games"],
    queryFn: gameAPI.getAll,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: statsAPI.get,
  });

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

  // Filter and organize games based on active tab and search
  const discoveryGames = useMemo(() => {
    let filteredGames = allGames;

    // Apply search filter if search query exists
    if (searchQuery) {
      const searchTerm = searchQuery.toLowerCase();
      filteredGames = filteredGames.filter(game =>
        game.title.toLowerCase().includes(searchTerm) ||
        game.genre.toLowerCase().includes(searchTerm) ||
        (game.description && game.description.toLowerCase().includes(searchTerm))
      );
    }

    // Apply tab filter
    const today = new Date().toISOString().split('T')[0];
    switch (activeTab) {
      case "new":
        return filteredGames
          .filter(game => game.releaseDate && game.releaseDate <= today)
          .sort((a, b) => new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime())
          .map(transformGame);
      case "upcoming":
        return filteredGames
          .filter(game => game.releaseDate && game.releaseDate > today)
          .sort((a, b) => new Date(a.releaseDate || 0).getTime() - new Date(b.releaseDate || 0).getTime())
          .map(transformGame);
      case "trending":
      default:
        return filteredGames
          .sort((a, b) => (parseFloat(b.rating || "0") - parseFloat(a.rating || "0")))
          .map(transformGame);
    }
  }, [allGames, searchQuery, activeTab]);

  // Generate trending genres from actual data
  const trendingGenres = useMemo(() => {
    const genreCounts = allGames.reduce((acc, game) => {
      acc[game.genre] = (acc[game.genre] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([name, count]) => ({ name, count }));
  }, [allGames]);

  const tabs = [
    { id: "trending", label: "Trending", icon: TrendingUp },
    { id: "new", label: "New Releases", icon: Star },
    { id: "upcoming", label: "Coming Soon", icon: Calendar }
  ];

  const handleSearch = () => {
    console.log(`Searching for: ${searchQuery}`);
    // Search is handled automatically via useMemo
  };

  const handleStatusChange = (gameId: string, status: GameStatus) => {
    updateStatusMutation.mutate({ gameId, status });
  };

  const handleGameClick = (game: Game) => {
    console.log(`Clicked on discovery game: ${game.title}`);
  };

  if (isError) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium">Failed to load discovery</h3>
          <p className="text-muted-foreground">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-discovery-title">Discovery</h1>
        <p className="text-muted-foreground">Explore and discover new games to add to your collection</p>
      </div>

      {/* Search Bar */}
      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search for games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-discovery-search"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Button onClick={handleSearch} data-testid="button-search">
          Search
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 border-b">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab(tab.id)}
                  className="gap-2"
                  data-testid={`button-tab-${tab.id}`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              );
            })}
          </div>

          {/* Games Grid */}
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-6 bg-muted rounded w-48"></div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => (
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
              games={discoveryGames}
              title={`${tabs.find(t => t.id === activeTab)?.label} Games`}
              onGameClick={handleGameClick}
              onStatusChange={handleStatusChange}
              showFilters={true}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Trending Genres */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Trending Genres
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {trendingGenres.map((genre) => (
                <div key={genre.name} className="flex items-center justify-between">
                  <span className="text-sm">{genre.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {genre.count}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Star className="h-4 w-4 mr-2" />
                Browse Top Rated
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Calendar className="h-4 w-4 mr-2" />
                View Release Calendar
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <TrendingUp className="h-4 w-4 mr-2" />
                Popular This Week
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}