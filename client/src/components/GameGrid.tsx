import GameCard from "./GameCard";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";
import { cn } from "@/lib/utils";

interface GameGridProps {
  games: Game[];
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onTrackGame?: (game: Game) => void;
  isDiscovery?: boolean;
  isLoading?: boolean;
  isUpdating?: boolean;
}

export default function GameGrid({
  games,
  onStatusChange,
  onViewDetails,
  onTrackGame,
  isDiscovery = false,
  isLoading = false,
  isUpdating = false,
}: GameGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4" data-testid="grid-games-loading">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="animate-pulse">
            <div className="bg-muted rounded-md aspect-[3/4] mb-4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
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
        "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4",
        {
          "opacity-50 pointer-events-none": isUpdating,
        }
      )}
      data-testid="grid-games"
      aria-busy={isUpdating}
    >
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onStatusChange={onStatusChange}
          onViewDetails={onViewDetails}
          onTrackGame={onTrackGame}
          isDiscovery={isDiscovery}
        />
      ))}
    </div>
  );
}