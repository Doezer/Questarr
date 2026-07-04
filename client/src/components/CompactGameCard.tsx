import React, { memo, useState, useEffect, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Download, Info, Star, Calendar, Eye, EyeOff, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import StatusBadge, { type GameStatus } from "./StatusBadge";
import StatusPicker from "./StatusPicker";
import { type Game, type DownloadSummary } from "@shared/schema";
import DownloadIndicator from "./DownloadIndicator";
import SearchResultsBadge from "./SearchResultsBadge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mapGameToInsertGame, isDiscoveryId, cn, parseReleaseDate } from "@/lib/utils";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import LazyModalFallback from "./LazyModalFallback";
import { getReleaseStatus } from "@/lib/game-utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

const GameDetailsModal = lazy(() => import("./GameDetailsModal"));
const GameDownloadDialog = lazy(() => import("./GameDownloadDialog"));

interface CompactGameCardProps {
  game: Game;
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
  onViewDetails?: (gameId: string) => void;
  onToggleHidden?: (gameId: string, hidden: boolean) => void;
  isDiscovery?: boolean;
  density?: "comfortable" | "compact";
  downloadSummary?: DownloadSummary;
  /** When true, the row uses CSS subgrid (parent must provide the grid context). */
  useSubgrid?: boolean;
  mobileLayout?: boolean;
}

const DEFAULT_RATING = 5;

// Comfortable: Cover | Title | Genres | Score | My Score | Release | Status | Type | Actions
// Compact:           Title | Genres | Score | My Score | Release | Status | Type | Actions
const GRID_COLS = {
  comfortable: "52px 1fr 180px 64px 64px 76px 90px 90px auto",
  compact: "1fr 180px 64px 64px 76px 90px 90px auto",
} as const;

const CompactGameCard = ({
  game,
  onStatusChange,
  onViewDetails,
  onToggleHidden,
  isDiscovery = false,
  density = "comfortable",
  downloadSummary,
  useSubgrid = false,
  mobileLayout = false,
}: CompactGameCardProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [popoverRating, setPopoverRating] = useState<number>(game.userRating ?? DEFAULT_RATING);
  const releaseStatus = getReleaseStatus(game);
  const [resolvedGame, setResolvedGame] = useState<Game>(game);

  useEffect(() => {
    setResolvedGame(game);
  }, [game]);

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
        if (error instanceof ApiError && error.status === 409) {
          const data = error.data as Record<string, unknown>;
          if (data?.game) return data.game as Game;
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

  const userRatingMutation = useMutation({
    mutationFn: async ({ gameId, userRating }: { gameId: string; userRating: number | null }) => {
      await apiRequest("PATCH", `/api/games/${gameId}/user-rating`, { userRating });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/games"] }),
    onError: () => toast({ description: "Failed to save your rating", variant: "destructive" }),
  });

  const handleDetailsClick = () => {
    setDetailsOpen(true);
    onViewDetails?.(game.id);
  };
  const handleDownloadClick = async () => {
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
  const handleToggleHidden = () => onToggleHidden?.(game.id, !game.hidden);
  const { year: releaseYear, fullDate: releaseFullDate } = parseReleaseDate(game.releaseDate);
  const ratingDisplay = game.rating === null ? null : game.rating.toFixed(1);
  if (mobileLayout) {
    return (
      <>
        <div
          className={cn(
            "rounded-xl border border-border bg-card p-3 shadow-sm",
            game.hidden && "opacity-60 grayscale"
          )}
          data-testid={`card-game-compact-${game.id}`}
        >
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDetailsClick}
              className="h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-muted"
              aria-label={`View details for ${game.title}`}
            >
              <img
                src={game.coverUrl || "/placeholder-game-cover.jpg"}
                alt={`${game.title} cover`}
                className="h-full w-full object-cover"
                loading="lazy"
                data-testid={`img-cover-${game.id}`}
              />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={handleDetailsClick}
                  className="min-w-0 text-left"
                  aria-label={`View details for ${game.title}`}
                >
                  <h3
                    className="truncate text-sm font-semibold"
                    data-testid={`text-title-${game.id}`}
                  >
                    {game.title}
                  </h3>
                </button>
                {!isDiscovery && game.status && <StatusBadge status={game.status} />}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1">
                <DownloadIndicator summary={downloadSummary} variant="inline" />
                <SearchResultsBadge
                  visible={game.searchResultsAvailable ?? false}
                  variant="inline"
                />
                {!isDiscovery && game.status === "wanted" && (
                  <Badge
                    variant={releaseStatus.variant}
                    className={cn("h-5 px-1.5 text-[10px]", releaseStatus.className)}
                  >
                    {releaseStatus.label}
                  </Badge>
                )}
                {game.earlyAccess && (
                  <Badge className="h-5 bg-amber-500 px-1.5 text-[10px] text-white">EA</Badge>
                )}
                {game.hidden && (
                  <Badge
                    variant="secondary"
                    className="h-5 bg-gray-500 px-1.5 text-[10px] text-white"
                  >
                    Hidden
                  </Badge>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {game.genres && game.genres.length > 0 ? (
                  <>
                    {game.genres.slice(0, 2).map((genre) => (
                      <span
                        key={genre}
                        className="rounded-full bg-muted/70 px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        {genre}
                      </span>
                    ))}
                    {game.genres.length > 2 && (
                      <span className="rounded-full bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground/60">
                        +{game.genres.length - 2} more
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground/50">No genres</span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3 text-amber-400" />
                  {ratingDisplay ? `${ratingDisplay}/10` : "N/A"}
                </span>
                {!isDiscovery && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-primary text-primary" />
                    {game.userRating === null ? "—" : `${game.userRating.toFixed(1)}/10`}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {releaseYear}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isDiscovery ? (
              <Button
                size="icon"
                variant="default"
                className="h-10 w-10"
                onClick={handleDownloadClick}
                disabled={addGameMutation.isPending}
                aria-label={`Download ${game.title}`}
              >
                {addGameMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <StatusPicker
                currentStatus={game.status as GameStatus}
                onStatusChange={(newStatus) => onStatusChange?.(game.id, newStatus)}
                gameTitle={game.title}
              />
            )}

            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10"
              onClick={handleDetailsClick}
              aria-label={`View details for ${game.title}`}
            >
              <Info className="h-4 w-4" />
            </Button>

            {!isDiscovery && (
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={handleToggleHidden}
                aria-label={game.hidden ? `Unhide ${game.title}` : `Hide ${game.title}`}
              >
                {game.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {detailsOpen && (
          <Suspense fallback={<LazyModalFallback message="Loading game details..." />}>
            <GameDetailsModal
              game={resolvedGame}
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
            />
          </Suspense>
        )}

        {downloadOpen && (
          <Suspense fallback={<LazyModalFallback message="Loading download dialog..." />}>
            <GameDownloadDialog
              game={resolvedGame}
              open={downloadOpen}
              onOpenChange={setDownloadOpen}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <>
      <div
        onClick={handleDetailsClick}
        style={
          useSubgrid
            ? { gridColumn: "1 / -1", gridTemplateColumns: "subgrid" }
            : { gridTemplateColumns: GRID_COLS[density] }
        }
        className={cn(
          "group grid items-center cursor-pointer transition-all duration-150",
          game.hidden && "opacity-60 grayscale",
          density === "comfortable" &&
            useSubgrid &&
            "py-2 border-b border-border/40 hover:bg-accent/30",
          density === "comfortable" &&
            !useSubgrid &&
            "gap-3 pl-[13px] pr-3 py-2 border-l-[3px] border-l-transparent hover:bg-accent/30 hover:border-l-primary",
          density === "compact" && "gap-2 px-2 py-1 border-b border-slate-700/50 hover:bg-accent/20"
        )}
        data-testid={`card-game-compact-${game.id}`}
      >
        {/* Cover */}
        {density !== "compact" && (
          <div
            className={cn(
              "flex-shrink-0 overflow-hidden bg-muted",
              density === "comfortable" ? "h-[68px] w-[52px] rounded" : "h-9 w-9 rounded-sm"
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

        {/* Title */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <h3
            className={cn(
              "font-medium truncate",
              density === "comfortable" ? "text-sm" : "text-xs"
            )}
            data-testid={`text-title-${game.id}`}
          >
            {game.title}
          </h3>
          <DownloadIndicator summary={downloadSummary} variant="inline" />
          <SearchResultsBadge visible={game.searchResultsAvailable ?? false} variant="inline" />
        </div>

        {/* Genres */}
        {density === "comfortable" ? (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {game.genres && game.genres.length > 0 ? (
              <>
                {game.genres.slice(0, 2).map((genre) => (
                  <span
                    key={genre}
                    className="text-[10px] bg-muted/70 text-muted-foreground rounded-full px-1.5 py-0.5 truncate max-w-[72px]"
                  >
                    {genre}
                  </span>
                ))}
                {game.genres.length > 2 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                    +{game.genres.length - 2}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground/40">—</span>
            )}
          </div>
        ) : (
          <div className="min-w-0 overflow-hidden">
            {game.genres && game.genres.length > 0 ? (
              <span className="text-xs text-muted-foreground/70 truncate block">
                {game.genres.slice(0, 2).join(" • ")}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/30">—</span>
            )}
          </div>
        )}

        {/* Score (IGDB) */}
        <div className="flex items-center justify-center gap-1 tabular-nums">
          <Star className="w-3 h-3 text-amber-400 flex-shrink-0" />
          <span className="text-xs text-muted-foreground">
            {ratingDisplay ?? <span className="opacity-40">—</span>}
          </span>
        </div>
        {/* My Score — comfortable gets interactive popover, compact shows static value */}
        <div className="flex items-center justify-center">
          {density === "comfortable" && !isDiscovery ? (
            <Popover
              onOpenChange={(open) => {
                if (open) setPopoverRating(game.userRating ?? DEFAULT_RATING);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1 tabular-nums hover:text-foreground text-muted-foreground transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={
                    game.userRating == null
                      ? "Rate this game"
                      : `My rating: ${game.userRating}/10. Click to change.`
                  }
                >
                  <Star className="w-3 h-3 fill-primary text-primary flex-shrink-0" />
                  <span className="text-xs">
                    {game.userRating == null ? (
                      <span className="opacity-40">—</span>
                    ) : (
                      game.userRating.toFixed(1)
                    )}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">My Rating</span>
                  <span className="text-sm font-bold">{popoverRating}/10</span>
                </div>
                <Slider
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={[popoverRating]}
                  onValueChange={([val]) => setPopoverRating(val)}
                  onValueCommit={([val]) =>
                    userRatingMutation.mutate({ gameId: game.id, userRating: val })
                  }
                  aria-label="My rating"
                />
                {game.userRating != null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-7 text-xs text-muted-foreground"
                    onClick={() => {
                      setPopoverRating(DEFAULT_RATING);
                      userRatingMutation.mutate({ gameId: game.id, userRating: null });
                    }}
                  >
                    Clear rating
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            <>
              {!isDiscovery && game.userRating != null ? (
                <div className="flex items-center gap-1 tabular-nums">
                  <Star className="w-3 h-3 fill-primary text-primary flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    {game.userRating.toFixed(1)}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground/30">—</span>
              )}
            </>
          )}
        </div>

        {/* Release */}
        <div className="flex items-center justify-center gap-1">
          <Calendar className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
          {releaseFullDate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-default">{releaseYear}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{releaseFullDate}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">{releaseYear}</span>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center justify-center">
          {!isDiscovery && game.status && <StatusBadge status={game.status} />}
        </div>
        {/* Type (release status, EA, hidden) */}
        <div className="flex items-center justify-center gap-0.5 flex-wrap">
          {!isDiscovery && game.status === "wanted" && (
            <Badge
              variant={releaseStatus.variant}
              className={cn("text-[9px] h-4 px-1", releaseStatus.className)}
            >
              {releaseStatus.label}
            </Badge>
          )}
          {game.earlyAccess && (
            <Badge className="text-[9px] h-4 px-1 bg-amber-500 border-amber-600 text-white">
              EA
            </Badge>
          )}
          {game.hidden && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-gray-500 text-white">
              Hidden
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1" aria-label="Game actions">
          {isDiscovery ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="default"
                  className={cn(
                    "transition-all",
                    density === "comfortable" ? "h-7 w-7" : "h-6 w-6"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadClick();
                  }}
                  disabled={addGameMutation.isPending}
                  aria-label={`Download ${game.title}`}
                >
                  {addGameMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
          ) : (
            <StatusPicker
              currentStatus={game.status as GameStatus}
              onStatusChange={(newStatus) => onStatusChange?.(game.id, newStatus)}
              gameTitle={game.title}
            >
              <Button
                variant="ghost"
                size="icon"
                disabled={game.status === "downloading"}
                className={cn(
                  "transition-all text-muted-foreground hover:text-foreground",
                  density === "comfortable" ? "h-7 w-7" : "h-6 w-6"
                )}
                aria-label={`Change status for ${game.title}`}
                onClick={(e) => e.stopPropagation()}
              >
                {(() => {
                  if (game.status === "wanted") {
                    return <span className="text-[11px]">📂</span>;
                  } else if (game.status === "owned") {
                    return <span className="text-[11px]">✔</span>;
                  } else if (game.status === "shelved") {
                    return <span className="text-[11px]">📦</span>;
                  } else {
                    return <span className="text-[11px]">★</span>;
                  }
                })()}
              </Button>
            </StatusPicker>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "transition-all text-muted-foreground hover:text-foreground",
                  density === "comfortable" ? "h-7 w-7" : "h-6 w-6"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDetailsClick();
                }}
                aria-label={`View details for ${game.title}`}
              >
                <Info className="w-3 h-3" />
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
                    "transition-all text-muted-foreground hover:text-foreground",
                    density === "comfortable" ? "h-7 w-7" : "h-6 w-6"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleHidden();
                  }}
                  aria-label={game.hidden ? `Unhide ${game.title}` : `Hide ${game.title}`}
                >
                  {game.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{game.hidden ? "Unhide" : "Hide"}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {detailsOpen && (
        <Suspense fallback={<LazyModalFallback message="Loading game details..." />}>
          <GameDetailsModal game={resolvedGame} open={detailsOpen} onOpenChange={setDetailsOpen} />
        </Suspense>
      )}

      {downloadOpen && (
        <Suspense fallback={<LazyModalFallback message="Loading download dialog..." />}>
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
