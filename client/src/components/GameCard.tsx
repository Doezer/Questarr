import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatusBadge, { type GameStatus } from "./StatusBadge";
import PlatformBadge, { type Platform } from "./PlatformBadge";
import { Calendar, Star, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { type Game as APIGame } from "@shared/schema";

export interface Game extends Omit<APIGame, 'platforms' | 'rating' | 'createdAt' | 'updatedAt'> {
  platforms: Platform[];
  rating?: number;
}

interface GameCardProps {
  game: Game;
  onClick?: (game: Game) => void;
  onStatusChange?: (gameId: string, status: GameStatus) => void;
}

export default function GameCard({ game, onClick, onStatusChange }: GameCardProps) {
  const handleStatusChange = (status: GameStatus) => {
    onStatusChange?.(game.id, status);
    console.log(`Status changed to ${status} for ${game.title}`);
  };

  const handleCardClick = () => {
    onClick?.(game);
    console.log(`Clicked on ${game.title}`);
  };

  return (
    <Card 
      className="group cursor-pointer hover-elevate transition-all duration-200"
      onClick={handleCardClick}
      data-testid={`card-game-${game.id}`}
    >
      <CardContent className="p-0">
        <div className="relative">
          <img
            src={game.coverImage}
            alt={game.title}
            className="w-full aspect-[3/4] object-cover rounded-t-md"
            data-testid={`img-game-cover-${game.id}`}
          />
          
          {/* Status Badge */}
          <div className="absolute top-2 left-2">
            <StatusBadge status={game.status} />
          </div>

          {/* Actions Menu */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8"
                  data-testid={`button-game-menu-${game.id}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleStatusChange("owned")}>
                  Mark as Owned
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("wishlist")}>
                  Add to Wishlist
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("playing")}>
                  Currently Playing
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("completed")}>
                  Mark Completed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Rating */}
          {game.rating && game.rating > 0 && (
            <div className="absolute bottom-2 right-2">
              <Badge variant="secondary" className="gap-1">
                <Star className="h-3 w-3 fill-current" />
                {game.rating.toFixed(1)}
              </Badge>
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <div>
            <h3 
              className="font-semibold text-sm leading-tight line-clamp-2 mb-1"
              data-testid={`text-game-title-${game.id}`}
            >
              {game.title}
            </h3>
            <p className="text-xs text-muted-foreground">{game.genre}</p>
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{game.releaseDate}</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {game.platforms.map((platform) => (
              <PlatformBadge key={platform} platform={platform} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}