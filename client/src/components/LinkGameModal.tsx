import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import type { Game } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Gamepad2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface LinkGameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  downloadId: string;
  downloadTitle: string;
}

export default function LinkGameModal({
  open,
  onOpenChange,
  downloadId,
  downloadTitle,
}: Readonly<LinkGameModalProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const { data: games = [], isFetching } = useQuery<Game[]>({
    queryKey: ["/api/games", "link-search", debouncedSearchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchQuery.trim()) params.set("search", debouncedSearchQuery.trim());
      const response = await apiRequest("GET", `/api/games?${params}`);
      return response.json();
    },
    enabled: open,
  });

  const linkMutation = useMutation({
    mutationFn: async (gameId: string) => {
      await apiRequest("POST", `/api/imports/${downloadId}/link`, { gameId });
    },
    onSuccess: () => {
      toast({
        title: "Game Linked",
        description: "Continue by reviewing the import's source and destination paths.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/pending"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Link Game", description: error.message, variant: "destructive" });
    },
  });

  let resultsContent: ReactNode;
  if (isFetching && games.length === 0) {
    resultsContent = (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Searching…
      </div>
    );
  } else if (games.length === 0) {
    resultsContent = (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground px-4 text-center">
        No games found. Try a different search, or add the game to your library first.
      </div>
    );
  } else {
    resultsContent = (
      <div className="p-1">
        {games.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => setSelectedGameId(game.id)}
            className={cn(
              "flex items-center gap-3 w-full rounded-sm p-2 text-left hover:bg-accent transition-colors",
              selectedGameId === game.id && "bg-accent"
            )}
          >
            {game.coverUrl ? (
              <img
                src={game.coverUrl}
                alt=""
                className="h-10 w-8 rounded-sm object-cover shrink-0"
              />
            ) : (
              <div className="h-10 w-8 rounded-sm bg-muted flex items-center justify-center shrink-0">
                <Gamepad2 className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <span className="text-sm font-medium truncate">{game.title}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSearchQuery("");
          setSelectedGameId(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to a Game</DialogTitle>
          <DialogDescription>
            The game originally linked to <strong>{downloadTitle}</strong> could no longer be found.
            Select the correct game to continue importing this download.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="link-game-search">Search your library</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="link-game-search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  // A previously selected game may no longer be in the result
                  // list once the search changes — don't let a stale selection
                  // submit silently.
                  setSelectedGameId(null);
                }}
                placeholder="Search by title…"
                className="pl-8"
                autoFocus
              />
            </div>
          </div>

          <ScrollArea className="h-64 rounded-md border">{resultsContent}</ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selectedGameId || linkMutation.isPending}
            onClick={() => selectedGameId && linkMutation.mutate(selectedGameId)}
          >
            {linkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Link Game
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
