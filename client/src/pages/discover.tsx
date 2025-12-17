import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import GameCarouselSection from "@/components/GameCarouselSection";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { mapGameToInsertGame } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function DiscoverPage() {
  const [selectedGenre, setSelectedGenre] = useState<string>("Action");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("PC");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch available genres with caching and error handling
  const { data: genres = [], isError: genresError } = useQuery<Genre[]>({
    queryKey: ["/api/igdb/genres"],
    queryFn: async () => {
      const response = await fetch("/api/igdb/genres");
      if (!response.ok) throw new Error("Failed to fetch genres");
      return response.json();
    },
    staleTime: STATIC_DATA_STALE_TIME,
    retry: 2,
  });

  // Fetch available platforms with caching and error handling
  const { data: platforms = [], isError: platformsError } = useQuery<Platform[]>({
    queryKey: ["/api/igdb/platforms"],
    queryFn: async () => {
      const response = await fetch("/api/igdb/platforms");
      if (!response.ok) throw new Error("Failed to fetch platforms");
      return response.json();
    },
    staleTime: STATIC_DATA_STALE_TIME,
    retry: 2,
  });

  // Track if error toasts have been shown to prevent duplicate notifications
  const genresErrorShown = useRef(false);
  const platformsErrorShown = useRef(false);

  // Show toast notification for API errors (only once per error state)
  useEffect(() => {
    if (genresError && !genresErrorShown.current) {
      genresErrorShown.current = true;
      toast({
        description: "Failed to load genres, using defaults",
        variant: "destructive",
      });
    } else if (!genresError) {
      genresErrorShown.current = false;
    }
  }, [genresError, toast]);

  useEffect(() => {
    if (platformsError && !platformsErrorShown.current) {
      platformsErrorShown.current = true;
      toast({
        description: "Failed to load platforms, using defaults",
        variant: "destructive",
      });
    } else if (!platformsError) {
      platformsErrorShown.current = false;
    }
  }, [platformsError, toast]);

  // Track game mutation (for Discovery games)
  const trackGameMutation = useMutation({
    mutationFn: async (game: Game) => {
      const gameData = mapGameToInsertGame(game);
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...gameData,
          status: "wanted",
        }),
      });
      if (!response.ok) throw new Error("Failed to track game");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: "Game added to watchlist!" });
    },
    onError: () => {
      toast({
        description: "Failed to track game",
        variant: "destructive",
      });
    },
  });

  // Add game mutation (for status changes on Discovery games)
  const addGameMutation = useMutation({
    mutationFn: async ({ game, status }: { game: Game; status: GameStatus }) => {
      const gameData = mapGameToInsertGame(game);
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...gameData,
          status,
        }),
      });
      if (!response.ok) throw new Error("Failed to add game");
      return response.json();
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
  const handleStatusChange = useCallback((gameId: string, newStatus: GameStatus) => {
    // For Discovery games (IGDB games not in collection yet)
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
      addGameMutation.mutate({ game, status: newStatus });
    }
  }, [queryClient, addGameMutation]);

  const handleTrackGame = useCallback((game: Game) => {
    trackGameMutation.mutate(game);
  }, [trackGameMutation]);

  // ⚡ Bolt: Memoizing fetch functions with `useCallback` ensures they have stable
  // references across re-renders. This is critical for preventing child components
  // like `GameCarouselSection` from re-rendering unnecessarily when they are
  // wrapped in `React.memo` and receive these functions as props.
  const fetchPopularGames = useCallback(async (): Promise<Game[]> => {
    const response = await fetch("/api/igdb/popular?limit=20");
    if (!response.ok) throw new Error("Failed to fetch popular games");
    return response.json();
  }, []);

  const fetchRecentGames = useCallback(async (): Promise<Game[]> => {
    const response = await fetch("/api/igdb/recent?limit=20");
    if (!response.ok) throw new Error("Failed to fetch recent games");
    return response.json();
  }, []);

  const fetchUpcomingGames = useCallback(async (): Promise<Game[]> => {
    const response = await fetch("/api/igdb/upcoming?limit=20");
    if (!response.ok) throw new Error("Failed to fetch upcoming games");
    return response.json();
  }, []);

  const fetchGamesByGenre = useCallback(async (): Promise<Game[]> => {
    // Validate selectedGenre against known genres before making API call
    const validGenres = genres.length > 0 ? genres : DEFAULT_GENRES;
    const isValidGenre = validGenres.some((g) => g.name === selectedGenre);
    if (!isValidGenre) {
      // This case should ideally not be hit if UI is synced with state
      return []; // Return empty instead of throwing to prevent crash
    }
    
    const response = await fetch(
      `/api/igdb/genre/${encodeURIComponent(selectedGenre)}?limit=20`
    );
    if (!response.ok) throw new Error("Failed to fetch games by genre");
    return response.json();
  }, [selectedGenre, genres]);

  const fetchGamesByPlatform = useCallback(async (): Promise<Game[]> => {
    // Validate selectedPlatform against known platforms before making API call
    const validPlatforms = platforms.length > 0 ? platforms : DEFAULT_PLATFORMS;
    const isValidPlatform = validPlatforms.some((p) => p.name === selectedPlatform);
    if (!isValidPlatform) {
      // This case should ideally not be hit if UI is synced with state
      return []; // Return empty instead of throwing to prevent crash
    }
    
    const response = await fetch(
      `/api/igdb/platform/${encodeURIComponent(selectedPlatform)}?limit=20`
    );
    if (!response.ok) throw new Error("Failed to fetch games by platform");
    return response.json();
  }, [selectedPlatform, platforms]);

  const displayGenres = genres.length > 0 ? genres : DEFAULT_GENRES;
  const displayPlatforms = platforms.length > 0 ? platforms : DEFAULT_PLATFORMS;

  return (
    <div className="h-full overflow-auto p-6 space-y-8" data-testid="discover-page">
      <div>
        <h1 className="text-2xl font-bold mb-2">Discover Games</h1>
        <p className="text-muted-foreground">
          Explore popular games, new releases, and find your next adventure
        </p>
      </div>

      {/* Popular Games Section */}
      <GameCarouselSection
        title="Popular Games"
        queryKey={["/api/igdb/popular"]}
        queryFn={fetchPopularGames}
        onStatusChange={handleStatusChange}
        onTrackGame={handleTrackGame}
        isDiscovery={true}
      />

      {/* Recent Releases Section */}
      <GameCarouselSection
        title="Recent Releases"
        queryKey={["/api/igdb/recent"]}
        queryFn={fetchRecentGames}
        onStatusChange={handleStatusChange}
        onTrackGame={handleTrackGame}
        isDiscovery={true}
      />

      {/* Upcoming Releases Section */}
      <GameCarouselSection
        title="Coming Soon"
        queryKey={["/api/igdb/upcoming"]}
        queryFn={fetchUpcomingGames}
        onStatusChange={handleStatusChange}
        onTrackGame={handleTrackGame}
        isDiscovery={true}
      />

      {/* By Genre Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold">By Genre</h2>
          <Select value={selectedGenre} onValueChange={setSelectedGenre}>
            <SelectTrigger className="w-[180px]" data-testid="select-genre">
              <SelectValue placeholder="Select genre" />
            </SelectTrigger>
            <SelectContent>
              {displayGenres.map((genre) => (
                <SelectItem key={genre.id} value={genre.name}>
                  {genre.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <GameCarouselSection
          title={`${selectedGenre} Games`}
          queryKey={["/api/igdb/genre", selectedGenre]}
          queryFn={fetchGamesByGenre}
          onStatusChange={handleStatusChange}
          onTrackGame={handleTrackGame}
          isDiscovery={true}
        />
      </div>

      {/* By Platform Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold">By Platform</h2>
          <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
            <SelectTrigger className="w-[180px]" data-testid="select-platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              {displayPlatforms.map((platform) => (
                <SelectItem key={platform.id} value={platform.name}>
                  {platform.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <GameCarouselSection
          title={`${selectedPlatform} Games`}
          queryKey={["/api/igdb/platform", selectedPlatform]}
          queryFn={fetchGamesByPlatform}
          onStatusChange={handleStatusChange}
          onTrackGame={handleTrackGame}
          isDiscovery={true}
        />
      </div>
    </div>
  );
}
