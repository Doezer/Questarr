import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="romm-platform-folders">RomM platform folders</Label>
            <p className="text-xs text-muted-foreground">
              Place imports in <code>&lt;library root&gt;/&lt;platform&gt;/</code> using RomM folder
              names (<code>snes</code>, <code>ps2</code>, <code>win</code>…). Point the library root
              at RomM&apos;s <code>roms</code> folder. Works without the API below.
            </p>
          </div>
          <Switch
            id="romm-platform-folders"
            checked={form.platformFolders}
            onCheckedChange={(value) => set("platformFolders", value)}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="romm-enabled">Connect to the RomM API</Label>
            <p className="text-xs text-muted-foreground">
              Needed to read your RomM library and to trigger a rescan after imports.
            </p>
          </div>
          <Switch
            id="romm-enabled"
            checked={form.enabled}
            onCheckedChange={(value) => set("enabled", value)}
          />
        </div>

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

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="romm-scan">Rescan RomM after an import</Label>
            <p className="text-xs text-muted-foreground">
              A RomM outage never fails or delays an import.
            </p>
          </div>
          <Switch
            id="romm-scan"
            checked={form.scanAfterImport}
            onCheckedChange={(value) => set("scanAfterImport", value)}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="romm-sync">Mark games found in RomM as owned</Label>
            <p className="text-xs text-muted-foreground">
              Every 6 hours, games in your wishlist that RomM already has become owned. Games are
              matched by IGDB id, then by title. Nothing is created, and playing, shelved or
              completed games are left alone.
            </p>
          </div>
          <Switch
            id="romm-sync"
            checked={form.syncEnabled}
            onCheckedChange={(value) => set("syncEnabled", value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save RomM settings
          </Button>
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending || !form.url || !form.apiToken}
          >
            {test.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Test connection
          </Button>
          <Button
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !data?.enabled || !data.url || !data.apiToken}
          >
            {sync.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sync now
          </Button>
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
