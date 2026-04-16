import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import PageToolbar from "./PageToolbar";
import GameGrid from "./GameGrid";
import AddGameModal from "./AddGameModal";
import {
  Bookmark,
  CheckCircle2,
  EyeOff,
  Filter,
  LayoutGrid,
  Library,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { calculateLibraryStats } from "@/lib/stats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useViewControls } from "@/hooks/use-view-controls";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { setAddGamePendingQuery, clearAddGamePendingQuery } from "@/lib/add-game-store";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const clearAllFilters = useCallback(() => {
    setStatusFilter("all");
    setGenreFilter("all");
    setPlatformFilter("all");
  }, []);

  const { viewMode, setViewMode, listDensity, setListDensity } = useViewControls("dashboard");
  const [gridColumns, setGridColumns] = useLocalStorageState("dashboardGridColumns", 5);
  const [showHiddenGames, setShowHiddenGames] = useLocalStorageState("showHiddenGames", false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: games = [],
    isLoading,
    isFetching,
  } = useQuery<Game[]>({
    queryKey: ["/api/games", debouncedSearchQuery, showHiddenGames],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchQuery.trim()) params.set("search", debouncedSearchQuery.trim());
      if (showHiddenGames) params.set("includeHidden", "true");
      const response = await apiRequest("GET", `/api/games?${params}`);
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

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

  const uniqueGenres = useMemo(
    () =>
      Array.from(new Set(games.flatMap((g) => g.genres ?? []))).sort((a, b) => a.localeCompare(b)),
    [games]
  );

  const uniquePlatforms = useMemo(
    () =>
      Array.from(new Set(games.flatMap((g) => g.platforms ?? []))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [games]
  );

  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      if (statusFilter !== "all" && game.status !== statusFilter) return false;
      if (genreFilter !== "all" && !game.genres?.includes(genreFilter)) return false;
      if (platformFilter !== "all" && !game.platforms?.includes(platformFilter)) return false;
      return true;
    });
  }, [games, statusFilter, genreFilter, platformFilter]);

  const activeFilters = useMemo(() => {
    const filters: { label: string; onRemove: () => void }[] = [];
    if (statusFilter !== "all")
      filters.push({ label: `Status: ${statusFilter}`, onRemove: () => setStatusFilter("all") });
    if (genreFilter !== "all")
      filters.push({ label: `Genre: ${genreFilter}`, onRemove: () => setGenreFilter("all") });
    if (platformFilter !== "all")
      filters.push({
        label: `Platform: ${platformFilter}`,
        onRemove: () => setPlatformFilter("all"),
      });
    return filters;
  }, [statusFilter, genreFilter, platformFilter]);

  const libStats = useMemo(() => calculateLibraryStats(games), [games]);
  const filtersActive = filteredGames.length < games.length;

  // Sync dashboard search query to the add-game store so the Header's AddGameModal
  // can pre-fill when opened while the user has typed something here.
  useEffect(() => {
    setAddGamePendingQuery(searchQuery);
  }, [searchQuery]);

  // Clear the add-game store only on unmount.
  useEffect(() => {
    return () => {
      clearAddGamePendingQuery();
    };
  }, []);

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
      <div className="space-y-3">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Library</h1>
          {libStats.totalGames > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">
                  {filtersActive ? filteredGames.length : libStats.totalGames}
                </span>{" "}
                {filtersActive ? `of ${libStats.totalGames} games shown` : "games"}
              </span>
              <span className="opacity-30">·</span>
              <span className="flex items-center gap-1">
                <Bookmark className="h-3 w-3" />
                <span className="font-medium text-foreground">
                  {libStats.statusBreakdown.wanted}
                </span>{" "}
                wanted
              </span>
              <span className="opacity-30">·</span>
              <span className="flex items-center gap-1">
                <Library className="h-3 w-3" />
                <span className="font-medium text-foreground">
                  {libStats.statusBreakdown.owned}
                </span>{" "}
                owned
              </span>
              <span className="opacity-30">·</span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span className="font-medium text-foreground">
                  {libStats.statusBreakdown.completed}
                </span>{" "}
                completed
              </span>
              {libStats.avgRating !== "N/A" && (
                <>
                  <span className="opacity-30">·</span>
                  <span>
                    avg.{" "}
                    <span className="font-medium text-foreground">
                      <span aria-hidden="true">⭐</span> {libStats.avgRating}
                    </span>
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Toolbar: search + view controls + filter toggle + grid settings */}
        <PageToolbar
          search={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search your library..."
          viewControls={{
            viewMode,
            onViewModeChange: setViewMode,
            listDensity,
            onListDensityChange: setListDensity,
          }}
          actions={
            <>
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setShowFilters((v) => !v)}
                aria-label="Toggle filters"
                aria-expanded={showFilters}
              >
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Filters</span>
                {activeFilters.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold w-4 h-4 flex items-center justify-center">
                    {activeFilters.length}
                  </span>
                )}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8" aria-label="Grid settings">
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 space-y-4 p-4">
                  <div
                    className={`space-y-3 ${viewMode === "list" ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <Label
                        className="flex items-center gap-2 text-sm font-medium"
                        aria-disabled={viewMode === "list"}
                      >
                        <LayoutGrid className="h-4 w-4" />
                        Grid Columns
                      </Label>
                      <span className="text-sm font-bold w-4 text-center">{gridColumns}</span>
                    </div>
                    <Slider
                      value={[gridColumns]}
                      onValueChange={([val]) => setGridColumns(val)}
                      min={2}
                      max={10}
                      step={1}
                      disabled={viewMode === "list"}
                      aria-label="Grid columns"
                    />
                    <p className="text-xs text-muted-foreground">
                      {viewMode === "list"
                        ? "Switch to grid view to adjust the number of columns."
                        : "Number of columns in the game grid (2–10)."}
                    </p>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <Label
                      htmlFor="show-hidden"
                      className="flex items-center gap-2 text-sm font-medium cursor-pointer"
                    >
                      <EyeOff className="h-4 w-4" />
                      Show Hidden Games
                    </Label>
                    <Switch
                      id="show-hidden"
                      checked={showHiddenGames}
                      onCheckedChange={setShowHiddenGames}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </>
          }
        />

        {/* Active filter badges */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((f) => (
              <Badge key={f.label} variant="secondary" className="gap-1">
                {f.label}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-3 w-3 p-0 hover:bg-transparent"
                  onClick={f.onRemove}
                  aria-label={`Remove filter: ${f.label}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground px-2"
              onClick={clearAllFilters}
            >
              <X className="h-3 w-3" />
              Clear all
            </Button>
            <span className="text-xs text-muted-foreground">
              {filteredGames.length} of {games.length} shown
            </span>
          </div>
        )}

        {/* Filter panel */}
        {showFilters && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <Label className="text-sm font-semibold">Filters</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        {filteredGames.length === 0 ? (
          (() => {
            const hasActiveFilters =
              debouncedSearchQuery.trim() ||
              statusFilter !== "all" ||
              genreFilter !== "all" ||
              platformFilter !== "all";
            return hasActiveFilters ? (
              debouncedSearchQuery.trim() ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <p className="text-lg font-medium mb-1">
                    No results for &ldquo;{debouncedSearchQuery}&rdquo;
                  </p>
                  <p className="text-sm text-muted-foreground mb-6">
                    This game isn&apos;t in your library yet.
                  </p>
                  <AddGameModal initialQuery={debouncedSearchQuery}>
                    <Button size="lg" className="gap-2" data-testid="button-add-game-from-search">
                      <Plus className="w-4 h-4" />
                      Add &ldquo;{debouncedSearchQuery}&rdquo; to collection
                    </Button>
                  </AddGameModal>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <p className="text-lg font-medium mb-1">No games match your current filters</p>
                  <p className="text-sm text-muted-foreground">
                    Try adjusting or clearing your filters.
                  </p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <p className="text-lg font-medium mb-1">No games yet</p>
                <p className="text-sm text-muted-foreground mb-6">
                  Start building your library by adding a game.
                </p>
                <AddGameModal initialQuery="">
                  <Button size="lg" className="gap-2">
                    <Plus className="w-4 h-4" />
                    Add your first game
                  </Button>
                </AddGameModal>
              </div>
            );
          })()
        ) : (
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
        )}
      </div>
    </div>
  );
}
