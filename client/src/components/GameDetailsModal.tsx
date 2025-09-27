import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar, Star, Monitor, Gamepad2, Tag, Download, Play, CheckCircle, Eye, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";
import StatusBadge, { type GameStatus } from "./StatusBadge";

interface GameDetailsModalProps {
  game: Game | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange?: (gameId: string, newStatus: GameStatus) => void;
}

export default function GameDetailsModal({ 
  game, 
  open, 
  onOpenChange,
  onStatusChange 
}: GameDetailsModalProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const removeGameMutation = useMutation({
    mutationFn: async (gameId: string) => {
      const response = await fetch(`/api/games/${gameId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to remove game');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/games'] });
      toast({ description: "Game removed from collection" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ description: "Failed to remove game", variant: "destructive" });
    }
  });

  if (!game) return null;

  const handleStatusChange = (newStatus: GameStatus) => {
    onStatusChange?.(game.id, newStatus);
  };

  const handleRemoveGame = () => {
    removeGameMutation.mutate(game.id);
  };

  const statusActions = [
    { status: "wanted" as const, icon: Eye, label: "Want to Play", variant: "outline" as const },
    { status: "owned" as const, icon: Download, label: "Mark as Owned", variant: "default" as const },
    { status: "downloading" as const, icon: Download, label: "Downloading", variant: "secondary" as const },
    { status: "completed" as const, icon: CheckCircle, label: "Mark Completed", variant: "default" as const },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0 pb-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-2xl font-bold mb-2 leading-tight" data-testid={`text-game-title-${game.id}`}>
                  {game.title}
                </DialogTitle>
                <div className="flex items-center gap-2 mb-2">
                  <StatusBadge status={game.status} />
                  {game.rating && (
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-4 h-4 text-accent" />
                      <span data-testid={`text-rating-${game.id}`}>
                        {game.rating}/10
                      </span>
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
              </div>
              
              {game.coverUrl && (
                <div className="flex-shrink-0">
                  <img
                    src={game.coverUrl}
                    alt={`${game.title} cover`}
                    className="w-32 h-48 object-cover rounded-lg shadow-md"
                    data-testid={`img-cover-${game.id}`}
                  />
                </div>
              )}
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 mt-4">
            <div className="space-y-6 pr-4">
              {/* Summary */}
              {game.summary && (
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4" />
                    About
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-summary-${game.id}`}>
                    {game.summary}
                  </p>
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
                        <Badge key={index} variant="secondary" data-testid={`badge-genre-${genre.toLowerCase().replace(/\s+/g, '-')}`}>
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
                        <Badge key={index} variant="outline" data-testid={`badge-platform-${platform.toLowerCase().replace(/\s+/g, '-')}`}>
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

              <Separator />

              {/* Status Actions */}
              <div>
                <h3 className="font-semibold mb-3">Manage Status</h3>
                <div className="flex flex-wrap gap-2">
                  {statusActions.map((action) => (
                    <Button
                      key={action.status}
                      variant={game.status === action.status ? "default" : action.variant}
                      size="sm"
                      onClick={() => handleStatusChange(action.status)}
                      disabled={game.status === action.status}
                      className="gap-2"
                      data-testid={`button-status-${action.status}`}
                    >
                      <action.icon className="w-4 h-4" />
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Remove Game */}
              <div>
                <h3 className="font-semibold mb-2 text-destructive">Danger Zone</h3>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRemoveGame}
                  disabled={removeGameMutation.isPending}
                  className="gap-2"
                  data-testid={`button-remove-game-${game.id}`}
                >
                  <X className="w-4 h-4" />
                  {removeGameMutation.isPending ? "Removing..." : "Remove from Collection"}
                </Button>
              </div>
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
    </>
  );
}