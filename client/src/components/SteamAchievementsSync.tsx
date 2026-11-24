import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/setting-row";
import { ACHIEVEMENT_PROGRESS_KEY } from "@/hooks/use-achievement-progress";

export interface SteamAchievementsStatus {
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

const STATUS_KEY = ["/api/steam/achievements"];

function errorText(error: Error): string {
  return error instanceof ApiError
    ? error.message
    : "Could not complete the Steam achievements request. Try again.";
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Turn the Steam achievements sync on or off, see when it last ran and run it on demand. */
export function SteamAchievementsSync() {
  const queryClient = useQueryClient();

  const {
    data: status,
    error: statusError,
    refetch,
  } = useQuery<SteamAchievementsStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/steam/achievements")).json(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ACHIEVEMENT_PROGRESS_KEY });
  };

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await apiRequest("PUT", "/api/steam/achievements", { enabled })).json(),
    onSuccess: (next: SteamAchievementsStatus) => queryClient.setQueryData(STATUS_KEY, next),
  });

  const syncNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/steam/achievements/sync")).json(),
    onSuccess: refresh,
    onError: refresh,
  });

  const error = toggle.error ?? syncNow.error;

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="steam-achievements-title">
      <h3 id="steam-achievements-title" className="font-medium">
        Steam achievements
      </h3>
      <p className="text-sm text-muted-foreground">
        Keep the achievement progress of your owned and playing Steam games up to date. The
        percentage appears on game cards, and the Statistics page shows your completion rate and
        your rarest unlock. Requires a saved Steam ID, a Steam Web API key, and public Steam Game
        details.
      </p>

      <SettingRow
        id="steam-achievements-enabled"
        label="Sync Steam achievements"
        checked={status?.enabled ?? false}
        // An unavailable status only blocks turning the sync on; it can always be turned off.
        disabled={!status || toggle.isPending || (!status.available && !status.enabled)}
        onCheckedChange={(enabled) => toggle.mutate(enabled)}
      />

      {status && !status.available && (
        <p className="text-sm text-muted-foreground">
          Save your Steam ID above and add a Steam Web API key in the Steam card to use this.
        </p>
      )}

      {status?.enabled && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <output className="block text-sm" aria-label="Steam achievements sync status">
            {status.lastSyncAt
              ? `Last sync ${formatWhen(status.lastSyncAt)}: ${status.lastGamesSynced} game${
                  status.lastGamesSynced === 1 ? "" : "s"
                } checked, ${
                  status.lastNewUnlocks === 0
                    ? "no new unlocks"
                    : `${status.lastNewUnlocks} new unlock${status.lastNewUnlocks === 1 ? "" : "s"}`
                }.`
              : "Not synced yet. The first sync records your current progress."}
          </output>
          <p className="text-xs text-muted-foreground">Runs automatically every 12 hours.</p>
          {status.lastError && (
            <p role="alert" className="text-sm text-destructive">
              {status.lastError}
            </p>
          )}
          <Button variant="outline" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
            {syncNow.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      )}

      {statusError && !status && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the Steam achievements status.
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
    </section>
  );
}
