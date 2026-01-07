import { useState, useCallback, useEffect, useMemo } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2 } from "lucide-react";
import GameCarouselSection from "@/components/GameCarouselSection";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { mapGameToInsertGame } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import DiscoverSettingsModal from "@/components/DiscoverSettingsModal";

interface Genre {
  id: number;
  name: string;
}

interface Platform {
  id: number;
  name: string;
}

// Default genres used as fallback when API fails or returns empty
// These are common game genres that provide a good starting point
const DEFAULT_GENRES: Genre[] = [
  { id: 1, name: "Action" },
  { id: 2, name: "Adventure" },
  { id: 3, name: "RPG" },
  { id: 4, name: "Strategy" },
  { id: 5, name: "Shooter" },
  { id: 6, name: "Puzzle" },
  { id: 7, name: "Racing" },
  { id: 8, name: "Sports" },
  { id: 9, name: "Simulation" },
  { id: 10, name: "Fighting" },
];

// Default platforms used as fallback when API fails or returns empty
// These represent the major gaming platforms
const DEFAULT_PLATFORMS: Platform[] = [
  { id: 1, name: "PC" },
  { id: 2, name: "PlayStation" },
  { id: 3, name: "Xbox" },
  { id: 4, name: "Nintendo" },
];

// Cache duration for relatively static data (1 hour)
const STATIC_DATA_STALE_TIME = 1000 * 60 * 60;

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
  const [selectedGenre, setSelectedGenre] = useState<string>("Adventure");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("PC");
  const [showSettings, setShowSettings] = useState(false);
  const [hideOwned, setHideOwned] = useState<boolean>(() => {
    return localStorage.getItem("discoverHideOwned") === "true";
  });
  const [hideWanted, setHideWanted] = useState<boolean>(() => {
    return localStorage.getItem("discoverHideWanted") === "true";
  });

  // ⚡ Bolt: Using the useDebounce hook to limit the frequency of API calls
  const debouncedGenre = useDebounce(selectedGenre, 300);
  const debouncedPlatform = useDebounce(selectedPlatform, 300);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    localStorage.setItem("discoverHideOwned", hideOwned.toString());
  }, [hideOwned]);

  useEffect(() => {
    localStorage.setItem("discoverHideWanted", hideWanted.toString());
  }, [hideWanted]);

  // Fetch local games to filter hidden ones
  const { data: localGames = [] } = useQuery<Game[]>({
    queryKey: ["/api/games?includeHidden=true"], // We need all games to know which are hidden
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/games?includeHidden=true");
      return response.json();
    },
  });

  const hiddenIgdbIds = useMemo(() => {
    return new Set(localGames.filter((g) => g.hidden).map((g) => g.igdbId));
  }, [localGames]);

  const ownedIgdbIds = useMemo(() => {
    return new Set(
      localGames
        .filter(
          (g) => g.status === "owned" || g.status === "completed" || g.status === "downloading"
        )
        .map((g) => g.igdbId)
    );
  }, [localGames]);

  const wantedIgdbIds = useMemo(() => {
    return new Set(
      localGames.filter((g) => g.status === "wanted" && !g.hidden).map((g) => g.igdbId)
    );
  }, [localGames]);

  const igdbToLocalIdMap = useMemo(() => {
    const map = new Map<number, string>();
    localGames.forEach((g) => {
      if (g.igdbId) map.set(g.igdbId, g.id);
    });
    return map;
  }, [localGames]);

  const filterGames = useCallback(
    (games: Game[]) => {
      return games.filter((g: Game) => {
        if (hiddenIgdbIds.has(g.igdbId)) return false;

        if (hideOwned && ownedIgdbIds.has(g.igdbId)) return false;

        if (hideWanted && wantedIgdbIds.has(g.igdbId)) return false;

        return true;
      });
    },

    [hiddenIgdbIds, ownedIgdbIds, wantedIgdbIds, hideOwned, hideWanted]
  );

  // Fetch available genres with caching and error handling

  const {
    data: genres = [],

    isError: genresError,

    isFetching: isFetchingGenres,
  } = useQuery<Genre[]>({
    queryKey: ["/api/igdb/genres"],

    queryFn: async () => {
      const response = await apiRequest("GET", "/api/igdb/genres");

      return response.json();
    },

    staleTime: STATIC_DATA_STALE_TIME,

    retry: 2,
  });

  // Fetch available platforms with caching and error handling

  const {
    data: platforms = [],

    isError: platformsError,

    isFetching: isFetchingPlatforms,
  } = useQuery<Platform[]>({
    queryKey: ["/api/igdb/platforms"],

    queryFn: async () => {
      const response = await apiRequest("GET", "/api/igdb/platforms");

      return response.json();
    },

    staleTime: STATIC_DATA_STALE_TIME,

    retry: 2,
  });

  // Handle errors with toast notifications

  useEffect(() => {
    if (genresError) {
      toast({
        description: "Failed to load genres, using defaults",

        variant: "destructive",
      });
    }
  }, [genresError, toast]);

  useEffect(() => {
    if (platformsError) {
      toast({
        description: "Failed to load platforms, using defaults",

        variant: "destructive",
      });
    }
  }, [platformsError, toast]);

  // Track game mutation (for Discovery games)

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

  const hideGameMutation = useMutation({
    mutationFn: async (game: Game) => {
      // Check if game exists locally first (use our map for consistency)

      const localId = game.igdbId ? igdbToLocalIdMap.get(game.igdbId) : undefined;

      if (localId) {
        // Update existing game

        const response = await apiRequest("PATCH", `/api/games/${localId}/hidden`, {
          hidden: true,
        });

        return response.json();
      } else {
        // Add new hidden game

        const gameData = mapGameToInsertGame(game);

        const response = await apiRequest("POST", "/api/games", {
          ...gameData,

          status: "wanted", // Default status, but hidden

          hidden: true,
        });

        return response.json();
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });

      toast({ description: "Game hidden from discovery" });
    },

    onError: () => {
      toast({
        description: "Failed to hide game",

        variant: "destructive",
      });
    },
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

      localId?: string;
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
        // Search in all cached query data

        const allQueries = queryClient.getQueriesData<Game[]>({
          predicate: (query) => {
            const key = query.queryKey[0] as string;

            return key.startsWith("/api/igdb/");
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
        const localId = game.igdbId ? igdbToLocalIdMap.get(game.igdbId) : undefined;

        addGameMutation.mutate({ game, status: newStatus, localId });
      }
    },

    [queryClient, addGameMutation, igdbToLocalIdMap]
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
          // Search in all cached query data

          const allQueries = queryClient.getQueriesData<Game[]>({
            predicate: (query) => {
              const key = query.queryKey[0] as string;

              return key.startsWith("/api/igdb/");
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
    const response = await apiRequest("GET", "/api/igdb/popular?limit=20");
    const games = await response.json();
    return filterGames(games);
  }, [filterGames]);

  const fetchRecentGames = useCallback(async (): Promise<Game[]> => {
    const response = await apiRequest("GET", "/api/igdb/recent?limit=20");
    const games = await response.json();
    return filterGames(games);
  }, [filterGames]);

  const fetchUpcomingGames = useCallback(async (): Promise<Game[]> => {
    const response = await apiRequest("GET", "/api/igdb/upcoming?limit=20");
    const games = await response.json();
    return filterGames(games);
  }, [filterGames]);

  const fetchGamesByGenre = useCallback(async (): Promise<Game[]> => {
    // Validate selectedGenre against known genres before making API call
    const validGenres: Genre[] = genres.length > 0 ? genres : DEFAULT_GENRES;
    const isValidGenre = validGenres.some((g: Genre) => g.name === debouncedGenre);
    if (!isValidGenre) {
      // This case should ideally not be hit if UI is synced with state
      return []; // Return empty instead of throwing to prevent crash
    }

    const response = await apiRequest(
      "GET",
      `/api/igdb/genre/${encodeURIComponent(debouncedGenre)}?limit=20`
    );
    const games = await response.json();
    return filterGames(games);
  }, [debouncedGenre, genres, filterGames]);

  const fetchGamesByPlatform = useCallback(async (): Promise<Game[]> => {
    // Validate selectedPlatform against known platforms before making API call
    const validPlatforms: Platform[] = platforms.length > 0 ? platforms : DEFAULT_PLATFORMS;
    const isValidPlatform = validPlatforms.some((p: Platform) => p.name === debouncedPlatform);
    if (!isValidPlatform) {
      // This case should ideally not be hit if UI is synced with state
      return []; // Return empty instead of throwing to prevent crash
    }

    const response = await apiRequest(
      "GET",
      `/api/igdb/platform/${encodeURIComponent(debouncedPlatform)}?limit=20`
    );
    const games = await response.json();
    return filterGames(games);
  }, [debouncedPlatform, platforms, filterGames]);

  const displayGenres: Genre[] = genres.length > 0 ? genres : DEFAULT_GENRES;
  const displayPlatforms: Platform[] = platforms.length > 0 ? platforms : DEFAULT_PLATFORMS;

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-auto" data-testid="discover-page">
      <div className="p-6 space-y-8 max-w-full">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold mb-2">Discover Games</h1>
            <p className="text-muted-foreground">
              Explore popular games, new releases, and find your next adventure
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowSettings(true)}
            aria-label="Discovery settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>

        <DiscoverSettingsModal
          open={showSettings}
          onOpenChange={setShowSettings}
          hiddenGames={localGames.filter((g) => g.hidden)}
          hideOwned={hideOwned}
          onHideOwnedChange={setHideOwned}
          hideWanted={hideWanted}
          onHideWantedChange={setHideWanted}
        />

        {/* Popular Games Section */}
        <GameCarouselSection
          title="Popular Games"
          queryKey={["/api/igdb/popular", hiddenIgdbIds.size, hideOwned, hideWanted]}
          queryFn={fetchPopularGames}
          onStatusChange={handleStatusChange}
          onTrackGame={handleTrackGame}
          onToggleHidden={handleToggleHidden}
          isDiscovery={true}
        />

        {/* Recent Releases Section */}
        <GameCarouselSection
          title="Recent Releases"
          queryKey={["/api/igdb/recent", hiddenIgdbIds.size, hideOwned, hideWanted]}
          queryFn={fetchRecentGames}
          onStatusChange={handleStatusChange}
          onTrackGame={handleTrackGame}
          onToggleHidden={handleToggleHidden}
          isDiscovery={true}
        />

        {/* Upcoming Releases Section */}
        <GameCarouselSection
          title="Coming Soon"
          queryKey={["/api/igdb/upcoming", hiddenIgdbIds.size, hideOwned, hideWanted]}
          queryFn={fetchUpcomingGames}
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
                loading={isFetchingGenres}
              >
                <SelectValue placeholder="Select genre" />
              </SelectTriggerWithSpinner>
              <SelectContent>
                {displayGenres.map((genre: Genre) => (
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
              "/api/igdb/genre",
              debouncedGenre,
              hiddenIgdbIds.size,
              hideOwned,
              hideWanted,
            ]}
            queryFn={fetchGamesByGenre}
            onStatusChange={handleStatusChange}
            onTrackGame={handleTrackGame}
            onToggleHidden={handleToggleHidden}
            isDiscovery={true}
          />
        </div>

        {/* By Platform Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">By Platform</h2>
            <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
              <SelectTriggerWithSpinner
                className="w-[180px]"
                data-testid="select-platform"
                loading={isFetchingPlatforms}
              >
                <SelectValue placeholder="Select platform" />
              </SelectTriggerWithSpinner>
              <SelectContent>
                {displayPlatforms.map((platform: Platform) => (
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
              "/api/igdb/platform",
              debouncedPlatform,
              hiddenIgdbIds.size,
              hideOwned,
              hideWanted,
            ]}
            queryFn={fetchGamesByPlatform}
            onStatusChange={handleStatusChange}
            onTrackGame={handleTrackGame}
            onToggleHidden={handleToggleHidden}
            isDiscovery={true}
          />
        </div>
      </div>
    </div>
  );
}
