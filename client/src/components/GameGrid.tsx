import GameCard from "./GameCard";
import { type Game } from "@shared/schema";
import { type GameStatus } from "./StatusBadge";

interface GameGridProps {
  games: Game[];
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onTrackGame?: (game: Game) => void;
  isDiscovery?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
}

export default function GameGrid({
  games,
  onStatusChange,
  onViewDetails,
  onTrackGame,
  isDiscovery = false,
  isLoading = false,
  isFetching = false,
}: GameGridProps) {
  if (isLoading) {
    return (
      <div
        className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-4"
        data-testid="grid-games-loading"
      >
        {Array.from({ length: 20 }).map((_, index) => (
          <div key={index} className="animate-pulse min-w-[150px] min-h-[200px]">
            <div className="bg-muted rounded-md aspect-[3/4] w-full max-w-[225px] max-h-[300px] mx-auto mb-4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-muted rounded w-3/4 mx-auto"></div>
              <div className="h-3 bg-muted rounded w-1/2 mx-auto"></div>
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
      className={`grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-4 transition-opacity duration-200 ${
        isFetching ? "opacity-50 pointer-events-none" : ""
      }`}
      data-testid="grid-games"
      aria-busy={isFetching}
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
