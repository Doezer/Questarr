import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import SearchBar from "./SearchBar";
import GameGrid from "./GameGrid";
import StatsCard from "./StatsCard";
import { Star, Gamepad2, Filter, X } from "lucide-react";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { calculateLibraryStats } from "@/lib/stats";
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

  // View Settings
  const [gridColumns, setGridColumns] = useState<number>(() => {
    const saved = localStorage.getItem("dashboardGridColumns");
    return saved ? parseInt(saved, 10) : 5;
  });
  const [showHiddenGames, setShowHiddenGames] = useState<boolean>(() => {
    return localStorage.getItem("showHiddenGames") === "true";
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("dashboardViewMode") as "grid" | "list") || "grid";
  });

  const [listDensity, setListDensity] = useState<"comfortable" | "compact" | "ultra-compact">(
    () => {
      return (
        (localStorage.getItem("dashboardListDensity") as
          | "comfortable"
          | "compact"
          | "ultra-compact") || "comfortable"
      );
    }
  );

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    localStorage.setItem("dashboardGridColumns", gridColumns.toString());
  }, [gridColumns]);

  useEffect(() => {
    localStorage.setItem("showHiddenGames", showHiddenGames.toString());
  }, [showHiddenGames]);

  useEffect(() => {
    localStorage.setItem("dashboardViewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("dashboardListDensity", listDensity);
  }, [listDensity]);

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

      const response = await apiRequest("GET", `/api/games?${params}`);
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

  // Calculate statistics using the new utility
  const stats = useMemo(() => {
    const libStats = calculateLibraryStats(games);
    if (!libStats.totalGames) return [];

    return [
      {
        title: "Total Games",
        value: libStats.totalGames,
        subtitle: "in library",
        icon: Gamepad2,
      },
      {
        title: "Avg. Rating",
        value: libStats.avgRating,
        subtitle: "average rating",
        icon: Star,
      },
      {
        title: "Metadata Health",
        value: `${libStats.metadataHealth}%`,
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            density={listDensity}
            onDensityChange={setListDensity}
          />

          <GameGrid
            games={filteredGames}
            onStatusChange={handleStatusChange}
            onToggleHidden={handleToggleHidden}
            isLoading={isLoading}
            isFetching={isFetching}
            columns={gridColumns}
            viewMode={viewMode}
            density={listDensity}
          />
        </div>
      </div>
    </div>
  );
}
