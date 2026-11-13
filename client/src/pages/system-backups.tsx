import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  DatabaseBackup,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiRequest, throwIfResNotOk } from "@/lib/queryClient";
import { getSocket } from "@/lib/socket";

type BackupKind = "manual" | "scheduled" | "pre-restore";

interface BackupSummary {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: number;
  manifest: {
    appVersion: string;
    dialect: "sqlite" | "postgres";
    encryptionKeySource: "env" | "db";
    includesScreenshots: boolean;
  } | null;
}

interface BackupSettings {
  intervalDays: number;
  retentionDays: number;
  includeScreenshots: boolean;
}

interface BackupsResponse {
  backups: BackupSummary[];
  settings: BackupSettings;
  state: { running: boolean; lastError: string | null };
  environment: {
    dialect: "sqlite" | "postgres";
    encryptionKeySource: "env" | "db";
    jwtSecretSource: "env" | "db";
    restartsAutomatically: boolean;
  };
}

interface RestoreResult {
  staged: boolean;
  appVersion: string;
  restarting: boolean;
}

const QUERY_KEY = ["/api/system/backups"];

const KIND_LABEL: Record<BackupKind, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  "pre-restore": "Before restore",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export default function SystemBackupsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, isError, refetch } = useQuery<BackupsResponse>({
    queryKey: QUERY_KEY,
    refetchInterval: (query) => (query.state.data?.state.running ? 2000 : false),
  });

  const [interval, setIntervalDays] = useState("7");
  const [retention, setRetention] = useState("28");
  const [screenshots, setScreenshots] = useState(false);
  const savedSettings = data?.settings;
  useEffect(() => {
    if (!savedSettings) return;
    setIntervalDays(String(savedSettings.intervalDays));
    setRetention(String(savedSettings.retentionDays));
    setScreenshots(savedSettings.includeScreenshots);
  }, [savedSettings]);

  const [restoreTarget, setRestoreTarget] = useState<
    { kind: "stored"; backup: BackupSummary } | { kind: "upload"; file: File } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupSummary | null>(null);
  const [restoreDone, setRestoreDone] = useState<RestoreResult | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    socket.on("backup:finished", refresh);
    return () => {
      socket.off("backup:finished", refresh);
    };
  }, [queryClient]);

  const createBackup = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/system/backups");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: Error) =>
      toast({
        title: "Could not start the backup",
        description: error.message,
        variant: "destructive",
      }),
  });

  const saveSettings = useMutation({
    mutationFn: async (settings: BackupSettings) => {
      await apiRequest("PUT", "/api/system/backups/settings", settings);
    },
    onSuccess: () => {
      toast({ title: "Backup settings saved" });
      return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save settings",
        description: error.message,
        variant: "destructive",
      }),
  });

  const deleteBackup = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("DELETE", `/api/system/backups/${encodeURIComponent(name)}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: Error) =>
      toast({
        title: "Could not delete the backup",
        description: error.message,
        variant: "destructive",
      }),
  });

  const restore = useMutation({
    mutationFn: async (target: NonNullable<typeof restoreTarget>): Promise<RestoreResult> => {
      let res: Response;
      if (target.kind === "stored") {
        res = await apiFetch(
          `/api/system/backups/${encodeURIComponent(target.backup.name)}/restore`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: true }),
          }
        );
      } else {
        const form = new FormData();
        form.append("file", target.file);
        res = await apiFetch("/api/system/backups/restore", { method: "POST", body: form });
      }
      if (!res.ok) throw new Error(await errorMessage(res));
      return (await res.json()) as RestoreResult;
    },
    onSuccess: (result) => {
      setRestoreTarget(null);
      setRestoreDone(result);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      setRestoreTarget(null);
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
    },
  });

  const downloadBackup = async (backup: BackupSummary) => {
    try {
      const res = await apiFetch(`/api/system/backups/${encodeURIComponent(backup.name)}/download`);
      await throwIfResNotOk(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Could not download the backup",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const running = data?.state.running ?? false;
  const backups = data?.backups ?? [];
  const env = data?.environment;
  const intervalNum = Number(interval);
  const retentionNum = Number(retention);
  const settingsValid =
    Number.isInteger(intervalNum) &&
    intervalNum >= 0 &&
    intervalNum <= 365 &&
    Number.isInteger(retentionNum) &&
    retentionNum >= 1 &&
    retentionNum <= 3650;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Backups"
        description="Save your library and settings, and restore them on this or another install."
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              aria-label="Backup file to restore"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setRestoreTarget({ kind: "upload", file });
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="h-11 justify-center sm:h-9"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
              Restore from file
            </Button>
            <Button
              className="h-11 justify-center sm:h-9"
              disabled={running || createBackup.isPending}
              onClick={() => createBackup.mutate()}
            >
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <DatabaseBackup className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {running ? "Backing up…" : "Back up now"}
            </Button>
          </>
        }
      />

      {isError && !data && (
        <div className="mb-4 flex items-center gap-3 text-sm text-destructive">
          <span>Could not load the backups.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {restoreDone && (
        <Alert className="mb-4 border-emerald-700/50" role="status">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Restore ready</AlertTitle>
          <AlertDescription>
            {restoreDone.restarting
              ? "Questarr is restarting to apply the backup. If it does not come back in a minute, start it again."
              : "Restart Questarr to apply the backup. Nothing changes until you do."}
          </AlertDescription>
        </Alert>
      )}

      {data?.state.lastError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>The last backup failed</AlertTitle>
          <AlertDescription className="break-words">{data.state.lastError}</AlertDescription>
        </Alert>
      )}

      <Alert className="mb-4 border-amber-700/50">
        <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
        <AlertTitle>Keep backups private</AlertTitle>
        <AlertDescription>
          A backup holds your password hashes and sign-in secrets, which is as good as full access
          to Questarr. Store it somewhere only you can reach.
          {env?.encryptionKeySource === "env" && (
            <>
              {" "}
              Your credential encryption key comes from the <code>
                CREDENTIALS_ENCRYPTION_KEY
              </code>{" "}
              environment variable and is <strong>not</strong> in the backup: keep it, or restored
              indexer and downloader passwords will not decrypt.
            </>
          )}
          {env?.jwtSecretSource === "env" && (
            <>
              {" "}
              Your <code>JWT_SECRET</code> is also set in the environment and is not included.
            </>
          )}
        </AlertDescription>
      </Alert>

      <section
        aria-labelledby="backup-settings-heading"
        className="mb-6 rounded-lg border border-[#374151]/40 bg-card p-4"
      >
        <h2 id="backup-settings-heading" className="mb-3 text-base font-semibold">
          Schedule
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="backup-interval">Back up every (days)</Label>
            <Input
              id="backup-interval"
              inputMode="numeric"
              className="h-11 sm:h-10"
              value={interval}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">0 turns scheduled backups off.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backup-retention">Keep scheduled backups (days)</Label>
            <Input
              id="backup-retention"
              inputMode="numeric"
              className="h-11 sm:h-10"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Manual and before-restore backups are never deleted automatically.
            </p>
          </div>
          <div className="flex items-start gap-3 pt-6">
            <Switch
              id="backup-screenshots"
              checked={screenshots}
              onCheckedChange={setScreenshots}
              aria-label="Include journal screenshots"
            />
            <Label htmlFor="backup-screenshots" className="leading-snug">
              Include journal screenshots
              <span className="block text-xs font-normal text-muted-foreground">
                Can make backups much larger.
              </span>
            </Label>
          </div>
        </div>
        <Button
          className="mt-4 h-11 w-full sm:h-9 sm:w-auto"
          disabled={!settingsValid || saveSettings.isPending}
          onClick={() =>
            saveSettings.mutate({
              intervalDays: intervalNum,
              retentionDays: retentionNum,
              includeScreenshots: screenshots,
            })
          }
        >
          Save schedule
        </Button>
      </section>

      <h2 className="mb-3 text-base font-semibold">Saved backups</h2>
      {backups.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center text-slate-500">
          <Archive className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="text-sm">No backup yet</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Saved backups">
          {backups.map((b) => (
            <li
              key={b.name}
              className="flex flex-col gap-3 rounded-lg border border-[#374151]/40 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`backup-${b.name}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{formatDate(b.createdAt)}</span>
                  <Badge variant="outline">{KIND_LABEL[b.kind]}</Badge>
                  {!b.manifest && (
                    <Badge className="border-red-700/50 bg-red-900/40 text-red-400">
                      Unreadable
                    </Badge>
                  )}
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {formatSize(b.size)}
                  {b.manifest && ` · Questarr ${b.manifest.appVersion}`}
                  {b.manifest?.includesScreenshots && " · with screenshots"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="h-11 flex-1 sm:h-9 sm:flex-none"
                  onClick={() => downloadBackup(b)}
                  aria-label={`Download backup from ${formatDate(b.createdAt)}`}
                >
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Download
                </Button>
                <Button
                  variant="secondary"
                  className="h-11 flex-1 sm:h-9 sm:flex-none"
                  disabled={!b.manifest}
                  onClick={() => setRestoreTarget({ kind: "stored", backup: b })}
                  aria-label={`Restore backup from ${formatDate(b.createdAt)}`}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Restore
                </Button>
                <Button
                  variant="outline"
                  className="h-11 w-11 p-0 sm:h-9 sm:w-9"
                  onClick={() => setDeleteTarget(b)}
                  aria-label={`Delete backup from ${formatDate(b.createdAt)}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={restoreTarget !== null} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything in your library and settings is replaced by the backup, and sign-ins may
              stop working. A backup of the current state is saved first, and the restore is applied
              when Questarr restarts.
              {env && !env.restartsAutomatically && " You will need to restart it yourself."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (restoreTarget) restore.mutate(restoreTarget);
              }}
            >
              {restore.isPending ? "Checking the backup…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is removed from the server and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteBackup.mutate(deleteTarget.name);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
