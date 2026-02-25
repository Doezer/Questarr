import React, { memo, useState, useEffect, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Download, Info, Star, Calendar, Eye, EyeOff, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import StatusBadge, { type GameStatus } from "./StatusBadge";
import { type Game } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mapGameToInsertGame, isDiscoveryId, cn } from "@/lib/utils";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ⚡ Bolt: Lazy load heavy modal components to reduce initial bundle size.
// These are only needed when the user interacts with the card.
const GameDetailsModal = lazy(() => import("./GameDetailsModal"));
const GameDownloadDialog = lazy(() => import("./GameDownloadDialog"));

interface CompactGameCardProps {
  game: Game;
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onToggleHidden?: (gameId: string, hidden: boolean) => void;
  isDiscovery?: boolean;
  density?: "comfortable" | "compact" | "ultra-compact";
}

function getReleaseStatus(game: Game): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  isReleased: boolean;
  className?: string;
} {
  if (game.releaseStatus === "delayed") {
    return { label: "Delayed", variant: "destructive", isReleased: false };
  }

  if (!game.releaseDate) return { label: "TBA", variant: "secondary", isReleased: false };

  const now = new Date();
  const release = new Date(game.releaseDate);

  if (release > now) {
    return { label: "Upcoming", variant: "default", isReleased: false };
  }
  return {
    label: "Released",
    variant: "outline",
    isReleased: true,
    className: "bg-green-500 border-green-600 text-white",
  };
}

