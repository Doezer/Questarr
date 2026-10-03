import { useState, useCallback, useEffect, useMemo } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2, AlertCircle } from "lucide-react";
import GameCarouselSection from "@/components/GameCarouselSection";
import { visiblePlatforms } from "@shared/platforms";
import { useHiddenMutation } from "@/hooks/use-hidden-mutation";
import { useToast } from "@/hooks/use-toast";
import { mapGameToInsertGame } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { hideDiscoveryGame } from "@/lib/discover-hidden-mutation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import DiscoverSettingsModal from "@/components/DiscoverSettingsModal";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RssFeedList from "@/components/RssFeedList";
import RssSettings from "@/components/RssSettings";
import { Rss } from "lucide-react";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { type Game, type Config, type UserSettings } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";

const EMPTY_GAMES: Game[] = [];

// RAWG taxonomy entries carry a slug (the value used in /api/rawg/genre/:slug etc.)
interface RawgTaxonomy {
  id: number;
  name: string;
  slug: string;
}

// Default genres used as fallback when the API fails or returns empty.
// These are common game genres that provide a good starting point.
const DEFAULT_GENRES: RawgTaxonomy[] = [
  { id: 1, name: "Action", slug: "action" },
  { id: 2, name: "Adventure", slug: "adventure" },
  { id: 3, name: "RPG", slug: "role-playing-games-rpg" },
  { id: 4, name: "Strategy", slug: "strategy" },
  { id: 5, name: "Shooter", slug: "shooter" },
  { id: 6, name: "Puzzle", slug: "puzzle" },
  { id: 7, name: "Racing", slug: "racing" },
  { id: 8, name: "Sports", slug: "sports" },
  { id: 9, name: "Simulation", slug: "simulation" },
  { id: 10, name: "Fighting", slug: "fighting" },
];

// Default platform used as fallback when the API fails or returns empty.
const DEFAULT_PLATFORM: RawgTaxonomy = { id: 1, name: "PC", slug: "pc" };

