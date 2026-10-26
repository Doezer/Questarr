import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useFreshGames } from "@/hooks/use-fresh-games";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, Plus, X } from "lucide-react";

interface CollectionGamesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: string;
  collectionName: string;
  /** Ids of the games currently in the collection. */
  memberIds: ReadonlySet<string>;
}

/** Add games to a manual collection by picking from the library; members can also be removed. */
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
  const listRef = useRef<HTMLUListElement>(null);
  /** Row whose control just swapped (Add <-> Remove); focus moves to its replacement. */
  const focusGameId = useRef<string | null>(null);

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
    onSuccess: (_data, { gameId }) => {
      focusGameId.current = gameId;
      return queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update the collection",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const gameId = focusGameId.current;
    if (!gameId || toggleMutation.isPending) return;
    focusGameId.current = null;
    // Leave focus alone if the user moved on (e.g. to the search input) while the update ran.
    // Radix parks focus on the dialog container when the swapped button unmounts: not a user move.
    const active = document.activeElement;
    const dialog = listRef.current?.closest("[role='dialog']");
    if (
      active &&
      active !== document.body &&
      active !== dialog &&
      !listRef.current?.contains(active)
    )
      return;
    listRef.current?.querySelector<HTMLElement>(`[data-game-id="${gameId}"] button`)?.focus();
  }, [memberIds, toggleMutation.isPending]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add games to “{collectionName}”</DialogTitle>
          <DialogDescription>
            Pick games from your library. {memberIds.size}{" "}
            {memberIds.size === 1 ? "game is" : "games are"} already in this collection.
          </DialogDescription>
        </DialogHeader>

        <Input
          aria-label="Search your library"
          placeholder="Search your library…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <ul
          ref={listRef}
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
              <li
                key={game.id}
                data-game-id={game.id}
                className="flex items-center gap-3 rounded-md p-1.5"
              >
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
                {isMember ? (
                  <>
                    <span className="inline-flex h-10 min-w-24 items-center justify-center gap-1 rounded-md bg-secondary px-3 text-sm text-secondary-foreground sm:h-9">
                      <Check className="h-4 w-4" aria-hidden="true" /> Added
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 shrink-0 sm:h-9 sm:w-9"
                      disabled={toggleMutation.isPending}
                      aria-label={`Remove ${game.title}`}
                      onClick={() => toggleMutation.mutate({ gameId: game.id, add: false })}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 min-w-24 sm:h-9"
                    disabled={toggleMutation.isPending}
                    aria-label={`Add ${game.title}`}
                    onClick={() => toggleMutation.mutate({ gameId: game.id, add: true })}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button className="h-10 w-full sm:h-9 sm:w-auto" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
