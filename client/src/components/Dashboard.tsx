import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import Header from "./Header";
import AddGameModal from "./AddGameModal";
import SearchBar from "./SearchBar";
import GameGrid from "./GameGrid";
import StatsCard from "./StatsCard";
import { Library, Download, Star, Calendar } from "lucide-react";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { useToast } from "@/hooks/use-toast";

interface DashboardProps {}

export default function Dashboard({}: DashboardProps) {
  const [activeSection, setActiveSection] = useState("/");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(true);
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
        queryKey: ['/api/games/discover'],
        queryFn: async () => {
          const response = await fetch(`/api/games/discover?limit=20`);
          if (!response.ok) throw new Error('Failed to fetch recommendations');
          return response.json();
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

  // Status update mutation
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

  const stats = [
    {
      title: "Total Games",
      value: games.length,
      subtitle: "in your library",
      icon: Library,
      trend: { value: 12, label: "from last month" }
    },
    {
      title: "Downloads", 
      value: games.filter((g) => g.status === "downloading").length,
      subtitle: "in progress",
      icon: Download
    },
    {
      title: "Wishlist",
      value: games.filter((g) => g.status === "wanted").length,
      subtitle: "wanted games", 
      icon: Star,
      trend: { value: -2, label: "from last week" }
    },
    {
      title: "Releases",
      value: 8,
      subtitle: "this month",
      icon: Calendar,
      trend: { value: 5, label: "vs last month" }
    }
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
    setIsDarkMode(!isDarkMode);
  };

  const handleStatusChange = (gameId: string, newStatus: GameStatus) => {
    statusMutation.mutate({ gameId, status: newStatus });
  };

  const handleViewDetails = (gameId: string) => {
    console.log(`View details: ${gameId}`);
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
                      trend={stat.trend}
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
                    <GameGrid
                      games={games}
                      onStatusChange={handleStatusChange}
                      onViewDetails={handleViewDetails}
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