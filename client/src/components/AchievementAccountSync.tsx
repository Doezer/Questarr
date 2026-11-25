import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingRow } from "@/components/ui/setting-row";
import { ACHIEVEMENT_PROGRESS_KEY } from "@/hooks/use-achievement-progress";

export interface AchievementAccountStatus {
  /** An account (and its secret) is saved. */
  available: boolean;
  enabled: boolean;
  username: string | null;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

export interface AchievementAccountSyncProps {
  /** Prefix of the element ids, e.g. "retroachievements". */
  idPrefix: string;
  /** Base path of the provider's API, e.g. "/api/retroachievements". */
  apiPath: string;
  /** Shown in texts, e.g. "RetroAchievements". */
  label: string;
  description: ReactNode;
  /** The provider asks for an account name next to the secret. */
  usernameLabel?: string;
  secretLabel: string;
  /** Name of the secret in the request body, e.g. "apiKey" or "npsso". */
  secretBodyKey: string;
  /** Shown while no account is saved, e.g. "Save your username and Web API key above to use this." */
  saveHint: string;
}

function errorText(error: Error, label: string): string {
  return error instanceof ApiError
    ? error.message
    : `Could not complete the ${label} request. Try again.`;
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Save an achievement account, turn its sync on or off and run it on demand. */
export function AchievementAccountSync({
  idPrefix,
  apiPath,
  label,
  description,
  usernameLabel,
  secretLabel,
  secretBodyKey,
  saveHint,
}: Readonly<AchievementAccountSyncProps>) {
  const STATUS_KEY = [apiPath];
  const queryClient = useQueryClient();
  const [username, setUsername] = useState<string | null>(null);
  const [secret, setSecret] = useState("");

  const {
    data: status,
    error: statusError,
    refetch,
  } = useQuery<AchievementAccountStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", apiPath)).json(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ACHIEVEMENT_PROGRESS_KEY });
  };
  const applyStatus = (next: AchievementAccountStatus) => {
    queryClient.setQueryData(STATUS_KEY, next);
    void queryClient.invalidateQueries({ queryKey: ACHIEVEMENT_PROGRESS_KEY });
  };

  const saveAccount = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PUT", `${apiPath}/credentials`, {
          ...(usernameLabel ? { username: (username ?? status?.username ?? "").trim() } : {}),
          ...(secret.trim() ? { [secretBodyKey]: secret.trim() } : {}),
        })
      ).json(),
    onSuccess: (next: AchievementAccountStatus) => {
      setUsername(null);
      setSecret("");
      applyStatus(next);
    },
  });

  const removeAccount = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `${apiPath}/credentials`)).json(),
    onSuccess: (next: AchievementAccountStatus) => {
      setUsername(null);
      setSecret("");
      applyStatus(next);
    },
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await apiRequest("PUT", apiPath, { enabled })).json(),
    onSuccess: (next: AchievementAccountStatus) => queryClient.setQueryData(STATUS_KEY, next),
  });

  const syncNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${apiPath}/sync`)).json(),
    onSuccess: refresh,
    onError: refresh,
  });

  const error = saveAccount.error ?? removeAccount.error ?? toggle.error ?? syncNow.error;
  // An error belongs to the action that failed: starting another one, or editing a field, clears it.
  const clearErrors = () => {
    // A request still running keeps its pending state: only settled ones are reset.
    for (const mutation of [saveAccount, removeAccount, toggle, syncNow]) {
      if (!mutation.isPending) mutation.reset();
    }
  };
  const shownUsername = username ?? status?.username ?? "";
  const canSave =
    (!usernameLabel || shownUsername.trim().length > 0) &&
    (secret.trim().length > 0 || Boolean(status?.available));

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby={`${idPrefix}-title`}>
      <h3 id={`${idPrefix}-title`} className="font-medium">
        {label}
      </h3>
      <p className="text-sm text-muted-foreground">{description}</p>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          clearErrors();
          saveAccount.mutate();
        }}
      >
        {usernameLabel && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-username`}>{usernameLabel}</Label>
            <Input
              id={`${idPrefix}-username`}
              autoComplete="off"
              value={shownUsername}
              onChange={(event) => {
                clearErrors();
                setUsername(event.target.value);
              }}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-key`}>{secretLabel}</Label>
          <Input
            id={`${idPrefix}-key`}
            type="password"
            autoComplete="off"
            placeholder={status?.available ? "Saved (leave empty to keep it)" : ""}
            value={secret}
            onChange={(event) => {
              clearErrors();
              setSecret(event.target.value);
            }}
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
              onClick={() => {
                clearErrors();
                removeAccount.mutate();
              }}
            >
              Remove account
            </Button>
          )}
        </div>
      </form>

      {!usernameLabel && status?.available && status.username && (
        <p className="text-sm text-muted-foreground">
          Connected account: <span className="font-medium">{status.username}</span>
        </p>
      )}

      <SettingRow
        id={`${idPrefix}-enabled`}
        label={`Sync ${label}`}
        checked={status?.enabled ?? false}
        // An unavailable status only blocks turning the sync on; it can always be turned off.
        disabled={!status || toggle.isPending || (!status.available && !status.enabled)}
        onCheckedChange={(enabled) => {
          clearErrors();
          toggle.mutate(enabled);
        }}
      />

      {status && !status.available && <p className="text-sm text-muted-foreground">{saveHint}</p>}

      {status?.enabled && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <output className="block text-sm" aria-label={`${label} sync status`}>
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
          <Button
            variant="outline"
            disabled={syncNow.isPending}
            onClick={() => {
              clearErrors();
              syncNow.mutate();
            }}
          >
            {syncNow.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      )}

      {statusError && !status && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the {label} status.
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error, label)}
        </p>
      )}
    </section>
  );
}
