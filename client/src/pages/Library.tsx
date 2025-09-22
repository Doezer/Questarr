import GameGrid from "@/components/GameGrid";
import { type Game } from "@/components/GameCard";
import { Input } from "@/components/ui/input";
import { Search, AlertCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gameAPI } from "@/lib/api";
import { transformGame } from "@/lib/gameUtils";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";

export default function Library() {
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allGames = [], isLoading, isError } = useQuery({
    queryKey: ["games"],
    queryFn: gameAPI.getAll,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ gameId, status }: { gameId: string; status: GameStatus }) =>
      gameAPI.updateStatus(gameId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["games"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      toast({
        title: "Game updated",
        description: "Status updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update game status",
        variant: "destructive",
      });
    },
  });

  // Filter games to show only owned and playing/completed games
  const libraryGames = useMemo(() => {
    const ownedGames = allGames.filter(game => 
      game.status === "owned" || game.status === "playing" || game.status === "completed"
    );

    // Apply search filter
    if (!searchQuery) return ownedGames;
    
    const searchTerm = searchQuery.toLowerCase();
    return ownedGames.filter(game =>
      game.title.toLowerCase().includes(searchTerm) ||
      game.genre.toLowerCase().includes(searchTerm) ||
      (game.description && game.description.toLowerCase().includes(searchTerm))
    );
  }, [allGames, searchQuery]);

  const filteredGames = libraryGames.map(transformGame);

  const handleStatusChange = (gameId: string, status: GameStatus) => {
    updateStatusMutation.mutate({ gameId, status });
  };

  if (isError) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium">Failed to load library</h3>
          <p className="text-muted-foreground">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  const handleGameClick = (game: Game) => {
    console.log(`Clicked on game: ${game.title}`);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="text-library-title">Library</h1>
        <p className="text-muted-foreground">Your owned game collection</p>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search your library..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-library-search"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="text-lg">Loading your library...</div>
        </div>
      ) : (
        <GameGrid
          games={filteredGames}
          title={`Your Library (${filteredGames.length} games)`}
          onGameClick={handleGameClick}
          onStatusChange={handleStatusChange}
          showFilters={true}
        />
      )}
    </div>
  );
}