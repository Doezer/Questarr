import React, { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Eye, Trash2, ShieldAlert, BookMarked, CheckCircle2 } from "lucide-react";
import { type Game } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface DiscoverSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hiddenGames: Game[];
  hideOwned: boolean;
  onHideOwnedChange: (hide: boolean) => void;
  hideWanted: boolean;
  onHideWantedChange: (hide: boolean) => void;
}

export default function DiscoverSettingsModal({
  open,
  onOpenChange,
  hiddenGames,
  hideOwned,
  onHideOwnedChange,
  hideWanted,
  onHideWantedChange,
}: DiscoverSettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Unhide game mutation
  const unhideMutation = useMutation({
    mutationFn: async (gameId: string) => {
      const response = await apiRequest("PATCH", `/api/games/${gameId}/hidden`, { hidden: false });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ description: "Game unhidden" });
    },
    onError: () => {
      toast({
        description: "Failed to unhide game",
        variant: "destructive",
      });
    },
  });

  const handleUnhide = (gameId: string) => {
    unhideMutation.mutate(gameId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Discovery Settings</DialogTitle>
          <DialogDescription>
            Customize your discovery experience.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4 border-b">
          <div className="flex items-center justify-between space-x-2">
            <div className="flex flex-col space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Hide Owned Games
              </div>
              <span className="text-xs text-muted-foreground">
                Do not show games already in your "Owned" or "Completed" library.
              </span>
            </div>
            <Switch
              checked={hideOwned}
              onCheckedChange={onHideOwnedChange}
            />
          </div>

          <div className="flex items-center justify-between space-x-2">
            <div className="flex flex-col space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BookMarked className="w-4 h-4 text-primary" />
                Hide Wanted Games
              </div>
              <span className="text-xs text-muted-foreground">
                Do not show games already in your watchlist.
              </span>
            </div>
            <Switch
              checked={hideWanted}
              onCheckedChange={onHideWantedChange}
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col mt-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Hidden Games ({hiddenGames.length})
          </h3>
          
          <ScrollArea className="flex-1 border rounded-md p-2">
            {hiddenGames.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No manually hidden games.
              </div>
            ) : (
              <div className="space-y-2">
                {hiddenGames.map((game) => (
                  <div key={game.id} className="flex items-center justify-between bg-muted/30 p-2 rounded hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <img 
                        src={game.coverUrl || "/placeholder-game-cover.jpg"} 
                        alt={game.title} 
                        className="w-10 h-14 object-cover rounded"
                      />
                      <span className="font-medium truncate text-sm">{game.title}</span>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => handleUnhide(game.id)}
                      disabled={unhideMutation.isPending}
                    >
                      Unhide
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
