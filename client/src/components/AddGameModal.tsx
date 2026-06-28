import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Search, Plus, Star, AlertCircle, Calendar, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game, type InsertGame, type Config } from "@shared/schema";
import { mapGameToInsertGame } from "@/lib/utils";
import { Link } from "wouter";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { getAddGamePendingQuery, clearAddGamePendingQuery } from "@/lib/add-game-store";
import { useIsMobile } from "@/hooks/use-mobile";

interface SearchResult extends Game {
  inCollection?: boolean;
}

interface AddGameModalProps {
  children: React.ReactNode;
  initialQuery?: string;
}

export default function AddGameModal({ children, initialQuery }: AddGameModalProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showUndatedGames, setShowUndatedGames] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: config } = useQuery<Config>({
    queryKey: ["/api/config"],
    queryFn: () => apiRequest("GET", "/api/config").then((res) => res.json()),
  });

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Pre-fill search when modal opens (from prop or from the dashboard store)
  useEffect(() => {
    if (open) {
      const fromStore = getAddGamePendingQuery();
      const queryToUse = initialQuery ?? (fromStore || "");
      if (queryToUse) {
        setSearchQuery(queryToUse);
        setDebouncedQuery(queryToUse);
        clearAddGamePendingQuery();
      }
    } else {
      setSearchQuery("");
      setDebouncedQuery("");
      setShowUndatedGames(false);
    }
  }, [open, initialQuery]);

  // Search IGDB for games
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["/api/igdb/search", debouncedQuery, showUndatedGames],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return [];
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(
        `/api/igdb/search?q=${encodeURIComponent(debouncedQuery)}&limit=10&includeUndated=${showUndatedGames}`,
        { headers }
      );
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: debouncedQuery.trim().length > 2 && !!config?.igdb?.configured,
    placeholderData: keepPreviousData,
  });

  // Get user's collection to check if games are already added
  const { data: userGames = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  // Add game mutation
  const addGameMutation = useMutation({
    mutationFn: async (gameData: InsertGame) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await apiFetch("/api/games", {
        method: "POST",
        headers,
        body: JSON.stringify(gameData),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add game");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: "Game added to collection successfully" });
    },
    onError: (error: Error) => {
      toast({
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search is handled by the debounced query
  };

  const handleAddGame = (searchResult: SearchResult) => {
    // Map to InsertGame to filter out client-only fields before sending to server
    const gameData = mapGameToInsertGame(searchResult);
    addGameMutation.mutate(gameData);
  };

  const userGameIgdbIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of userGames) {
      if (g.igdbId != null) ids.add(g.igdbId);
    }
    return ids;
  }, [userGames]);

  // Mark games already in collection
  const resultsWithCollectionStatus: SearchResult[] = useMemo(() => {
    return searchResults.map((game: Game) => ({
      ...game,
      inCollection: game.igdbId != null ? userGameIgdbIds.has(game.igdbId) : false,
    }));
  }, [searchResults, userGameIgdbIds]);

  const igdbNotConfigured = config && !config.igdb?.configured;

  const isAddingGame = (igdbId: number | null | undefined) =>
    addGameMutation.isPending && addGameMutation.variables?.igdbId === igdbId;

  // ─── Mobile layout (bottom sheet) ────────────────────────────────────────────

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent className="h-[92vh] flex flex-col">
          <DrawerHeader className="pt-2 pb-0 px-4">
            <DrawerTitle className="text-base">Add Game</DrawerTitle>
            <DrawerDescription className="sr-only">
              Search for games to add to your collection
            </DrawerDescription>
          </DrawerHeader>

          {igdbNotConfigured ? (
            <div className="flex flex-col items-center justify-center flex-1 py-8 text-center space-y-4 px-6">
              <div className="bg-muted p-4 rounded-full">
                <AlertCircle className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-lg">IGDB Configuration Required</h3>
              <p className="text-muted-foreground text-sm">
                Please configure IGDB credentials in settings to search for and add games.
              </p>
              <Link href="/settings">
                <Button className="w-full" onClick={() => setOpen(false)}>
                  Go to Settings
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Sticky search + filter strip */}
              <div className="flex-shrink-0 px-4 pt-3 pb-3 space-y-2 border-b border-border/50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 pointer-events-none" />
                  <Input
                    type="search"
                    placeholder="Search for games..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-11"
                    data-testid="input-game-search"
                    aria-label="Search games"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="text-xs text-muted-foreground">Show undated games first</span>
                  <Switch
                    checked={showUndatedGames}
                    onCheckedChange={setShowUndatedGames}
                    aria-label="Show undated games first"
                  />
                </div>
              </div>

              {/* Scrollable results */}
              <div
                className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2"
                aria-live="polite"
              >
                {isSearching && (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    Searching games…
                  </div>
                )}

                {!isSearching && !debouncedQuery && (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    Type at least 3 characters to search.
                  </div>
                )}

                {!isSearching && debouncedQuery && resultsWithCollectionStatus.length === 0 && (
                  <div className="text-center py-10 text-sm text-muted-foreground">
                    No games found. Try a different search term.
                  </div>
                )}

                {resultsWithCollectionStatus.map((game) => (
                  <div
                    key={game.id}
                    className="flex gap-3 rounded-lg bg-muted/40 p-3"
                    data-testid={`search-result-${game.id}`}
                  >
                    <img
                      src={game.coverUrl || "/placeholder-game-cover.jpg"}
                      alt={`${game.title} cover`}
                      className="w-14 h-20 object-cover rounded-md flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          className="font-semibold text-sm leading-snug line-clamp-2 flex-1"
                          data-testid={`text-game-title-${game.id}`}
                        >
                          {game.title}
                        </h3>
                        {game.inCollection ? (
                          <Badge variant="default" className="text-xs flex-shrink-0 mt-0.5 gap-1">
                            <Check className="w-3 h-3" />
                            Added
                          </Badge>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddGame(game)}
                            disabled={addGameMutation.isPending}
                            className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
                            data-testid={`button-add-${game.id}`}
                            aria-label={`Add ${game.title} to collection`}
                          >
                            {isAddingGame(game.igdbId) ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Plus className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {game.releaseDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {game.releaseDate.endsWith("-12-31")
                              ? new Date(game.releaseDate).getFullYear()
                              : new Date(game.releaseDate).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                })}
                          </span>
                        )}
                        {game.rating && (
                          <span className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-accent" />
                            {game.rating}/10
                          </span>
                        )}
                      </div>

                      {game.genres?.[0] && (
                        <Badge variant="secondary" className="text-xs w-fit">
                          {game.genres[0]}
                        </Badge>
                      )}

                      {game.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {game.summary}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  // ─── Desktop layout (dialog, unchanged) ──────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Game to Collection</DialogTitle>
          <DialogDescription>Search for games to add to your collection</DialogDescription>
        </DialogHeader>

        {igdbNotConfigured ? (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
            <div className="bg-muted p-4 rounded-full">
              <AlertCircle className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg">IGDB Configuration Required</h3>
            <p className="text-muted-foreground max-w-sm">
              Please configure IGDB credentials in settings to search for and add games.
            </p>
            <Link href="/settings">
              <Button onClick={() => setOpen(false)}>Go to Settings</Button>
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  type="search"
                  placeholder="Search for games..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-game-search"
                  aria-label="Search games"
                />
              </div>
              <Button
                type="submit"
                disabled={isSearching}
                data-testid="button-search-games"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </Button>
            </form>

            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">Show undated games first</p>
                <p className="text-xs text-muted-foreground">
                  Include titles without a release date and place them before dated results.
                </p>
              </div>
              <Switch checked={showUndatedGames} onCheckedChange={setShowUndatedGames} />
            </div>

            <div className="space-y-4" aria-live="polite">
              {isSearching && (
                <div className="text-center py-8 text-muted-foreground">Searching games...</div>
              )}

              {!isSearching && debouncedQuery && resultsWithCollectionStatus.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No games found. Try a different search term.
                </div>
              )}

              {resultsWithCollectionStatus.map((game) => (
                <Card
                  key={game.id}
                  className="hover-elevate"
                  data-testid={`search-result-${game.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      <img
                        src={game.coverUrl || "/placeholder-game-cover.jpg"}
                        alt={`${game.title} cover`}
                        className="w-16 h-24 object-cover rounded-md flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3
                            className="font-semibold truncate"
                            data-testid={`text-game-title-${game.id}`}
                          >
                            {game.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {game.releaseDate && (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Calendar className="w-3 h-3" />
                                {game.releaseDate.endsWith("-12-31")
                                  ? new Date(game.releaseDate).getFullYear()
                                  : new Date(game.releaseDate).toLocaleDateString(undefined, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    })}
                              </div>
                            )}
                            {game.rating && (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Star className="w-3 h-3 text-accent" />
                                {game.rating}/10
                              </div>
                            )}
                          </div>
                        </div>

                        {game.summary && (
                          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                            {game.summary}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-1 mb-3">
                          {game.genres?.slice(0, 3).map((genre) => (
                            <Badge key={genre} variant="secondary" className="text-xs">
                              {genre}
                            </Badge>
                          ))}
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {game.platforms?.slice(0, 3).map((platform) => (
                              <Badge key={platform} variant="outline" className="text-xs">
                                {platform}
                              </Badge>
                            ))}
                          </div>

                          {game.inCollection ? (
                            <Badge variant="default" className="text-xs">
                              In Collection
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleAddGame(game)}
                              disabled={addGameMutation.isPending}
                              data-testid={`button-add-${game.id}`}
                              aria-label={`Add ${game.title} to collection`}
                            >
                              {isAddingGame(game.igdbId) ? (
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              ) : (
                                <Plus className="w-4 h-4 mr-1" />
                              )}
                              {isAddingGame(game.igdbId) ? "Adding..." : "Add"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
