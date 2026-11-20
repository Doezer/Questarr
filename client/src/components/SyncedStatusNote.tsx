import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isUserCuratedGameStatus } from "@shared/schema";
import { PLAYNITE_SYNC_KEY, syncSourceLabel } from "./PlayniteSyncStatus";

interface SyncedStatusNoteProps {
  readonly gameId: string;
  readonly status: string;
  /** `games.statusSyncSource`: set only while a library sync wrote the current status. */
  readonly syncSource: string | null | undefined;
}

/**
 * Says a game's status came from a library sync and lets the user keep it as their own. A status
 * the user owns is never replaced by a later sync, so "Keep" is the manual override. Only the
 * statuses a person picks (playing, shelved, completed) are protected that way, so the button is
 * not offered for "owned".
 */
export function SyncedStatusNote({ gameId, status, syncSource }: SyncedStatusNoteProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const keep = useMutation({
    // Writing the same status without a sync source hands the status to the user.
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/games/${gameId}/status`, { status })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      void queryClient.invalidateQueries({ queryKey: PLAYNITE_SYNC_KEY });
      toast({ description: "Status kept. Syncs will not change it." });
    },
    onError: () => toast({ description: "Could not keep this status", variant: "destructive" }),
  });

  if (!syncSource) return null;
  const store = syncSourceLabel(syncSource);
  const canKeep = isUserCuratedGameStatus(status);

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <RefreshCw className="h-3 w-3" aria-hidden="true" />
      <span data-testid={`text-status-source-${gameId}`}>Synced from {store}</span>
      {canKeep && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          disabled={keep.isPending}
          onClick={() => keep.mutate()}
          aria-label={`Keep this status instead of the one synced from ${store}`}
        >
          Keep mine
        </Button>
      )}
    </span>
  );
}
