import React, { useMemo } from "react";
import GameCard from "./GameCard";
import CompactGameCard from "./CompactGameCard";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { cn } from "@/lib/utils";

interface GameGridProps {
  games: Game[];
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onTrackGame?: (game: Game) => void;
  onToggleHidden?: (gameId: string, hidden: boolean) => void;
  isDiscovery?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  columns?: number;
  viewMode?: "grid" | "list";
}

export default function GameGrid({
  games,
  onStatusChange,
  onViewDetails,
  onTrackGame,
  onToggleHidden,
  isDiscovery = false,
  isLoading = false,
  isFetching = false,
  columns = 5,
  viewMode = "grid",
}: GameGridProps) {
  // Map column count to tailwind classes
  const gridColsClass = useMemo(() => {
    if (viewMode === "list") return "grid-cols-1";

    switch (columns) {
      case 2:
        return "grid-cols-2";
      case 3:
        return "grid-cols-3";
      case 4:
        return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
      case 5:
        return "grid-cols-3 sm:grid-cols-4 md:grid-cols-5";
      case 6:
        return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6";
      case 7:
        return "grid-cols-3 sm:grid-cols-5 md:grid-cols-7";
      case 8:
        return "grid-cols-4 sm:grid-cols-6 md:grid-cols-8";
      case 9:
        return "grid-cols-4 sm:grid-cols-6 md:grid-cols-9";
      case 10:
        return "grid-cols-5 sm:grid-cols-7 md:grid-cols-10";
      default:
        return "grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
    }
  }, [columns, viewMode]);

  if (isLoading) {
    return (
      <div className={cn("grid gap-4", gridColsClass)} data-testid="grid-games-loading">
        {Array.from({ length: 20 }).map((_, index) => (
          <div key={index} className={cn("animate-pulse bg-muted rounded-md", viewMode === 'list' ? "h-24 w-full" : "min-w-[150px] min-h-[200px]")}>
            {viewMode === 'grid' && (
              <div className="bg-muted-foreground/10 rounded-md aspect-[3/4] w-full max-w-[225px] max-h-[300px] mx-auto mb-4"></div>
            )}
            <div className="space-y-2 p-4">
              <div className="h-4 bg-muted-foreground/10 rounded w-3/4"></div>
              <div className="h-3 bg-muted-foreground/10 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="text-center py-12" data-testid="text-no-games">
        <div className="text-muted-foreground text-lg mb-2">No games found</div>
        <div className="text-sm text-muted-foreground">Try adjusting your search or filters</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-4 transition-opacity duration-200",
        gridColsClass,
        isFetching ? "opacity-50 pointer-events-none" : ""
      )}
      data-testid="grid-games"
      aria-busy={isFetching}
    >
      {games.map((game) => (
        viewMode === 'list' ? (
          <CompactGameCard
            key={game.id}
            game={game}
            onStatusChange={onStatusChange}
            onViewDetails={onViewDetails}
            onTrackGame={onTrackGame}
            onToggleHidden={onToggleHidden}
            isDiscovery={isDiscovery}
          />
        ) : (
          <GameCard
            key={game.id}
            game={game}
            onStatusChange={onStatusChange}
            onViewDetails={onViewDetails}
            onTrackGame={onTrackGame}
            onToggleHidden={onToggleHidden}
            isDiscovery={isDiscovery}
          />
        )
      ))}
    </div>
  );
}
