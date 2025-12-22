import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SearchBar from "./SearchBar";
import GameGrid from "./GameGrid";
import StatsCard from "./StatsCard";
import { Library, Star, Gamepad2, Tags } from "lucide-react";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query user's collection
  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ['/api/games', debouncedSearchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchQuery.trim()) {
        params.set('search', debouncedSearchQuery.trim());
      }
      const response = await fetch(`/api/games?${params}`);
      if (!response.ok) throw new Error('Failed to fetch games');
      return response.json();
    }
  });

  // Status update mutation (for existing games in collection)
  const statusMutation = useMutation({
    mutationFn: async ({ gameId, status }: { gameId: string; status: GameStatus }) => {
      const response = await fetch(`/api/games/${gameId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error('Failed to update status');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games'] });
      toast({ description: "Game status updated successfully" });
    },
    onError: () => {
      toast({ description: "Failed to update game status", variant: "destructive" });
    }
  });

  // Calculate unique genres and platforms from user's game collection
  const uniqueGenres = new Set(games.flatMap((g) => g.genres ?? []));
  const uniquePlatforms = new Set(games.flatMap((g) => g.platforms ?? []));

  const stats = [
    {
      title: "Total Games",
      value: games.length,
      subtitle: "in your library",
      icon: Library,
    },
    {
      title: "Genres",
      value: uniqueGenres.size,
      subtitle: "unique genres",
      icon: Tags,
    },
    {
      title: "Platforms",
      value: uniquePlatforms.size,
      subtitle: "unique platforms",
      icon: Gamepad2,
    },
    {
      title: "Wishlist",
      value: games.filter((g) => g.status === "wanted").length,
      subtitle: "wanted games",
      icon: Star,
    },
  ];

  // ⚡ Bolt: Memoize event handlers with `useCallback` to prevent unnecessary
  // re-renders in child components like `SearchBar` that depend on stable
  // function references.
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleFilterToggle = useCallback(() => {
    console.warn("Filter panel toggled");
  }, []);

  const handleRemoveFilter = useCallback((filter: string) => {
    setActiveFilters(prev => prev.filter(f => f !== filter));
  }, []);

  // ⚡ Bolt: Memoize `handleStatusChange` with `useCallback`.
  // This function is passed down through `GameGrid` to `GameCard` components.
  // Since `GameCard` is wrapped in `React.memo`, passing a stable function
  // reference is crucial to prevent every card from re-rendering whenever
  // the `Dashboard` component re-renders. Without `useCallback`, a new
  // function would be created on each render, defeating the purpose of memoization.
  const handleStatusChange = useCallback((gameId: string, newStatus: GameStatus) => {
    statusMutation.mutate({ gameId, status: newStatus });
  }, [statusMutation]);

  return (
    <div className="h-full overflow-auto p-6" data-testid="layout-dashboard">
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            activeFilters={activeFilters}
            onRemoveFilter={handleRemoveFilter}
            placeholder="Search your library..."
          />
          <GameGrid
            games={games}
            onStatusChange={handleStatusChange}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}