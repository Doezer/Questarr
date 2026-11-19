import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/setting-row";
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
const PREVIEW_KEY = ["/api/steam/playtime/import/preview"];

interface ImportCandidate {
  gameId: string;
  title: string;
  steamMinutes: number;
  recordedMinutes: number;
  importMinutes: number;
  lastPlayedAt: string | null;
}

interface ImportPreview {
  candidates: ImportCandidate[];
  skipped: number;
}

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
    // Per-game panels keep their sessions cached; the sync may have added one to any game.
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return (
          typeof first === "string" &&
          first.startsWith("/api/games/") &&
          first.endsWith("/play-sessions")
        );
      },
    });
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

  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const preview = useQuery<ImportPreview>({
    queryKey: PREVIEW_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/steam/playtime/import/preview")).json(),
    // Only when asked for: it reads the whole Steam library.
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  const candidates = preview.data?.candidates ?? [];
  const selected = candidates.filter((c) => !excluded.has(c.gameId));
  const selectedMinutes = selected.reduce((sum, c) => sum + c.importMinutes, 0);

  const runImport = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/steam/playtime/import", {
          gameIds: selected.map((c) => c.gameId),
        })
      ).json() as Promise<{ sessionsAdded: number; minutesAdded: number }>,
    onSuccess: () => {
      setExcluded(new Set());
      queryClient.removeQueries({ queryKey: PREVIEW_KEY });
      refresh();
    },
  });

  const toggleGame = (gameId: string, checked: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(gameId);
      else next.add(gameId);
      return next;
    });

  const error = toggle.error ?? syncNow.error ?? runImport.error ?? preview.error;
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
        only notes your current totals; use the import below to bring in earlier hours.
      </p>
      <p className="text-xs text-muted-foreground">
        Estimated sessions count in your totals but not in the longest session or the streaks. Time
        you already entered by hand, with the timer or from Playnite is not counted twice. Requires
        a saved Steam ID, a Steam Web API key, and public Steam Game details.
      </p>

      <SettingRow
        id="steam-playtime-enabled"
        label="Sync Steam play time"
        checked={status?.enabled ?? false}
        disabled={!status?.available || toggle.isPending}
        onCheckedChange={(enabled) => toggle.mutate(enabled)}
      />

      {status && !status.available && (
        <p className="text-sm text-muted-foreground">
          Save your Steam ID above and add a Steam Web API key in the Steam card to use this.
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

      {status?.available && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4" data-testid="steam-import">
          <h4 className="text-sm font-medium">Import play time from before tracking</h4>
          <p className="text-xs text-muted-foreground">
            Steam already holds your total hours per game. Preview what is missing from Questarr,
            pick the games, and each one becomes one estimated session ending on the day you last
            played it. Time already recorded is subtracted, and a game is imported only once.
          </p>
          <Button
            variant="outline"
            disabled={preview.isFetching || runImport.isPending}
            onClick={() => {
              setExcluded(new Set());
              runImport.reset();
              void preview.refetch();
            }}
          >
            {preview.isFetching ? "Reading Steam…" : "Preview import"}
          </Button>
          {preview.isSuccess && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing to import: your recorded play time already matches Steam.
            </p>
          )}
          {candidates.length > 0 && (
            <>
              <ul
                className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border bg-background"
                aria-label="Games to import"
              >
                {candidates.map((c) => (
                  <li key={c.gameId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      id={`steam-import-${c.gameId}`}
                      className="h-4 w-4 shrink-0"
                      checked={!excluded.has(c.gameId)}
                      onChange={(e) => toggleGame(c.gameId, e.target.checked)}
                    />
                    <label htmlFor={`steam-import-${c.gameId}`} className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        Steam {formatMinutes(c.steamMinutes)}
                        {c.recordedMinutes > 0
                          ? ` · already ${formatMinutes(c.recordedMinutes)}`
                          : ""}
                        {c.lastPlayedAt
                          ? ` · last played ${new Date(c.lastPlayedAt).toLocaleDateString()}`
                          : ""}
                      </span>
                    </label>
                    <span className="shrink-0 tabular-nums">+{formatMinutes(c.importMinutes)}</span>
                  </li>
                ))}
              </ul>
              <Button
                disabled={selected.length === 0 || runImport.isPending}
                onClick={() => runImport.mutate()}
              >
                {runImport.isPending
                  ? "Importing…"
                  : `Import ${selected.length} game${selected.length === 1 ? "" : "s"} (${formatMinutes(selectedMinutes)})`}
              </Button>
            </>
          )}
          {runImport.isSuccess && (
            <p className="text-xs text-muted-foreground" role="status">
              Imported {runImport.data.sessionsAdded} session
              {runImport.data.sessionsAdded === 1 ? "" : "s"} (
              {formatMinutes(runImport.data.minutesAdded)}).
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
