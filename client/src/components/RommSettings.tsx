import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/setting-row";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface RommSettingsView {
  enabled: boolean;
  url: string;
  apiToken: string;
  platformFolders: boolean;
  syncEnabled: boolean;
  scanAfterImport: boolean;
  lastSync: string | null;
}

interface SyncSummary {
  totalRoms: number;
  matched: number;
  alreadyOwned: number;
  markedOwned: number;
  notInLibrary: number;
}

const REPAIR_BATCH_SIZE = 500;

interface RepairProposal {
  gameId: string;
  title: string;
  from: string;
  to: string;
  currentFolder: string;
  expectedFolder: string;
  destinationExists: boolean;
}

interface RepairOutcome {
  gameId: string;
  title: string;
  moved: boolean;
  error?: string;
}

const EMPTY: RommSettingsView = {
  enabled: false,
  url: "",
  apiToken: "",
  platformFolders: false,
  syncEnabled: false,
  scanAfterImport: true,
  lastSync: null,
};

async function errorMessage(error: unknown): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  // apiRequest throws "<status>: <body>"; the body is JSON with an `error` field.
  const body = message.replace(/^\d+:\s*/, "");
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error ?? body;
  } catch {
    return body;
  }
}

export function RommSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<RommSettingsView>({ queryKey: ["/api/settings/romm"] });
  const [form, setForm] = useState<RommSettingsView>(EMPTY);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [proposals, setProposals] = useState<RepairProposal[] | null>(null);
  const [failures, setFailures] = useState<RepairOutcome[]>([]);

  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data });
  }, [data]);

  const save = useMutation({
    mutationFn: async (values: RommSettingsView) => {
      const { lastSync: _lastSync, ...rest } = values;
      await apiRequest("POST", "/api/settings/romm", rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/romm"] });
      toast({ title: "RomM settings saved" });
    },
    onError: async (error) =>
      toast({
        title: "Could not save RomM settings",
        description: await errorMessage(error),
        variant: "destructive",
      }),
  });

  const test = useMutation({
    mutationFn: async () => {
      // Test what is on screen without saving it.
      const res = await apiRequest("POST", "/api/settings/romm/test", {
        url: form.url,
        apiToken: form.apiToken,
      });
      return (await res.json()) as { platforms: number };
    },
    onSuccess: (result) =>
      toast({
        title: "RomM reachable",
        description: `Connected. RomM reports ${result.platforms} platform(s).`,
      }),
    onError: async (error) =>
      toast({
        title: "RomM connection failed",
        description: await errorMessage(error),
        variant: "destructive",
      }),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/romm/sync");
      return (await res.json()) as { summary: SyncSummary };
    },
    onSuccess: (result) => {
      setSummary(result.summary);
      queryClient.invalidateQueries({ queryKey: ["/api/settings/romm"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: async (error) =>
      toast({
        title: "RomM sync failed",
        description: await errorMessage(error),
        variant: "destructive",
      }),
  });

  const scanFolders = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/settings/romm/folder-repair");
      return (await res.json()) as { proposals: RepairProposal[] };
    },
    onSuccess: (result) => {
      setProposals(result.proposals);
      setFailures([]);
    },
    onError: async (error) =>
      toast({
        title: "Could not scan the library",
        description: await errorMessage(error),
        variant: "destructive",
      }),
  });

  const repairFolders = useMutation({
    mutationFn: async (toMove: RepairProposal[]) => {
      const gameIds = toMove.map((p) => p.gameId);
      const titleOf = new Map(toMove.map((p) => [p.gameId, p.title]));
      // The server takes at most 500 games per call. If a later call fails, what the earlier
      // ones moved is kept and the games that were not reached are reported as failures.
      const results: RepairOutcome[] = [];
      for (let i = 0; i < gameIds.length; i += REPAIR_BATCH_SIZE) {
        try {
          const res = await apiRequest("POST", "/api/settings/romm/folder-repair", {
            gameIds: gameIds.slice(i, i + REPAIR_BATCH_SIZE),
          });
          results.push(...((await res.json()) as { results: RepairOutcome[] }).results);
        } catch (error) {
          if (i === 0) throw error;
          const message = await errorMessage(error);
          for (const gameId of gameIds.slice(i)) {
            results.push({
              gameId,
              title: titleOf.get(gameId) ?? gameId,
              moved: false,
              error: message,
            });
          }
          break;
        }
      }
      return { results };
    },
    onSuccess: (result) => {
      const moved = result.results.filter((r) => r.moved).length;
      const failed = result.results.filter((r) => !r.moved);
      setFailures(failed);
      setProposals((current) =>
        (current ?? []).filter((p) => failed.some((f) => f.gameId === p.gameId))
      );
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({
        title: `${moved} game(s) moved`,
        description: failed.length > 0 ? `${failed.length} could not be moved.` : undefined,
      });
    },
    onError: async (error) =>
      toast({
        title: "Could not move the games",
        description: await errorMessage(error),
        variant: "destructive",
      }),
  });

  if (isLoading) return null;

  const insecure = /^http:\/\//i.test(form.url);
  const set = <K extends keyof RommSettingsView>(key: K, value: RommSettingsView[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            RomM
          </p>
          <p className="text-xs text-muted-foreground">
            Retro and console games imported by Questarr can land where{" "}
            <a
              href="https://romm.app"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              RomM
            </a>{" "}
            looks for them, and Questarr can read your RomM library to mark games as owned.
          </p>
        </div>

        <SettingRow
          id="romm-platform-folders"
          label="RomM platform folders"
          description={
            <>
              Place imports in <code>&lt;library root&gt;/&lt;platform&gt;/</code> using RomM folder
              names (<code>snes</code>, <code>ps2</code>, <code>win</code>…). Point the library root
              at RomM&apos;s <code>roms</code> folder. Works without the API below.
            </>
          }
          checked={form.platformFolders}
          onCheckedChange={(value) => set("platformFolders", value)}
        />

        <SettingRow
          id="romm-enabled"
          label="Connect to the RomM API"
          description={<>Needed to read your RomM library and to trigger a rescan after imports.</>}
          checked={form.enabled}
          onCheckedChange={(value) => set("enabled", value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="romm-url">RomM URL</Label>
            <Input
              id="romm-url"
              placeholder="https://romm.example.com"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="romm-token">API token</Label>
            <Input
              id="romm-token"
              type="password"
              autoComplete="off"
              placeholder="rmm_…"
              value={form.apiToken}
              onChange={(e) => set("apiToken", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Create one in RomM under Profile → Client API Tokens (read access to platforms and
              ROMs, plus permission to run tasks for the rescan).
            </p>
          </div>
        </div>
        {insecure && (
          <p className="text-xs text-amber-500" role="alert">
            This URL uses http://, so the API token travels unencrypted. Prefer https:// unless RomM
            is on a network you trust.
          </p>
        )}

        <SettingRow
          id="romm-scan"
          label="Rescan RomM after an import"
          description={<>A RomM outage never fails or delays an import.</>}
          checked={form.scanAfterImport}
          onCheckedChange={(value) => set("scanAfterImport", value)}
        />

        <SettingRow
          id="romm-sync"
          label="Mark games found in RomM as owned"
          description={
            <>
              Every 6 hours, games in your wishlist that RomM already has become owned. Games are
              matched by IGDB id, then by title. Nothing is created, and playing, shelved or
              completed games are left alone.
            </>
          }
          checked={form.syncEnabled}
          onCheckedChange={(value) => set("syncEnabled", value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />}
            Save RomM settings
          </Button>
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending || !form.url || !form.apiToken}
          >
            {test.isPending && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />}
            Test connection
          </Button>
          <Button
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !data?.enabled || !data.url || !data.apiToken}
          >
            {sync.isPending && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />}
            Sync now
          </Button>
        </div>

        <div className="space-y-3 border-t pt-5">
          <div>
            <p className="text-sm font-medium">Fix misplaced platform folders</p>
            <p className="text-xs text-muted-foreground">
              Finds games stored in the wrong RomM folder (for example a Switch 2 game in{" "}
              <code>win</code>) and moves them to the right one. Nothing moves until you confirm,
              and an existing folder is never overwritten. Requires RomM platform folders to be
              saved as on.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => scanFolders.mutate()}
            disabled={scanFolders.isPending || !data?.platformFolders}
          >
            {scanFolders.isPending && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />}
            Check library folders
          </Button>
          {proposals?.length === 0 && failures.length === 0 && (
            <output className="block text-sm text-muted-foreground">
              No misplaced folders found.
            </output>
          )}
          {proposals && proposals.length > 0 && (
            <>
              <ul className="space-y-2" aria-label="Folders to move">
                {proposals.map((p) => (
                  <li key={p.gameId} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{p.title}</p>
                    <p className="text-xs text-muted-foreground break-all">
                      <code>{p.currentFolder}</code> → <code>{p.expectedFolder}</code>
                    </p>
                    {p.destinationExists && (
                      <p className="text-xs text-amber-500">
                        The destination already exists, so this one will be skipped.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => repairFolders.mutate(proposals)}
                disabled={repairFolders.isPending}
              >
                {repairFolders.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />
                )}
                Move {proposals.length} game{proposals.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
          {failures.length > 0 && (
            <ul className="space-y-1 text-xs text-destructive" role="alert">
              {failures.map((f) => (
                <li key={f.gameId}>
                  {f.title}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>

        {summary && (
          <p className="text-sm text-muted-foreground" role="status">
            {summary.totalRoms} ROMs in RomM: {summary.matched} matched, {summary.markedOwned}{" "}
            marked as owned, {summary.alreadyOwned} already owned or in progress,{" "}
            {summary.notInLibrary} not in your library.
          </p>
        )}
        {!summary && data?.lastSync && (
          <p className="text-xs text-muted-foreground">
            Last sync: {new Date(data.lastSync).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
