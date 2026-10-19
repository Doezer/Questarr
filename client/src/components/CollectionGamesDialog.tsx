import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useFreshGames } from "@/hooks/use-fresh-games";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, Plus } from "lucide-react";

interface CollectionGamesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: string;
  collectionName: string;
  /** Ids of the games currently in the collection. */
  memberIds: ReadonlySet<string>;
}

/** Add games to, or remove them from, a manual collection by picking from the library. */
export default function CollectionGamesDialog({
  open,
  onOpenChange,
  collectionId,
  collectionName,
  memberIds,
}: Readonly<CollectionGamesDialogProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { games, isLoading, isError, retry } = useFreshGames(open);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return games
      .filter((game) => !query || game.title.toLowerCase().includes(query))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [games, search]);

  const toggleMutation = useMutation({
    mutationFn: async ({ gameId, add }: { gameId: string; add: boolean }) => {
      if (add) {
        await apiRequest("POST", `/api/collections/${collectionId}/games`, { gameId });
      } else {
        await apiRequest("DELETE", `/api/collections/${collectionId}/games/${gameId}`);
      }
    },
    // Returned so the mutation stays pending until membership is refetched (no duplicate click).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/collections"] }),
    onError: (error: Error) => {
      toast({
        title: "Could not update the collection",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Games in “{collectionName}”</DialogTitle>
          <DialogDescription>Pick games from your library to add or remove.</DialogDescription>
        </DialogHeader>

        <Input
          aria-label="Search your library"
          placeholder="Search your library…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <ul
          className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1"
          aria-label="Library games"
        >
          {isLoading && (
            <li className="py-6 text-center text-sm text-muted-foreground">Loading games…</li>
          )}
          {isError && (
            <li className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
              Could not load your library.
              <Button size="sm" variant="outline" onClick={retry}>
                Retry
              </Button>
            </li>
          )}
          {!isLoading && !isError && visible.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">No games found.</li>
          )}
          {visible.map((game) => {
            const isMember = memberIds.has(game.id);
            return (
              <li key={game.id} className="flex items-center gap-3 rounded-md p-1.5">
                {game.coverUrl ? (
                  <img
                    src={game.coverUrl}
                    alt=""
                    loading="lazy"
                    className="h-12 w-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-9 shrink-0 rounded bg-muted" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{game.title}</span>
                <Button
                  size="sm"
                  variant={isMember ? "secondary" : "outline"}
                  className="h-10 min-w-24 sm:h-9"
                  disabled={toggleMutation.isPending}
                  aria-label={`${isMember ? "Remove" : "Add"} ${game.title}`}
                  onClick={() => toggleMutation.mutate({ gameId: game.id, add: !isMember })}
                >
                  {isMember ? (
                    <>
                      <Check className="mr-1 h-4 w-4" aria-hidden="true" /> Added
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
