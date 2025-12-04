import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import Header from "./Header";
import AddGameModal from "./AddGameModal";
import SearchBar from "./SearchBar";
import GameGrid from "./GameGrid";
import StatsCard from "./StatsCard";
import DiscoveryFilters from "./DiscoveryFilters";
import { Library, Star, Gamepad2, Tags } from "lucide-react";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { mapGameToInsertGame } from "@/lib/utils";

interface DashboardProps {}

export default function Dashboard({}: DashboardProps) {
  const [activeSection, setActiveSection] = useState("/");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [discoveryFilters, setDiscoveryFilters] = useState<{
    releaseStatus?: "all" | "released" | "upcoming";
    minYear?: number | null;
  }>({});
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Initialize based on current document theme
    return document.documentElement.classList.contains('dark');
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Debounce search query for live search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Different query logic based on section
  const getQueryConfig = () => {
    if (activeSection === "/discover") {
      return {
        queryKey: ['/api/games/discover', discoveryFilters],
        queryFn: async () => {
          const response = await fetch(`/api/games/discover?limit=20`);
          if (!response.ok) throw new Error('Failed to fetch recommendations');
          const games = await response.json();
          
          // Apply client-side filters
          let filteredGames = games;
          
          if (discoveryFilters.releaseStatus && discoveryFilters.releaseStatus !== "all") {
            filteredGames = filteredGames.filter((game: any) => {
              if (discoveryFilters.releaseStatus === "released") {
                return game.isReleased;
              } else if (discoveryFilters.releaseStatus === "upcoming") {
                return !game.isReleased;
              }
              return true;
            });
          }
          
          if (discoveryFilters.minYear) {
            filteredGames = filteredGames.filter((game: any) => 
              game.releaseYear && game.releaseYear >= discoveryFilters.minYear!
            );
          }
          
          return filteredGames;
        }
      };
    }
    
    // For library and other sections, query user's collection
    return {
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
    };
  };

  const { data: games = [], isLoading } = useQuery<Game[]>(getQueryConfig());

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
      queryClient.invalidateQueries({ queryKey: ['/api/games/discover'] });
      toast({ description: "Game status updated successfully" });
    },
    onError: () => {
      toast({ description: "Failed to update game status", variant: "destructive" });
    }
  });

  // Add game mutation (for Discovery games)
  const addGameMutation = useMutation({
    mutationFn: async ({ game, status }: { game: Game; status: GameStatus }) => {
      const gameData = mapGameToInsertGame(game);
      const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...gameData,
          status // Set the desired status when adding
        })
      });
      if (!response.ok) throw new Error('Failed to add game');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games'] });
      queryClient.invalidateQueries({ queryKey: ['/api/games/discover'] });
      toast({ description: "Game added to collection successfully" });
    },
    onError: () => {
      toast({ description: "Failed to add game to collection", variant: "destructive" });
    }
  });

  // Calculate unique genres and platforms from user's game collection
  const uniqueGenres = new Set(games.flatMap((g) => g.genres || []));
  const uniquePlatforms = new Set(games.flatMap((g) => g.platforms || []));

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

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const handleNavigation = (url: string) => {
    console.log(`Navigate to: ${url}`);
    setActiveSection(url);
  };

  const handleSearch = (query: string) => {
    console.log(`Search: ${query}`);
    setSearchQuery(query);
    // Query will automatically refetch due to queryKey dependency
  };

  const handleFilterToggle = () => {
    console.log("Filter panel toggled");
  };

  const handleRemoveFilter = (filter: string) => {
    console.log(`Remove filter: ${filter}`);
    setActiveFilters(prev => prev.filter(f => f !== filter));
  };

  const handleAddGame = () => {
    // Handled by AddGameModal component
  };

  const handleThemeToggle = () => {
    console.log("Theme toggle");
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    
    // Actually apply the theme to the document
    if (newMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleStatusChange = (gameId: string, newStatus: GameStatus) => {
    // Check if we're on the Discovery tab and this is an IGDB game
    if (activeSection === "/discover" && gameId.startsWith("igdb-")) {
      // Find the game in the current list (Discovery games)
      const game = games.find(g => g.id === gameId);
      if (game) {
        // Add the IGDB game to collection with the desired status
        addGameMutation.mutate({ game, status: newStatus });
      }
    } else {
      // Update status of existing game in collection
      statusMutation.mutate({ gameId, status: newStatus });
    }
  };

  const handleViewDetails = (gameId: string) => {
    console.log(`View details: ${gameId}`);
  };

  // Track game mutation (for Discovery games)
  const trackGameMutation = useMutation({
    mutationFn: async (game: Game) => {
      const gameData = mapGameToInsertGame(game);
      const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...gameData,
          status: 'wanted' // Set default status when tracking
        })
      });
      if (!response.ok) throw new Error('Failed to track game');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games'] });
      queryClient.invalidateQueries({ queryKey: ['/api/games/discover'] });
      toast({ description: "Game added to watchlist!" });
    },
    onError: () => {
      toast({ description: "Failed to track game", variant: "destructive" });
    }
  });

  const handleTrackGame = (game: Game) => {
    trackGameMutation.mutate(game);
  };

  const handleFiltersChange = (filters: { releaseStatus?: "all" | "released" | "upcoming"; minYear?: number | null; }) => {
    setDiscoveryFilters(filters);
  };

  const getPageTitle = () => {
    switch (activeSection) {
      case "/discover": return "Discover Games";
      case "/library": return "Game Library";
      case "/downloads": return "Downloads";
      case "/calendar": return "Release Calendar";
      case "/trending": return "Trending Games";
      case "/wishlist": return "Wishlist";
      case "/settings": return "Settings";
      default: return "Dashboard";
    }
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full" data-testid="layout-dashboard">
        <AppSidebar activeItem={activeSection} onNavigate={handleNavigation} />
        
        <div className="flex flex-col flex-1">
          <Header
            title={getPageTitle()}
            onAddGame={handleAddGame}
            onToggleTheme={handleThemeToggle}
            isDarkMode={isDarkMode}
            notificationCount={3}
          />
          
          <main className="flex-1 overflow-auto p-6">
            {activeSection === "/" && (
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
                    onViewDetails={handleViewDetails}
                    isLoading={isLoading}
                  />
                </div>
              </div>
            )}
            
            {activeSection !== "/" && (
              <div className="space-y-6">
                {activeSection === "/discover" ? (
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Personalized recommendations based on your collection
                    </div>
                    <DiscoveryFilters onFiltersChange={handleFiltersChange} />
                    <GameGrid
                      games={games}
                      onStatusChange={handleStatusChange}
                      onViewDetails={handleViewDetails}
                      onTrackGame={handleTrackGame}
                      isDiscovery={true}
                      isLoading={isLoading}
                    />
                  </div>
                ) : (
                  <>
                    <SearchBar
                      onSearch={handleSearch}
                      onFilterToggle={handleFilterToggle}
                      activeFilters={activeFilters}
                      onRemoveFilter={handleRemoveFilter}
                    />
                    <GameGrid
                      games={games}
                      onStatusChange={handleStatusChange}
                      onViewDetails={handleViewDetails}
                      isLoading={isLoading}
                    />
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}