function rawgSlugFromName(name: string): string {
  if (name.toLowerCase() === "rpg") return "role-playing-games-rpg";
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Cache duration for relatively static data (1 hour)
const STATIC_DATA_STALE_TIME = 1000 * 60 * 60;

// Client-side stale time for discovery carousel sections.
// Aligned to the server-side Cache-Control max-age (3600s = 1 hour) so refetches
// don't happen before the server cache can serve fresh data.
const DISCOVERY_STALE_TIME = STATIC_DATA_STALE_TIME;

// 🎨 Palette: Custom SelectTrigger that shows a loading spinner.
const SelectTriggerWithSpinner = ({
  loading,
  children,
  ...props
}: React.ComponentProps<typeof SelectTrigger> & { loading: boolean }) => {
  return (
    <SelectTrigger {...props}>
      {children}
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
    </SelectTrigger>
  );
};

export default function DiscoverPage() {
  const [selectedGenre, setSelectedGenre] = useState<string>("Action");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("PC");
  const [activeTab, setActiveTab] = useState("rawg");
  const [showSettings, setShowSettings] = useState(false);
  const [hideOwned, setHideOwned] = useLocalStorageState("discoverHideOwned", false);
  const [hideWanted, setHideWanted] = useLocalStorageState("discoverHideWanted", false);

  // ⚡ Bolt: Using the useDebounce hook to limit the frequency of API calls
  const debouncedGenre = useDebounce(selectedGenre, 300);
  const debouncedPlatform = useDebounce(selectedPlatform, 300);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config } = useQuery<Config>({
    queryKey: ["/api/config"],
  });

  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
  });

  // Fetch local games to filter hidden/owned/wanted ones out of the carousels.
  const { data: localGames = EMPTY_GAMES } = useQuery<Game[]>({
    queryKey: ["/api/games?includeHidden=true"], // We need all games to know which are hidden
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/games?includeHidden=true");
      return response.json();
    },
    enabled: !!config?.rawg?.configured,
  });

  // ⚡ Bolt: Consolidate multiple O(N) array traversals into a single pass.
  const { hiddenRawgIds, ownedRawgIds, wantedRawgIds, rawgToLocalIdMap, hiddenGames } =
    useMemo(() => {
      const hiddenRawg = new Set<number>();
      const ownedRawg = new Set<number>();
      const wantedRawg = new Set<number>();
      const rawgIdMap = new Map<number, string>();
      const hiddenList: Game[] = [];

      for (const g of localGames) {
        if (g.hidden) hiddenList.push(g);

        if (g.rawgId) {
          rawgIdMap.set(g.rawgId, g.id);
          if (g.hidden) hiddenRawg.add(g.rawgId);
          if (g.status === "owned" || g.status === "completed" || g.status === "downloading") {
            ownedRawg.add(g.rawgId);
          }
          if (g.status === "wanted" && !g.hidden) wantedRawg.add(g.rawgId);
        }
      }

      return {
        hiddenRawgIds: hiddenRawg,
        ownedRawgIds: ownedRawg,
        wantedRawgIds: wantedRawg,
        rawgToLocalIdMap: rawgIdMap,
        hiddenGames: hiddenList,
      };
    }, [localGames]);

  const resolveLocalId = useCallback(
    (game: Game): string | undefined => {
      if (game.rawgId) return rawgToLocalIdMap.get(game.rawgId);
      return undefined;
    },
    [rawgToLocalIdMap]
  );

  const filterGames = useCallback(
    (games: Game[]) => {
      return games.filter((g: Game) => {
        if (g.rawgId) {
          if (hiddenRawgIds.has(g.rawgId)) return false;
          if (hideOwned && ownedRawgIds.has(g.rawgId)) return false;
          if (hideWanted && wantedRawgIds.has(g.rawgId)) return false;
        }
        return true;
      });
    },

    [hiddenRawgIds, ownedRawgIds, wantedRawgIds, hideOwned, hideWanted]
  );

  // Fetch available genres with caching and error handling.
  // The slugs are what the /api/rawg/genre/:slug route expects, so they travel
  // with the names into the select state.
  const {
    data: rawgGenresData,
    isError: rawgGenresError,
    isFetching: isFetchingRawgGenres,
  } = useQuery<RawgTaxonomy[]>({
    queryKey: ["/api/rawg/genres"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/rawg/genres");
      return response.json();
    },
    staleTime: STATIC_DATA_STALE_TIME,
    retry: 2,
    enabled: !!config?.rawg?.configured,
  });

  const {
    data: rawgPlatformsData,
    isError: rawgPlatformsError,
    isFetching: isFetchingRawgPlatforms,
  } = useQuery<RawgTaxonomy[]>({
    queryKey: ["/api/rawg/platforms"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/rawg/platforms");
      return response.json();
    },
    staleTime: STATIC_DATA_STALE_TIME,
    retry: 2,
    enabled: !!config?.rawg?.configured,
  });

  // These lists drive `.find()` below; a malformed payload (or a test mock
  // that answers every URL) must not take the page down.
  const rawgGenres = useMemo<RawgTaxonomy[]>(
    () => (Array.isArray(rawgGenresData) ? rawgGenresData : []),
    [rawgGenresData]
  );
  const rawgPlatforms = useMemo<RawgTaxonomy[]>(
    () => (Array.isArray(rawgPlatformsData) ? rawgPlatformsData : []),
    [rawgPlatformsData]
  );

  // Handle errors with toast notifications
  useEffect(() => {
    if (rawgGenresError) {
      toast({
        description: "Failed to load RAWG genres",
        variant: "destructive",
      });
    }
  }, [rawgGenresError, toast]);

  useEffect(() => {
    if (rawgPlatformsError) {
      toast({
        description: "Failed to load RAWG platforms",
        variant: "destructive",
      });
    }
  }, [rawgPlatformsError, toast]);

  // The Platforms setting narrows this dropdown the same way it governs the
  // Library and download-dialog selectors. Kept above the not-configured
  // early return so hook order stays stable.
  const allPlatforms = useMemo<RawgTaxonomy[]>(
    () => (rawgPlatforms.length > 0 ? rawgPlatforms : [DEFAULT_PLATFORM]),
    [rawgPlatforms]
  );
  const displayPlatforms = useMemo<RawgTaxonomy[]>(() => {
    const selectedIds = userSettings?.importPlatformIds;
    const visible = visiblePlatforms(allPlatforms, selectedIds);
    // An empty selection means "no restriction" (fall back to every platform).
    // A non-empty selection with zero overlap is a genuine result, not a
    // loading artifact -- returning it (rather than falling back) keeps this
    // in sync with the Library filter's identical distinction.
    return Array.isArray(selectedIds) && selectedIds.length > 0 ? visible : allPlatforms;
  }, [allPlatforms, userSettings?.importPlatformIds]);

  // `selectedPlatform` defaults to "PC", which the Platforms setting may not
  // include. Snap it to a listed platform so the dropdown and the carousel
  // below it never disagree about which platform is being browsed.
  useEffect(() => {
    if (config && !config.rawg?.configured) return;
    if (displayPlatforms.length === 0) return;
    if (displayPlatforms.some((p) => p.name === selectedPlatform)) return;
    setSelectedPlatform(displayPlatforms[0]!.name);
  }, [config, displayPlatforms, selectedPlatform]);

  const trackGameMutation = useMutation({
    mutationFn: async (game: Game) => {
      const gameData = mapGameToInsertGame(game);

      const response = await apiRequest("POST", "/api/games", {
        ...gameData,
        status: "wanted",
      });

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });

      toast({ description: "Game added to watchlist!" });
    },

    onError: (error: Error) => {
      const errorMessage = error.message || String(error);

      if (errorMessage.includes("409") || errorMessage.includes("already in collection")) {
        toast({
          description: "Game is already in your collection",
          variant: "default",
        });
      } else {
        toast({
          description: "Failed to track game",
          variant: "destructive",
        });
      }
    },
  });

  // Hide game mutation

  const hideGameMutation = useHiddenMutation<Game>({
    mutationFn: async (game: Game) => {
      const localId = resolveLocalId(game);
      return hideDiscoveryGame(game, localId);
    },
    hiddenSuccessMessage: "Game hidden from discovery",
    unhiddenSuccessMessage: "Game unhidden",
    errorMessage: "Failed to hide game",
  });

  // Add game mutation (for status changes on Discovery games)

  const addGameMutation = useMutation({
    mutationFn: async ({
      game,
      status,
      localId,
    }: {
      game: Game;
      status: GameStatus;
      localId?: string | undefined;
    }) => {
      if (localId) {
        // Update existing game status

        const response = await apiRequest("PATCH", `/api/games/${localId}/status`, {
          status,
        });

        return response.json();
      } else {
        // Add new game with status

        const gameData = mapGameToInsertGame(game);

        const response = await apiRequest("POST", "/api/games", {
          ...gameData,
          status,
        });

        return response.json();
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });

      toast({ description: "Game added to collection successfully" });
    },

    onError: () => {
      toast({
        description: "Failed to add game to collection",
        variant: "destructive",
      });
    },
  });

  // ⚡ Bolt: Using useCallback to memoize event handlers, preventing unnecessary

  // re-renders in child components like `GameCard` that rely on stable function

  // references for their `React.memo` optimization.

  const handleStatusChange = useCallback(
    (gameId: string, newStatus: GameStatus) => {
      // Find game object in queries

      const findGameInQueries = (): Game | undefined => {
        const allQueries = queryClient.getQueriesData<Game[]>({
          predicate: (query) => {
            const key = query.queryKey[0] as string;
            return key.startsWith("/api/rawg/");
          },
        });

        for (const [, data] of allQueries) {
          const game = data?.find((g) => g.id === gameId);

          if (game) return game;
        }

        return undefined;
      };

      const game = findGameInQueries();

      if (game) {
        const localId = resolveLocalId(game);

        addGameMutation.mutate({ game, status: newStatus, localId });
      }
    },

    [queryClient, addGameMutation, resolveLocalId]
  );

  const handleTrackGame = useCallback(
    (game: Game) => {
      trackGameMutation.mutate(game);
    },

    [trackGameMutation]
  );

  const handleToggleHidden = useCallback(
    (gameId: string, hidden: boolean) => {
      // We only support hiding from discovery page for now via the card button

      // Unhiding is done via settings

      if (hidden) {
        const findGameInQueries = (): Game | undefined => {
          const allQueries = queryClient.getQueriesData<Game[]>({
            predicate: (query) => {
              const key = query.queryKey[0] as string;
              return key.startsWith("/api/rawg/");
            },
          });

          for (const [, data] of allQueries) {
            const game = data?.find((g) => g.id === gameId);

            if (game) return game;
          }

          return undefined;
        };

        const game = findGameInQueries();

        if (game) {
          hideGameMutation.mutate(game);
        }
      }
    },

    [queryClient, hideGameMutation]
  );

  // ⚡ Bolt: Memoizing fetch functions with `useCallback` ensures they have stable
  // references across re-renders. This is critical for preventing child components
  // like `GameCarouselSection` from re-rendering unnecessarily when they are
  // wrapped in `React.memo` and receive these functions as props.
  const fetchPopularGames = useCallback(async (): Promise<Game[]> => {
    const response = await apiRequest("GET", "/api/rawg/popular?limit=20");
    const games = await response.json();
    return filterGames(games);
  }, [filterGames]);

  const fetchRecentGames = useCallback(async (): Promise<Game[]> => {
    const response = await apiRequest("GET", "/api/rawg/recent?limit=20");
    const games = await response.json();
    return filterGames(games);
  }, [filterGames]);

  const fetchUpcomingGames = useCallback(async (): Promise<Game[]> => {
    const response = await apiRequest("GET", "/api/rawg/upcoming?limit=20");
    const games = await response.json();
    return filterGames(games);
  }, [filterGames]);

  const selectedGenreSlug =
    rawgGenres.find((g: RawgTaxonomy) => g.name === debouncedGenre)?.slug ??
    rawgSlugFromName(debouncedGenre);
  const selectedPlatformSlug =
    rawgPlatforms.find((p: RawgTaxonomy) => p.name === debouncedPlatform)?.slug ??
    rawgSlugFromName(debouncedPlatform);

  const fetchGamesByGenre = useCallback(async (): Promise<Game[]> => {
    const response = await apiRequest(
      "GET",
      `/api/rawg/genre/${encodeURIComponent(selectedGenreSlug)}?limit=20`
    );
    const games = await response.json();
    return filterGames(games);
  }, [selectedGenreSlug, filterGames]);

  const fetchGamesByPlatform = useCallback(async (): Promise<Game[]> => {
    // Validate the selection against the platforms the Platforms setting
    // leaves visible, so a stale selection cannot fetch an excluded platform.
    const validPlatforms: RawgTaxonomy[] = displayPlatforms;
    const isValidPlatform = validPlatforms.some((p: RawgTaxonomy) => p.name === debouncedPlatform);
    if (!isValidPlatform) {
      // This case should ideally not be hit if UI is synced with state
      return []; // Return empty instead of throwing to prevent crash
    }

    const response = await apiRequest(
      "GET",
      `/api/rawg/platform/${encodeURIComponent(selectedPlatformSlug)}?limit=20`
    );
    const games = await response.json();
    return filterGames(games);
  }, [selectedPlatformSlug, displayPlatforms, debouncedPlatform, filterGames]);

  const rawgConfigured = !!config?.rawg?.configured;

  if (config && !rawgConfigured) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="bg-muted p-4 rounded-full">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">Game Metadata Provider Required</h2>
        <p className="text-muted-foreground max-w-md">
          To discover and browse games, add a free RAWG API key (rawg.io) in settings.
        </p>
        <Link href="/settings">
          <Button>Go to Settings</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-auto" data-testid="discover-page">
      <div className="p-6 space-y-8 max-w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Discover</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Explore popular games, new releases, and find your next adventure
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <TabsList>
                <TabsTrigger value="rawg">Games</TabsTrigger>
                <TabsTrigger value="rss" className="gap-2">
                  <Rss className="h-4 w-4" /> RSS
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="rawg" className="space-y-8">
            {/* Attribution required by RAWG's terms of use for every page
                that displays its data or images. */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <p className="text-xs text-muted-foreground">
                Data and images from{" "}
                <a
                  href="https://rawg.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  RAWG (rawg.io)
                </a>
              </p>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setShowSettings(true)}
                aria-label="Discovery settings"
              >
                <Settings2 className="h-4 w-4" />
                Discovery Settings
              </Button>
            </div>

            <DiscoverSettingsModal
              open={showSettings}
              onOpenChange={setShowSettings}
              hiddenGames={hiddenGames}
              hideOwned={hideOwned}
              onHideOwnedChange={setHideOwned}
              hideWanted={hideWanted}
              onHideWantedChange={setHideWanted}
            />

            {/* Popular Games Section */}
            <GameCarouselSection
              title="Popular Games"
              queryKey={["/api/rawg/popular", hiddenRawgIds.size, hideOwned, hideWanted]}
              queryFn={fetchPopularGames}
              staleTime={DISCOVERY_STALE_TIME}
              onStatusChange={handleStatusChange}
              onTrackGame={handleTrackGame}
              onToggleHidden={handleToggleHidden}
              isDiscovery={true}
            />

            {/* Recent Releases Section */}
            <GameCarouselSection
              title="Recent Releases"
              queryKey={["/api/rawg/recent", hiddenRawgIds.size, hideOwned, hideWanted]}
              queryFn={fetchRecentGames}
              staleTime={DISCOVERY_STALE_TIME}
              onStatusChange={handleStatusChange}
              onTrackGame={handleTrackGame}
              onToggleHidden={handleToggleHidden}
              isDiscovery={true}
            />

            {/* Upcoming Releases Section */}
            <GameCarouselSection
              title="Coming Soon"
              queryKey={["/api/rawg/upcoming", hiddenRawgIds.size, hideOwned, hideWanted]}
              queryFn={fetchUpcomingGames}
              staleTime={DISCOVERY_STALE_TIME}
              onStatusChange={handleStatusChange}
              onTrackGame={handleTrackGame}
              onToggleHidden={handleToggleHidden}
              isDiscovery={true}
            />

            {/* By Genre Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold">By Genre</h2>
                <Select value={selectedGenre} onValueChange={setSelectedGenre}>
                  <SelectTriggerWithSpinner
                    className="w-[180px]"
                    data-testid="select-genre"
                    loading={isFetchingRawgGenres}
                  >
                    <SelectValue placeholder="Select genre" />
                  </SelectTriggerWithSpinner>
                  <SelectContent>
                    {(rawgGenres.length > 0 ? rawgGenres : DEFAULT_GENRES).map((genre) => (
                      <SelectItem key={genre.id} value={genre.name}>
                        {genre.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <GameCarouselSection
                title={`${selectedGenre} Games`}
                queryKey={[
                  "/api/rawg/genre",
                  debouncedGenre,
                  selectedGenreSlug,
                  hiddenRawgIds.size,
                  hideOwned,
                  hideWanted,
                ]}
                queryFn={fetchGamesByGenre}
                staleTime={DISCOVERY_STALE_TIME}
                onStatusChange={handleStatusChange}
                onTrackGame={handleTrackGame}
                onToggleHidden={handleToggleHidden}
                isDiscovery={true}
              />
            </div>

            {/* By Platform Section */}
            {displayPlatforms.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-semibold">By Platform</h2>
                  <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                    <SelectTriggerWithSpinner
                      className="w-[180px]"
                      data-testid="select-platform"
                      loading={isFetchingRawgPlatforms}
                    >
                      <SelectValue placeholder="Select platform" />
                    </SelectTriggerWithSpinner>
                    <SelectContent>
                      {displayPlatforms.map((platform: RawgTaxonomy) => (
                        <SelectItem key={platform.id} value={platform.name}>
                          {platform.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <GameCarouselSection
                  title={`${selectedPlatform} Games`}
                  queryKey={[
                    "/api/rawg/platform",
                    debouncedPlatform,
                    selectedPlatformSlug,
                    hiddenRawgIds.size,
                    hideOwned,
                    hideWanted,
                  ]}
                  queryFn={fetchGamesByPlatform}
                  staleTime={DISCOVERY_STALE_TIME}
                  onStatusChange={handleStatusChange}
                  onTrackGame={handleTrackGame}
                  onToggleHidden={handleToggleHidden}
                  isDiscovery={true}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="rss" className="space-y-6">
            <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg">
              <div>
                <h3 className="font-semibold">RSS Feed Discovery</h3>
                <p className="text-sm text-muted-foreground">
                  Track releases from your favorite sites.
                </p>
              </div>
              <RssSettings />
            </div>
            <RssFeedList />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
