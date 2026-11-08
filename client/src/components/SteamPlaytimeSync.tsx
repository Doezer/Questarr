import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatMinutes } from "@/lib/play-time";

export interface SteamPlaytimeStatus {
  available: boolean;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSessionsAdded: number;
  lastMinutesAdded: number;
  lastError: string | null;
}

const STATUS_KEY = ["/api/steam/playtime"];

/** Show sanitized API messages while keeping transport errors out of the interface. */
function errorText(error: Error): string {
  return error instanceof ApiError
    ? error.message
    : "Could not complete the Steam play-time request. Try again.";
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Turn the Steam play-time sync on or off, see when it last ran and run it on demand. */
export function SteamPlaytimeSync() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery<SteamPlaytimeStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/steam/playtime")).json(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["/api/stats/play-time"] });
  };

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await apiRequest("PUT", "/api/steam/playtime", { enabled })).json(),
    onSuccess: (next: SteamPlaytimeStatus) => queryClient.setQueryData(STATUS_KEY, next),
  });

  const syncNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/steam/playtime/sync")).json(),
    onSuccess: refresh,
    // A failed run stores its message in the status, so reload it to show the reason.
    onError: refresh,
  });

  const error = toggle.error ?? syncNow.error;
  const result = syncNow.data as
    { result: { sessionsAdded: number; minutesAdded: number } } | undefined;

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="steam-playtime-title">
      <h3 id="steam-playtime-title" className="font-medium">
        Steam play time
      </h3>
      <p className="text-sm text-muted-foreground">
        Record the time you play on Steam in your play-time statistics. Steam only reports a running
        total per game, so each sync adds the difference as one estimated session. The first sync
        only notes your current totals; nothing from before is imported.
      </p>
      <p className="text-xs text-muted-foreground">
        Estimated sessions count in your totals but not in the longest session or the streaks. Time
        you already entered by hand, with the timer or from Playnite is not counted twice. Requires
        a saved Steam ID, STEAM_API_KEY on the server, and public Steam Game details.
      </p>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="steam-playtime-enabled" className="text-sm font-medium">
          Sync Steam play time
        </Label>
        <Switch
          id="steam-playtime-enabled"
          checked={status?.enabled ?? false}
          disabled={!status?.available || toggle.isPending}
          onCheckedChange={(enabled) => toggle.mutate(enabled)}
        />
      </div>

      {status && !status.available && (
        <p className="text-sm text-muted-foreground">
          Save your Steam ID above and set STEAM_API_KEY on the server to use this.
        </p>
      )}

      {status?.enabled && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <output className="block text-sm" aria-label="Steam play-time sync status">
            {status.lastSyncAt
              ? `Last sync ${formatWhen(status.lastSyncAt)}: ${
                  status.lastSessionsAdded === 0
                    ? "nothing new"
                    : `${status.lastSessionsAdded} session${
                        status.lastSessionsAdded === 1 ? "" : "s"
                      }, ${formatMinutes(status.lastMinutesAdded)}`
                }.`
              : "Not synced yet. The first sync records your current totals."}
          </output>
          <p className="text-xs text-muted-foreground">Runs automatically every 6 hours.</p>
          {status.lastError && (
            <p role="alert" className="text-sm text-destructive">
              {status.lastError}
            </p>
          )}
          <Button variant="outline" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
            {syncNow.isPending ? "Syncing…" : "Sync now"}
          </Button>
          {result && !syncNow.isPending && !syncNow.error && (
            <p className="text-xs text-muted-foreground">
              {result.result.sessionsAdded === 0
                ? "No new play time found."
                : `Added ${result.result.sessionsAdded} estimated session${
                    result.result.sessionsAdded === 1 ? "" : "s"
                  }.`}
            </p>
          )}
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