const CompactGameCard = ({
  game,
  onStatusChange,
  onViewDetails,
  onToggleHidden,
  isDiscovery = false,
  density = "comfortable",
}: CompactGameCardProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const releaseStatus = getReleaseStatus(game);

  // Keep track of the resolved game object (either original or newly added)
  const [resolvedGame, setResolvedGame] = useState<Game>(game);

  // Update resolved game if props change
  useEffect(() => {
    setResolvedGame(game);
  }, [game]);

  // For auto-adding games when downloading from Discovery
  const addGameMutation = useMutation<Game, Error, Game>({
    mutationFn: async (game: Game) => {
      const gameData = mapGameToInsertGame(game);

      try {
        const response = await apiRequest("POST", "/api/games", {
          ...gameData,
          status: "wanted",
        });
        return response.json() as Promise<Game>;
      } catch (error) {
        // Handle 409 Conflict (already in library)
        if (error instanceof ApiError && error.status === 409) {
          const data = error.data as Record<string, unknown>;
          if (data?.game) {
            return data.game as Game;
          }
          // Fallback if data format is unexpected but we know it's a 409
          return game;
        }
        throw error;
      }
    },
    onSuccess: (newGame) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      setResolvedGame(newGame);
    },
  });

  const handleStatusClick = () => {
    const nextStatus: GameStatus =
      game.status === "wanted" ? "owned" : game.status === "owned" ? "completed" : "wanted";
    onStatusChange?.(game.id, nextStatus);
  };

  const handleDetailsClick = () => {
    setDetailsOpen(true);
    onViewDetails?.(game.id);
  };

  const handleDownloadClick = async () => {
    // If it's a discovery game (temporary ID), add it to library first
    if (isDiscoveryId(resolvedGame.id)) {
      try {
        const gameInLibrary = await addGameMutation.mutateAsync(resolvedGame);
        setResolvedGame(gameInLibrary);
        setDownloadOpen(true);
      } catch (error) {
        console.error("Failed to add game to library before downloading:", error);
        toast({
          description: "Failed to add game to library before downloading",
          variant: "destructive",
        });
      }
    } else {
      setDownloadOpen(true);
    }
  };

  const handleToggleHidden = () => {
    onToggleHidden?.(game.id, !game.hidden);
  };

  return (
    <>
      <div
        onClick={handleDetailsClick}
        className={cn(
          "group flex items-center transition-colors hover:bg-accent/50 cursor-pointer",
          game.hidden && "opacity-60 grayscale",
          density === "comfortable" &&
            "gap-4 p-3 rounded-lg border bg-card text-card-foreground shadow-sm",
          density === "compact" &&
            "gap-3 py-1.5 px-2 border-b border-slate-700/50 bg-transparent rounded-none",
          density === "ultra-compact" &&
            "gap-2 py-1 px-2 border-b border-slate-700/50 bg-transparent rounded-none"
        )}
        data-testid={`card-game-compact-${game.id}`}
      >
        {/* Cover Image */}
        {density !== "ultra-compact" && (
          <div
            className={cn(
              "flex-shrink-0 relative overflow-hidden bg-muted",
              density === "comfortable" ? "w-16 h-24 rounded" : "w-8 h-8 rounded-sm"
            )}
          >
            <img
              src={game.coverUrl || "/placeholder-game-cover.jpg"}
              alt={`${game.title} cover`}
              className="w-full h-full object-cover"
              loading="lazy"
              data-testid={`img-cover-${game.id}`}
            />
          </div>
        )}

        {/* Content */}
        <div
          className={cn(
            "flex-grow min-w-0 flex",
            density === "ultra-compact" ? "flex-row items-center gap-4" : "flex-col gap-1"
          )}
        >
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h3
              className={cn(
                "font-semibold truncate",
                density === "comfortable" ? "text-base" : "text-sm"
              )}
              data-testid={`text-title-${game.id}`}
            >
              {game.title}
            </h3>
            {!isDiscovery && game.status && (
              <div className={density !== "comfortable" ? "scale-90 origin-left" : ""}>
                <StatusBadge status={game.status} />
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex items-center text-muted-foreground",
              density === "ultra-compact" ? "gap-3 text-xs ml-auto" : "gap-4 text-xs"
            )}
          >
            {/* Rating */}
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 text-accent" />
              <span>{game.rating ? `${game.rating}/10` : "N/A"}</span>
            </div>

            {/* Release Date */}
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{game.releaseDate || "TBA"}</span>
            </div>

            {/* Release Status Badge */}
            {game.status === "wanted" && (
              <Badge
                variant={releaseStatus.variant}
                className={`text-[10px] h-5 px-1.5 ${releaseStatus.className || ""}`}
              >
                {releaseStatus.label}
              </Badge>
            )}

            {/* Hidden Badge */}
            {game.hidden && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] h-5 px-1.5 bg-gray-500 text-white",
                  density !== "comfortable" ? "h-4 px-1 text-[9px]" : ""
                )}
              >
                Hidden
              </Badge>
            )}

            {/* Genres */}
            {density !== "comfortable" && (
              <div
                className={cn(
                  "hidden sm:flex items-center",
                  density === "ultra-compact" ? "gap-2 ml-4 border-l pl-4" : "gap-1"
                )}
              >
                {game.genres && game.genres.length > 0 ? (
                  <span className="truncate max-w-[200px]">
                    {game.genres.slice(0, 3).join(" • ")}
                  </span>
                ) : null}
              </div>
            )}
          </div>

          {/* Genres (Comfortable Mode) */}
          {density === "comfortable" && (
            <div className="flex flex-wrap gap-1 mt-1">
              {game.genres && game.genres.length > 0 ? (
                game.genres.slice(0, 3).map((genre) => (
                  <span key={genre} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-sm">
                    {genre}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground">No genres</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          className={cn(
            "flex items-center self-center",
            density === "ultra-compact" ? "gap-1 ml-4" : "gap-2"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {isDiscovery ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="default"
                  className={cn(
                    "transition-all",
                    density !== "comfortable" ? "h-6 w-6" : "h-8 w-8"
                  )}
                  onClick={handleDownloadClick}
                  disabled={addGameMutation.isPending}
                  aria-label="Download game"
                >
                  {addGameMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className={density !== "comfortable" ? "w-3 h-3" : "w-4 h-4"} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "hidden sm:flex",
                density !== "comfortable"
                  ? "h-6 w-6 p-0 border-0 hover:bg-slate-700"
                  : "h-8 text-xs"
              )}
              onClick={handleStatusClick}
            >
              {density !== "comfortable" ? (
                game.status === "wanted" ? (
                  <span title="Mark Owned">📂</span>
                ) : game.status === "owned" ? (
                  <span title="Mark Completed">✔</span>
                ) : (
                  <span title="Mark Wanted">★</span>
                )
              ) : game.status === "wanted" ? (
                "Mark Owned"
              ) : game.status === "owned" ? (
                "Mark Completed"
              ) : (
                "Mark Wanted"
              )}
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={cn("transition-all", density !== "comfortable" ? "h-6 w-6" : "h-8 w-8")}
                onClick={handleDetailsClick}
                aria-label="View details"
              >
                <Info className={density !== "comfortable" ? "w-3 h-3" : "w-4 h-4"} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View Details</TooltipContent>
          </Tooltip>

          {!isDiscovery && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "transition-all",
                    density !== "comfortable" ? "h-6 w-6" : "h-8 w-8"
                  )}
                  onClick={handleToggleHidden}
                  aria-label={game.hidden ? "Unhide game" : "Hide game"}
                >
                  {game.hidden ? (
                    <Eye className={density !== "comfortable" ? "w-3 h-3" : "w-4 h-4"} />
                  ) : (
                    <EyeOff className={density !== "comfortable" ? "w-3 h-3" : "w-4 h-4"} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{game.hidden ? "Unhide" : "Hide"}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {detailsOpen && (
        <Suspense fallback={null}>
          <GameDetailsModal game={resolvedGame} open={detailsOpen} onOpenChange={setDetailsOpen} />
        </Suspense>
      )}

      {downloadOpen && (
        <Suspense fallback={null}>
          <GameDownloadDialog
            game={resolvedGame}
            open={downloadOpen}
            onOpenChange={setDownloadOpen}
          />
        </Suspense>
      )}
    </>
  );
};

export default memo(CompactGameCard);
