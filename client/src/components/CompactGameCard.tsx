import React, { memo, useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, Info, Star, Calendar, Eye, EyeOff, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import StatusBadge, { type GameStatus } from "./StatusBadge";
import { type Game } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import GameDetailsModal from "./GameDetailsModal";
import GameDownloadDialog from "./GameDownloadDialog";
import { mapGameToInsertGame, isDiscoveryId, cn } from "@/lib/utils";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CompactGameCardProps {
    game: Game;
    onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
    onViewDetails?: (gameId: string) => void;
    onToggleHidden?: (gameId: string, hidden: boolean) => void;
    isDiscovery?: boolean;
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
                className={cn(
                    "group flex items-center gap-4 p-3 rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:bg-accent/50",
                    game.hidden && "opacity-60 grayscale"
                )}
                data-testid={`card-game-compact-${game.id}`}
            >
                {/* Cover Image */}
                <div className="flex-shrink-0 relative w-16 h-24 rounded overflow-hidden bg-muted">
                    <img
                        src={game.coverUrl || "/placeholder-game-cover.jpg"}
                        alt={`${game.title} cover`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        data-testid={`img-cover-${game.id}`}
                    />
                </div>

                {/* Content */}
                <div className="flex-grow min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base truncate" data-testid={`text-title-${game.id}`}>
                            {game.title}
                        </h3>
                        {!isDiscovery && game.status && <StatusBadge status={game.status} />}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-gray-500 text-white">
                                Hidden
                            </Badge>
                        )}
                    </div>

                    {/* Genres */}
                    <div className="flex flex-wrap gap-1 mt-1">
                        {game.genres?.slice(0, 3).map((genre) => (
                            <span
                                key={genre}
                                className="text-[10px] bg-muted px-1.5 py-0.5 rounded-sm"
                            >
                                {genre}
                            </span>
                        )) || <span className="text-[10px] text-muted-foreground">No genres</span>}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-center">
                    {isDiscovery ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="default"
                                    className="h-8 w-8"
                                    onClick={handleDownloadClick}
                                    disabled={addGameMutation.isPending}
                                    aria-label="Download game"
                                >
                                    {addGameMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Download className="w-4 h-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                        </Tooltip>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs hidden sm:flex"
                            onClick={handleStatusClick}
                        >
                            {game.status === "wanted" ? "Mark Owned" : game.status === "owned" ? "Mark Completed" : "Mark Wanted"}
                        </Button>
                    )}

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={handleDetailsClick}
                                aria-label="View details"
                            >
                                <Info className="w-4 h-4" />
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
                                    className="h-8 w-8"
                                    onClick={handleToggleHidden}
                                    aria-label={game.hidden ? "Unhide game" : "Hide game"}
                                >
                                    {game.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{game.hidden ? "Unhide" : "Hide"}</TooltipContent>
                        </Tooltip>
                    )}
                </div>
            </div>

            {detailsOpen && (
                <GameDetailsModal game={resolvedGame} open={detailsOpen} onOpenChange={setDetailsOpen} />
            )}

            {downloadOpen && (
                <GameDownloadDialog
                    game={resolvedGame}
                    open={downloadOpen}
                    onOpenChange={setDownloadOpen}
                />
            )}
        </>
    );
};

export default memo(CompactGameCard);
