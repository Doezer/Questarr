import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import GameGrid from "@/components/GameGrid";
import { type Game } from "@shared/schema";
import { type GameStatus } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import EmptyState from "@/components/EmptyState";
import { Gamepad2, LayoutGrid, List, Settings2 } from "lucide-react";
import { useState, useEffect } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export default function LibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("libraryViewMode") as "grid" | "list") || "grid";
  });
  const [listDensity, setListDensity] = useState<"comfortable" | "compact" | "ultra-compact">(
    () => {
      return (
        (localStorage.getItem("libraryListDensity") as
          | "comfortable"
          | "compact"
          | "ultra-compact") || "comfortable"
      );
    }
  );

  useEffect(() => {
    localStorage.setItem("libraryViewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("libraryListDensity", listDensity);
  }, [listDensity]);

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
        <div className="flex items-center gap-2">
          {viewMode === "list" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only sm:inline-block">
                    {listDensity === "comfortable"
                      ? "Comfortable"
                      : listDensity === "compact"
                        ? "Compact"
                        : "Ultra-compact"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Row Density</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setListDensity("comfortable")}>
                  Comfortable
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setListDensity("compact")}>
                  Compact
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setListDensity("ultra-compact")}>
                  Ultra-compact
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && setViewMode(value as "grid" | "list")}
          >
            <ToggleGroupItem value="grid" aria-label="Grid View">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List View">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {libraryGames.length === 0 && !isLoading ? (
        <EmptyState
          icon={Gamepad2}
          title="No games in library"
          description="Your library is looking a bit empty. Track games you own or want to play from the Discover page."
          actionLabel="Discover Games"
          actionLink="/discover"
        />
      ) : (
        <GameGrid
          games={libraryGames}
          onStatusChange={(id, status) => statusMutation.mutate({ gameId: id, status })}
          isLoading={isLoading}
          viewMode={viewMode}
          density={listDensity}
        />
      )}
    </div>
  );
}
