import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import SearchBar from "./SearchBar";
import GameGrid from "./GameGrid";
import StatsCard from "./StatsCard";
import {
  Star,
  Gamepad2,
  Tags,
  Filter,
  X,
  Calendar,
  Building2,
  Code2,
} from "lucide-react";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DisplaySettingsModal from "./DisplaySettingsModal";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [showFilters, setShowFilters] = useState(false);
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [gridColumns, setGridColumns] = useState<number>(() => {
    const saved = localStorage.getItem("dashboardGridColumns");
    return saved ? parseInt(saved, 10) : 5;
  });
  const [showHiddenGames, setShowHiddenGames] = useState<boolean>(() => {
    return localStorage.getItem("showHiddenGames") === "true";
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    localStorage.setItem("dashboardGridColumns", gridColumns.toString());
  }, [gridColumns]);

  useEffect(() => {
    localStorage.setItem("showHiddenGames", showHiddenGames.toString());
  }, [showHiddenGames]);

  // Query user's collection
  const {
    data: games = [],
    isLoading,
    isFetching,
  } = useQuery<Game[]>({
    queryKey: ["/api/games", debouncedSearchQuery, showHiddenGames],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchQuery.trim()) {
        params.set("search", debouncedSearchQuery.trim());
      }
      if (showHiddenGames) {
        params.set("includeHidden", "true");
      }

      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/games?${params}`, { headers });
      if (!response.ok) throw new Error("Failed to fetch games");
      return response.json();
    },
  });

  // Status update mutation (for existing games in collection)
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

  // Hidden update mutation
  const hiddenMutation = useMutation({
    mutationFn: async ({ gameId, hidden }: { gameId: string; hidden: boolean }) => {
      const response = await apiRequest("PATCH", `/api/games/${gameId}/hidden`, { hidden });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: data.hidden ? "Game hidden from library" : "Game unhidden" });
    },
    onError: () => {
      toast({ description: "Failed to update game visibility", variant: "destructive" });
    },
  });

  // Calculate unique genres and platforms from user's game collection
  const uniqueGenres = useMemo(() => {
    return Array.from(new Set(games.flatMap((g) => g.genres ?? []))).sort();
  }, [games]);

  const uniquePlatforms = useMemo(() => {
    return Array.from(new Set(games.flatMap((g) => g.platforms ?? []))).sort();
  }, [games]);

  // Filter games based on active filters
  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      // Status filter
      if (statusFilter !== "all" && game.status !== statusFilter) {
        return false;
      }
      // Genre filter
      if (genreFilter !== "all" && !game.genres?.includes(genreFilter)) {
        return false;
      }
      // Platform filter
      if (platformFilter !== "all" && !game.platforms?.includes(platformFilter)) {
        return false;
      }
      return true;
    });
  }, [games, statusFilter, genreFilter, platformFilter]);

  // Active filters for display
  const activeFilters = useMemo(() => {
    const filters: string[] = [];
    if (statusFilter !== "all") filters.push(`Status: ${statusFilter}`);
    if (genreFilter !== "all") filters.push(`Genre: ${genreFilter}`);
    if (platformFilter !== "all") filters.push(`Platform: ${platformFilter}`);
    return filters;
  }, [statusFilter, genreFilter, platformFilter]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalGames = games.length;
    if (totalGames === 0) return [];

    // Avg Rating
    const ratedGames = games.filter((g) => g.rating !== null);
    const avgRating =
      ratedGames.length > 0
        ? (ratedGames.reduce((acc, g) => acc + (g.rating || 0), 0) / ratedGames.length).toFixed(1)
        : "N/A";

    // Top Genre
    const genreCounts: Record<string, number> = {};
    games
      .flatMap((g) => g.genres || [])
      .forEach((g) => (genreCounts[g] = (genreCounts[g] || 0) + 1));
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];

    // Top Platform
    const platformCounts: Record<string, number> = {};
    games
      .flatMap((g) => g.platforms || [])
      .forEach((p) => (platformCounts[p] = (platformCounts[p] || 0) + 1));
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0];

    // Avg Release Year
    const datedGames = games.filter((g) => g.releaseDate);
    const avgYear =
      datedGames.length > 0
        ? Math.round(
            datedGames.reduce((acc, g) => acc + new Date(g.releaseDate!).getFullYear(), 0) /
              datedGames.length
          )
        : "N/A";

    // Top Publisher
    const publisherCounts: Record<string, number> = {};
    games
      .flatMap((g) => g.publishers || [])
      .forEach((p) => (publisherCounts[p] = (publisherCounts[p] || 0) + 1));
    const topPublisher = Object.entries(publisherCounts).sort((a, b) => b[1] - a[1])[0];

    // Developer Count
    const uniqueDevelopers = new Set(games.flatMap((g) => g.developers || []));

    // Metadata Completeness (simple check: title, summary, cover, releaseDate, rating)
    const completeGames = games.filter(
      (g) => g.title && g.summary && g.coverUrl && g.releaseDate && g.rating
    );
    const metadataCompleteness = Math.round((completeGames.length / totalGames) * 100);

    return [
      {
        title: "Avg. Rating",
        value: avgRating,
        subtitle: "average rating",
        icon: Star,
      },
      {
        title: "Top Genre",
        value: topGenre ? topGenre[0] : "N/A",
        subtitle: topGenre ? `${topGenre[1]} games` : "no genres",
        icon: Tags,
      },
      {
        title: "Top Platform",
        value: topPlatform ? topPlatform[0] : "N/A",
        subtitle: topPlatform ? `${topPlatform[1]} games` : "no platforms",
        icon: Gamepad2,
      },
      {
        title: "Top Publisher",
        value: topPublisher ? topPublisher[0] : "N/A",
        subtitle: topPublisher ? `${topPublisher[1]} games` : "no publishers",
        icon: Building2,
      },
      {
        title: "Developers",
        value: uniqueDevelopers.size,
        subtitle: "unique developers",
        icon: Code2,
      },
      {
        title: "Avg. Year",
        value: avgYear,
        subtitle: "release year",
        icon: Calendar,
      },
      {
        title: "Metadata Health",
        value: `${metadataCompleteness}%`,
        subtitle: "complete metadata",
        icon: Filter,
      },
    ];
  }, [games]);

  // ⚡ Bolt: Memoize event handlers with `useCallback` to prevent unnecessary
  // re-renders in child components like `SearchBar` that depend on stable
  // function references.
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleFilterToggle = useCallback(() => {
    setShowFilters((prev) => !prev);
  }, []);

  const handleRemoveFilter = useCallback((filter: string) => {
    // Parse filter string (format: "Type: Value")
    const [type] = filter.split(": ");
    if (type === "Status") setStatusFilter("all");
    else if (type === "Genre") setGenreFilter("all");
    else if (type === "Platform") setPlatformFilter("all");
  }, []);

  const clearAllFilters = useCallback(() => {
    setStatusFilter("all");
    setGenreFilter("all");
    setPlatformFilter("all");
  }, []);

  // ⚡ Bolt: Memoize `handleStatusChange` with `useCallback`.
  // This function is passed down through `GameGrid` to `GameCard` components.
  // Since `GameCard` is wrapped in `React.memo`, passing a stable function
  // reference is crucial to prevent every card from re-rendering whenever
  // the `Dashboard` component re-renders. Without `useCallback`, a new
  // function would be created on each render, defeating the purpose of memoization.
  const handleStatusChange = useCallback(
    (gameId: string, newStatus: GameStatus) => {
      statusMutation.mutate({ gameId, status: newStatus });
    },
    [statusMutation]
  );

  const handleToggleHidden = useCallback(
    (gameId: string, hidden: boolean) => {
      hiddenMutation.mutate({ gameId, hidden });
    },
    [hiddenMutation]
  );

  return (
    <div className="h-full overflow-auto p-6" data-testid="layout-dashboard">
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {stats.map((stat) => (
            <StatsCard
              key={stat.title}
              title={stat.title}
              value={stat.value}
              subtitle={stat.subtitle}
              icon={stat.icon}
            />
          ))}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Recent Additions</h2>
          <SearchBar
            onSearch={handleSearch}
            onFilterToggle={handleFilterToggle}
            onLayoutSettingsToggle={() => setShowDisplaySettings(true)}
            activeFilters={activeFilters}
            onRemoveFilter={handleRemoveFilter}
            placeholder="Search your library..."
          />

          {/* Filter Panel */}
          {showFilters && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Filters</Label>
                  {activeFilters.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-2">
                      <X className="w-4 h-4" />
                      Clear All
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Status Filter */}
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={statusFilter}
                      onValueChange={(value) => setStatusFilter(value as GameStatus | "all")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="wanted">Wanted</SelectItem>
                        <SelectItem value="owned">Owned</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="downloading">Downloading</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Genre Filter */}
                  <div className="space-y-2">
                    <Label>Genre</Label>
                    <Select value={genreFilter} onValueChange={setGenreFilter}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Genres</SelectItem>
                        {uniqueGenres.map((genre) => (
                          <SelectItem key={genre} value={genre}>
                            {genre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Platform Filter */}
                  <div className="space-y-2">
                    <Label>Platform</Label>
                    <Select value={platformFilter} onValueChange={setPlatformFilter}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Platforms</SelectItem>
                        {uniquePlatforms.map((platform) => (
                          <SelectItem key={platform} value={platform}>
                            {platform}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <DisplaySettingsModal
            open={showDisplaySettings}
            onOpenChange={setShowDisplaySettings}
            gridColumns={gridColumns}
            onGridColumnsChange={setGridColumns}
            showHiddenGames={showHiddenGames}
            onShowHiddenGamesChange={setShowHiddenGames}
          />

          <GameGrid
            games={filteredGames}
            onStatusChange={handleStatusChange}
            onToggleHidden={handleToggleHidden}
            isLoading={isLoading}
            isFetching={isFetching}
            columns={gridColumns}
          />
        </div>
      </div>
    </div>
  );
}
