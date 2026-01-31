import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Star, Monitor, Gamepad2, Tag, Download, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";
import StatusBadge from "./StatusBadge";
import GameDownloadDialog from "./GameDownloadDialog";

interface GameDetailsModalProps {
  game: Game | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GameDetailsModal({ game, open, onOpenChange }: GameDetailsModalProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const removeGameMutation = useMutation({
    mutationFn: async (gameId: string) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/games/${gameId}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) throw new Error("Failed to remove game");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: "Game removed from collection" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ description: "Failed to remove game", variant: "destructive" });
    },
  });

  if (!game) return null;

  const handleRemoveGame = () => {
    removeGameMutation.mutate(game.id);
  };

  const handleDownloadClick = () => {
    setDownloadOpen(true);
  };

  const SUMMARY_LIMIT = 280;
  const isSummaryLong = game.summary && game.summary.length > SUMMARY_LIMIT;
  const displaySummary =
    isSummaryLong && !isSummaryExpanded
      ? `${game.summary?.slice(0, SUMMARY_LIMIT)}...`
      : game.summary;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0 pb-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <DialogTitle
                  className="text-2xl font-bold mb-2 leading-tight"
                  data-testid={`text-game-title-${game.id}`}
                >
                  {game.title}
                </DialogTitle>
                <div className="flex items-center gap-2 mb-3">
                  <StatusBadge status={game.status} />
                  {game.rating && (
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-4 h-4 text-accent" />
                      <span data-testid={`text-rating-${game.id}`}>{game.rating}/10</span>
                    </div>
                  )}
                  {game.releaseDate && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span data-testid={`text-release-date-${game.id}`}>
                        {new Date(game.releaseDate).getFullYear()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Summary */}
                {game.summary && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Gamepad2 className="w-4 h-4" />
                      About
                    </h3>
                    <p
                      className="text-sm text-muted-foreground leading-relaxed"
                      data-testid={`text-summary-${game.id}`}
                    >
                      {displaySummary}
                      {isSummaryLong && (
                        <Button
                          variant="link"
                          className="p-0 h-auto ml-1 font-semibold"
                          onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                        >
                          {isSummaryExpanded ? "Show less" : "Read more"}
                        </Button>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {game.coverUrl && (
                <div className="flex-shrink-0">
                  <img
                    src={game.coverUrl}
                    alt={`${game.title} cover`}
                    className="w-32 object-cover rounded-lg shadow-md"
                    style={{ aspectRatio: "3/4" }}
                    data-testid={`img-cover-${game.id}`}
                  />
                </div>
              )}
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 mt-4">
            <div className="space-y-6 pr-4">
              {/* Quick Actions */}
              <div>
                <h3 className="font-semibold mb-3">Quick Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleDownloadClick}
                    data-testid="button-download-game"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemoveGame}
                    disabled={removeGameMutation.isPending}
                    className="gap-2"
                    data-testid={`button-remove-game-quick-${game.id}`}
                  >
                    <X className="w-4 h-4" />
                    {removeGameMutation.isPending ? "Removing..." : "Remove"}
                  </Button>
                </div>
              </div>

              {/* Extended Metadata */}
              {(game.releaseDate || game.rating) && (
                <div className="grid md:grid-cols-2 gap-6">
                  {game.releaseDate && (
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground mb-1">
                        Release Date
                      </h4>
                      <p className="text-sm" data-testid={`text-full-release-date-${game.id}`}>
                        {new Date(game.releaseDate).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  {game.rating && (
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground mb-1">Rating</h4>
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-accent fill-current" />
                        <span className="text-sm font-medium">{game.rating}/10</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Genres and Platforms */}
              <div className="grid md:grid-cols-2 gap-6">
                {game.genres && game.genres.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Tag className="w-4 h-4" />
                      Genres
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {game.genres.map((genre, index) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          data-testid={`badge-genre-${genre.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {genre}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {game.platforms && game.platforms.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Monitor className="w-4 h-4" />
                      Platforms
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {game.platforms.map((platform, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          data-testid={`badge-platform-${platform.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {platform}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Screenshots */}
              {game.screenshots && game.screenshots.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3">Screenshots</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {game.screenshots.slice(0, 6).map((screenshot, index) => (
                      <Card
                        key={index}
                        className="overflow-hidden cursor-pointer hover-elevate"
                        onClick={() => setSelectedScreenshot(screenshot)}
                        data-testid={`screenshot-${index}`}
                      >
                        <CardContent className="p-0">
                          <img
                            src={screenshot}
                            alt={`${game.title} screenshot ${index + 1}`}
                            className="w-full h-24 object-cover"
                          />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Screenshot Lightbox */}
      {selectedScreenshot && (
        <Dialog open={!!selectedScreenshot} onOpenChange={() => setSelectedScreenshot(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Screenshot</DialogTitle>
            </DialogHeader>
            <div className="flex justify-center">
              <img
                src={selectedScreenshot}
                alt={`${game.title} screenshot`}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                data-testid="screenshot-lightbox"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      <GameDownloadDialog game={game} open={downloadOpen} onOpenChange={setDownloadOpen} />
    </>
  );
}
