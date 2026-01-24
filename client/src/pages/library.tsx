import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/EmptyState";
import { Gamepad2 } from "lucide-react";
import { useLocation } from "wouter";

export default function LibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  // Library typically contains owned, completed, or actively downloading games
  const libraryGames = games.filter((g) =>
    ["owned", "completed", "downloading"].includes(g.status)
  );

  const statusMutation = useMutation({
    mutationFn: async ({ gameId, status }: { gameId: string; status: GameStatus }) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/games/${gameId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update status");
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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Library</h1>
          <p className="text-muted-foreground">Your collection of games</p>
        </div>
      </div>

      {libraryGames.length === 0 && !isLoading ? (
        <EmptyState
          icon={Gamepad2}
          title="No games found"
          description="No games in your library. Add games from the Discover page."
          action={{
            label: "Go to Discover",
            onClick: () => setLocation("/discover"),
          }}
        />
      ) : (
        <GameGrid
          games={libraryGames}
          onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
