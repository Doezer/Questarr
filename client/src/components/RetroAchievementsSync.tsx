import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingRow } from "@/components/ui/setting-row";
import { ACHIEVEMENT_PROGRESS_KEY } from "@/hooks/use-achievement-progress";

export interface RetroAchievementsStatus {
  /** A username and Web API key are saved. */
  available: boolean;
  enabled: boolean;
  username: string | null;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

const STATUS_KEY = ["/api/retroachievements"];

function errorText(error: Error): string {
  return error instanceof ApiError
    ? error.message
    : "Could not complete the RetroAchievements request. Try again.";
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Save a RetroAchievements account, turn its achievement sync on or off and run it on demand. */
export function RetroAchievementsSync() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const {
    data: status,
    error: statusError,
    refetch,
  } = useQuery<RetroAchievementsStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/retroachievements")).json(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ACHIEVEMENT_PROGRESS_KEY });
  };
  const applyStatus = (next: RetroAchievementsStatus) => {
    queryClient.setQueryData(STATUS_KEY, next);
    void queryClient.invalidateQueries({ queryKey: ACHIEVEMENT_PROGRESS_KEY });
  };

  const saveAccount = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PUT", "/api/retroachievements/credentials", {
          username: (username ?? status?.username ?? "").trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      ).json(),
    onSuccess: (next: RetroAchievementsStatus) => {
      setUsername(null);
      setApiKey("");
      applyStatus(next);
    },
  });

  const removeAccount = useMutation({
    mutationFn: async () =>
      (await apiRequest("DELETE", "/api/retroachievements/credentials")).json(),
    onSuccess: (next: RetroAchievementsStatus) => {
      setUsername(null);
      setApiKey("");
      applyStatus(next);
    },
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await apiRequest("PUT", "/api/retroachievements", { enabled })).json(),
    onSuccess: (next: RetroAchievementsStatus) => queryClient.setQueryData(STATUS_KEY, next),
  });

  const syncNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/retroachievements/sync")).json(),
    onSuccess: refresh,
    onError: refresh,
  });

  const error = saveAccount.error ?? removeAccount.error ?? toggle.error ?? syncNow.error;
  const shownUsername = username ?? status?.username ?? "";
  const canSave =
    shownUsername.trim().length > 0 && (apiKey.trim().length > 0 || Boolean(status?.available));

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="retroachievements-title">
      <h3 id="retroachievements-title" className="font-medium">
        RetroAchievements
      </h3>
      <p className="text-sm text-muted-foreground">
        Track the achievement progress of your retro games (emulation and ROM libraries). A game is
        matched by its title and its console, so its platform must be set. Find your Web API key in
        your{" "}
        <a
          href="https://retroachievements.org/controlpanel.php"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          RetroAchievements settings
        </a>
        .
      </p>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) saveAccount.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="retroachievements-username">RetroAchievements username</Label>
          <Input
            id="retroachievements-username"
            autoComplete="off"
            value={shownUsername}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retroachievements-key">Web API key</Label>
          <Input
            id="retroachievements-key"
            type="password"
            autoComplete="off"
            placeholder={status?.available ? "Saved (leave empty to keep it)" : ""}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={!canSave || saveAccount.isPending}>
            {saveAccount.isPending ? "Checking…" : "Save account"}
          </Button>
          {status?.available && (
            <Button
              type="button"
              variant="outline"
              disabled={removeAccount.isPending}
              onClick={() => removeAccount.mutate()}
            >
              Remove account
            </Button>
          )}
        </div>
      </form>

      <SettingRow
        id="retroachievements-enabled"
        label="Sync RetroAchievements"
        checked={status?.enabled ?? false}
        // An unavailable status only blocks turning the sync on; it can always be turned off.
        disabled={!status || toggle.isPending || (!status.available && !status.enabled)}
        onCheckedChange={(enabled) => toggle.mutate(enabled)}
      />

      {status && !status.available && (
        <p className="text-sm text-muted-foreground">
          Save your username and Web API key above to use this.
        </p>
      )}

      {status?.enabled && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <output className="block text-sm" aria-label="RetroAchievements sync status">
            {status.lastSyncAt
              ? `Last sync ${formatWhen(status.lastSyncAt)}: ${status.lastGamesSynced} game${
                  status.lastGamesSynced === 1 ? "" : "s"
                } matched, ${
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
            Could not load the RetroAchievements status.
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
