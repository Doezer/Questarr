import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ReleaseBlacklist } from "@shared/schema";

type BlacklistEntry = ReleaseBlacklist & { gameTitle: string };

/**
 * Specific releases blacklisted from a game's download dialog, grouped by game.
 * Removing one takes effect immediately, unlike the term list it sits under.
 */
export default function BlacklistedReleasesList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: entries,
    isLoading,
    isError,
    refetch,
  } = useQuery<BlacklistEntry[]>({
    queryKey: ["/api/blacklist"],
  });

  const removeMutation = useMutation({
    mutationFn: async ({ gameId, id }: { gameId: string; id: string }) => {
      await apiRequest("DELETE", `/api/games/${gameId}/blacklist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blacklist"] });
      toast({ description: "Release removed from blacklist" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to remove from blacklist" });
    },
  });

  const entriesByGame = useMemo(() => {
    if (!entries) return {};
    return entries.reduce<Record<string, BlacklistEntry[]>>((acc, entry) => {
      (acc[entry.gameId] ??= []).push(entry);
      return acc;
    }, {});
  }, [entries]);

  const renderBody = () => {
    if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
    if (isError) {
      return (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>Could not load blacklisted releases.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      );
    }
    if (!entries || entries.length === 0) {
      return <div className="text-sm text-muted-foreground">No blacklisted releases.</div>;
    }
    return (
      <div className="space-y-4">
        {Object.entries(entriesByGame).map(([gameId, gameEntries]) => (
          <div key={gameId}>
            <h4 className="text-sm font-semibold mb-2">
              {gameEntries[0]?.gameTitle ?? "Unknown game"}
            </h4>
            <div className="space-y-2">
              {gameEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-snug break-words">
                      {entry.releaseTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.indexerName ? `${entry.indexerName} · ` : ""}
                      {entry.createdAt ? new Date(entry.createdAt).toISOString().split("T")[0] : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label={`Remove ${entry.releaseTitle} from blacklist`}
                    onClick={() => removeMutation.mutate({ gameId: entry.gameId, id: entry.id })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <section aria-labelledby="blacklisted-releases-heading" className="space-y-3">
      <div className="space-y-1">
        <h3 id="blacklisted-releases-heading" className="text-sm font-medium">
          Blacklisted Releases
        </h3>
        <p className="text-xs text-muted-foreground">
          Specific releases you blacklisted from a game&apos;s download results. Removing one takes
          effect immediately.
        </p>
      </div>
      {renderBody()}
    </section>
  );
}
