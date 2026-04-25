import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, X, ArrowRight, Folder, Link, Copy, MoveRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ImportConfig } from "@shared/schema";
import { PathMappingSettings } from "./PathMappingSettings";

type IgdbPlatform = { id: number; name: string };
type AppConfig = { igdb?: { configured?: boolean } };

type HardlinkPairCheck = {
  sourcePath: string;
  targetPath: string;
  supported: boolean;
  sameDevice: boolean;
  reason?: string;
};

type HardlinkCapabilityResult = {
  targetRoot: string;
  supportedForAll: boolean | null;
  checkedSources: HardlinkPairCheck[];
  reason?: string;
};

type HardlinkCapabilityResponse = {
  generic: HardlinkCapabilityResult;
};

export default function ImportSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries
  const { data: config, isLoading: configLoading } = useQuery<ImportConfig>({
    queryKey: ["/api/imports/config"],
  });
  const {
    data: igdbPlatforms = [],
    isLoading: platformsLoading,
    isError: platformsError,
    refetch: refetchPlatforms,
  } = useQuery<IgdbPlatform[]>({
    queryKey: ["/api/igdb/platforms"],
  });
  const { data: appConfig } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
  });
  const { data: hardlinkCapability } = useQuery<HardlinkCapabilityResponse>({
    queryKey: ["/api/imports/hardlink/check"],
  });

  // Local State
  const [localConfig, setLocalConfig] = useState<ImportConfig | null>(null);
  const [platformSearch, setPlatformSearch] = useState("");

  useEffect(() => {
    if (config) setLocalConfig(config);
  }, [config]);

  // Mutations
  const updateConfigMutation = useMutation({
    mutationFn: async (data: ImportConfig) => {
      await apiRequest("PATCH", "/api/imports/config", data);
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Import configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/hardlink/check"] });
    },
    onError: () => {
      if (config) setLocalConfig(config);
      toast({
        title: "Save Failed",
        description: "Could not update import settings.",
        variant: "destructive",
      });
    },
  });

  if (configLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const togglePlatformId = (
    platformIds: number[],
    platformId: number,
    apply: (next: number[]) => void
  ) => {
    const exists = platformIds.includes(platformId);
    const next = exists
      ? platformIds.filter((id) => id !== platformId)
      : [...platformIds, platformId].sort((a, b) => a - b);
    apply(next);
  };

  const normalizedPlatformSearch = platformSearch.trim().toLowerCase();
  const filteredPlatforms = normalizedPlatformSearch
    ? igdbPlatforms.filter((platform) =>
        platform.name.toLowerCase().includes(normalizedPlatformSearch)
      )
    : igdbPlatforms;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="config" className="w-full">
        <TabsList>
          <TabsTrigger value="config">General Config</TabsTrigger>
          <TabsTrigger value="paths">Path Mappings</TabsTrigger>
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4">
          {localConfig && (
            <>
              <Card>
                <CardContent className="pt-6 space-y-0">
                  {/* Master switch — always interactive */}
                  <div className="flex items-center justify-between pb-6">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Enable Post-Processing</Label>
                      <p className="text-xs text-muted-foreground">
                        Master switch for the import engine.
                      </p>
                      {localConfig.enablePostProcessing && (
                        <p className="text-xs text-muted-foreground mt-1">
                          If your download client runs on a different machine or volume than
                          Questarr, configure{" "}
                          <span className="font-medium text-foreground">Path Mappings</span> so
                          Questarr can resolve the remote paths correctly.
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={localConfig.enablePostProcessing}
                      onCheckedChange={(c) =>
                        setLocalConfig({ ...localConfig, enablePostProcessing: c })
                      }
                    />
                  </div>

                  <div
                    className={
                      localConfig.enablePostProcessing
                        ? undefined
                        : "opacity-50 pointer-events-none select-none"
                    }
                  >
                    <Separator className="mb-6" />

                    {/* ── Processing ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Processing
                    </p>
                    <div className="space-y-4 mb-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Overwrite Existing Files</Label>
                          <p className="text-xs text-muted-foreground">
                            Replace files already present at the destination.
                          </p>
                        </div>
                        <Switch
                          checked={localConfig.overwriteExisting}
                          onCheckedChange={(c) =>
                            setLocalConfig({ ...localConfig, overwriteExisting: c })
                          }
                        />
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── Library ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Library
                    </p>
                    <div className="space-y-4 mb-6">
                      <div className="space-y-1.5">
                        <Label>Library Root</Label>
                        <Input
                          placeholder="/data/library"
                          value={localConfig.libraryRoot}
                          onChange={(e) =>
                            setLocalConfig({ ...localConfig, libraryRoot: e.target.value })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Where files are placed after import.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Transfer Mode</Label>
                        <Select
                          value={localConfig.transferMode}
                          onValueChange={(value) =>
                            setLocalConfig({
                              ...localConfig,
                              transferMode: value as "move" | "copy" | "hardlink",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hardlink">Hardlink</SelectItem>
                            <SelectItem value="copy">Copy</SelectItem>
                            <SelectItem value="move">Move</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Hardlink keeps torrents seeding while importing.
                        </p>
                        {hardlinkCapability?.generic.supportedForAll === false &&
                          localConfig.transferMode === "hardlink" && (
                            <p className="text-xs text-amber-500">
                              Hardlink unavailable for some download paths — will fall back to copy.
                            </p>
                          )}
                        {hardlinkCapability?.generic.supportedForAll === null && (
                          <p className="text-xs text-muted-foreground">
                            Hardlink check unavailable: configure at least one downloader path
                            first.
                          </p>
                        )}
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── Platform Filter ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Platform Filter
                    </p>
                    <div className="space-y-2 mb-6">
                      <p className="text-xs text-muted-foreground">
                        Restrict imports to selected platforms. Empty = all platforms eligible.
                      </p>
                      <Input
                        placeholder="Search platforms..."
                        value={platformSearch}
                        onChange={(e) => setPlatformSearch(e.target.value)}
                      />
                      <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
                        {platformsLoading && (
                          <p className="text-xs text-muted-foreground">Loading platforms...</p>
                        )}
                        {platformsError && (
                          <div className="space-y-2">
                            <p className="text-xs text-amber-500">
                              Could not load platform list from IGDB.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => refetchPlatforms()}
                            >
                              Retry
                            </Button>
                          </div>
                        )}
                        {!platformsLoading && !platformsError && igdbPlatforms.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            {appConfig?.igdb?.configured
                              ? "IGDB returned no platforms. Try again in a few seconds."
                              : "IGDB is not configured yet — platform filters unavailable."}
                          </p>
                        )}
                        {!platformsLoading &&
                          !platformsError &&
                          igdbPlatforms.length > 0 &&
                          filteredPlatforms.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              No platforms match your search.
                            </p>
                          )}
                        {filteredPlatforms.map((platform) => (
                          <div key={platform.id} className="flex items-center gap-2.5">
                            <Checkbox
                              id={`primary-platform-${platform.id}`}
                              checked={localConfig.importPlatformIds.includes(platform.id)}
                              onCheckedChange={() =>
                                togglePlatformId(
                                  localConfig.importPlatformIds,
                                  platform.id,
                                  (next) =>
                                    setLocalConfig({ ...localConfig, importPlatformIds: next })
                                )
                              }
                            />
                            <label
                              htmlFor={`primary-platform-${platform.id}`}
                              className="cursor-pointer text-sm"
                            >
                              {platform.name}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── Naming ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Naming
                    </p>
                    <div className="space-y-1.5">
                      <Label>Rename Pattern</Label>
                      <Input
                        value={localConfig.renamePattern}
                        onChange={(e) =>
                          setLocalConfig({ ...localConfig, renamePattern: e.target.value })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Available tokens: {"{Title}"}, {"{Region}"}, {"{Platform}"}, {"{Year}"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button
                  onClick={() => localConfig && updateConfigMutation.mutate(localConfig)}
                  disabled={updateConfigMutation.isPending}
                >
                  {updateConfigMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="paths" className="space-y-4">
          <PathMappingSettings />
        </TabsContent>

        <TabsContent value="help" className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-6 text-sm">
              {/* ── How it works ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  How the import pipeline works
                </p>
                <p className="text-muted-foreground mb-3">
                  When a download finishes, Questarr automatically runs through the following steps
                  — no manual action needed unless a step requires your input.
                </p>
                <ol className="space-y-2 text-muted-foreground">
                  {[
                    [
                      "Path translation",
                      "The path reported by your download client (e.g. /downloads/Game.zip) is translated to the path that Questarr can actually read on its host. Configure this in Path Mappings if Questarr and your download client run in separate containers or machines.",
                    ],
                    [
                      "Strategy selection",
                      "Questarr inspects the game's platform and routes the file to the configured library root.",
                    ],
                    [
                      "File transfer",
                      "The file is hardlinked, copied, moved, or symlinked to its destination using the Transfer Mode you configured.",
                    ],
                    [
                      "Game status update",
                      'The download is marked "imported" and the game is marked "owned" in your library.',
                    ],
                    [
                      "Manual review",
                      'If Questarr cannot determine the correct destination — for example, because the platform slug is unknown — the download is flagged as "manual review required". You can resolve it from the Downloads page.',
                    ],
                  ].map(([title, desc], i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span>
                        <span className="font-medium text-foreground">{title} — </span>
                        {desc}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <Separator />

              {/* ── Transfer modes ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Transfer modes
                </p>
                <div className="space-y-3">
                  {[
                    {
                      icon: <Link className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />,
                      name: "Hardlink",
                      desc: "Creates a second directory entry pointing to the same file on disk. Zero extra space used, and your torrent client continues seeding normally. Requires the source and destination to be on the same physical volume (same drive or mount point).",
                      when: "Best choice when your download folder and library are on the same disk. Preferred for seedbox-style setups.",
                    },
                    {
                      icon: <Copy className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />,
                      name: "Copy",
                      desc: "Duplicates the file to the destination. The original is kept intact so the torrent can continue seeding, but you use double the disk space.",
                      when: "Use when your library is on a different drive or network share than your download folder, and you still want to keep seeding.",
                    },
                    {
                      icon: <MoveRight className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />,
                      name: "Move",
                      desc: "Moves the file to the destination and removes it from the download folder. No extra space used, but the torrent will stop seeding.",
                      when: "Use when you do not care about seeding after import, or when disk space is tight.",
                    },
                    {
                      icon: <ArrowRight className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />,
                      name: "Symlink",
                      desc: "Creates a symbolic link at the destination pointing back to the original file in your download folder. The file is not duplicated or moved.",
                      when: "Use when you want your library to reflect downloads without copying files. The torrent keeps seeding.",
                    },
                  ].map(({ icon, name, desc, when }) => (
                    <div key={name} className="rounded-md border p-3 space-y-1">
                      <div className="flex items-start gap-2">
                        {icon}
                        <span className="font-medium text-foreground">{name}</span>
                      </div>
                      <p className="text-muted-foreground pl-6">{desc}</p>
                      <p className="text-xs text-muted-foreground pl-6">
                        <span className="font-medium text-foreground">When to use: </span>
                        {when}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* ── General Config settings ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  General Config settings
                </p>
                <div className="space-y-3">
                  {[
                    {
                      name: "Enable Post-Processing",
                      desc: "Master switch. When off, downloads are marked completed without any file being moved or organised. Turn this off if you manage your own file organisation externally.",
                    },
                    {
                      name: "Library Root",
                      desc: "Destination folder for imported games. Example: /data/library or D:\\Games.",
                    },
                    {
                      name: "Transfer Mode",
                      desc: "How files are transferred to the library root. See Transfer Modes above. Hardlink is recommended when possible.",
                    },
                    {
                      name: "Platform Filter",
                      desc: "Limits imports to only the selected platforms. If no platforms are checked, all platforms are eligible.",
                    },
                    {
                      name: "Rename Pattern",
                      desc: "Controls the file name after import. Tokens: {Title} = game title, {Region} = region tag from the release name, {Platform} = platform name, {Year} = release year. Example: {Title} ({Year}) ({Platform}).",
                    },
                  ].map(({ name, desc }) => (
                    <div key={name}>
                      <p className="font-medium text-foreground">{name}</p>
                      <p className="text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* ── Path Mappings ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Path Mappings
                </p>
                <p className="text-muted-foreground mb-2">
                  Path mappings translate paths between what your download client reports and what
                  Questarr can access on its own filesystem.
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="font-medium text-foreground">When you need this</p>
                    <p className="text-muted-foreground">
                      If Questarr and your download client are in different Docker containers (or on
                      different machines), the same physical folder appears under different paths in
                      each. For example, the download client might report{" "}
                      <code className="text-xs bg-muted rounded px-1">/downloads/Game.iso</code>{" "}
                      while Questarr mounts that folder at{" "}
                      <code className="text-xs bg-muted rounded px-1">/data/torrents/Game.iso</code>
                      . Add a mapping with Remote path{" "}
                      <code className="text-xs bg-muted rounded px-1">/downloads</code> → Local path{" "}
                      <code className="text-xs bg-muted rounded px-1">/data/torrents</code>.
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">When you do not need this</p>
                    <p className="text-muted-foreground">
                      If everything runs on the same host (or in a single container with shared
                      mounts), paths are already consistent and no mapping is required.
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* ── Common setups ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Common setup examples
                </p>
                <div className="space-y-4">
                  {[
                    {
                      title: "All-in-one (single host)",
                      steps: [
                        "Enable Post-Processing.",
                        "Set Library Root to where you want games stored (e.g. /data/library).",
                        "Set Transfer Mode to Hardlink if the download folder is on the same volume, otherwise Copy.",
                        "Leave Path Mappings empty.",
                      ],
                    },
                    {
                      title: "Separate containers (Questarr + download client)",
                      steps: [
                        "Enable Post-Processing.",
                        "Set Library Root to the path Questarr uses to reach the library folder.",
                        "Add a Path Mapping so the download client's reported path is translated to a path Questarr can read.",
                        "Set Transfer Mode to Hardlink (if all volumes are on the same device) or Copy.",
                      ],
                    },
                  ].map(({ title, steps }) => (
                    <div key={title} className="rounded-md border p-3 space-y-2">
                      <p className="font-medium text-foreground flex items-center gap-1.5">
                        <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {title}
                      </p>
                      <ol className="space-y-1 pl-1">
                        {steps.map((step, i) => (
                          <li key={i} className="flex gap-2 text-muted-foreground">
                            <span className="text-xs font-semibold text-primary mt-0.5 shrink-0">
                              {i + 1}.
                            </span>
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
