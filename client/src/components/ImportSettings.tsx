import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ImportConfig, RomMConfig } from "@shared/schema";
import { PathMappingSettings } from "./PathMappingSettings";
import { PlatformMappingSettings } from "./PlatformMappingSettings";

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
  romm: HardlinkCapabilityResult;
};

export default function ImportSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries
  const { data: config, isLoading: configLoading } = useQuery<ImportConfig>({
    queryKey: ["/api/imports/config"],
  });
  const { data: rommConfig, isLoading: rommLoading } = useQuery<RomMConfig>({
    queryKey: ["/api/imports/romm"],
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
  const [localRomm, setLocalRomm] = useState<RomMConfig | null>(null);
  const [platformSearch, setPlatformSearch] = useState("");

  useEffect(() => {
    if (config) setLocalConfig(config);
  }, [config]);

  useEffect(() => {
    if (rommConfig) {
      setLocalRomm({
        ...rommConfig,
        libraryRoot: rommConfig.libraryRoot || "/data",
        platformRoutingMode: rommConfig.platformRoutingMode || "slug-subfolder",
        platformBindings: rommConfig.platformBindings || {},
        platformAliases: rommConfig.platformAliases || {},
        moveMode: rommConfig.moveMode || "hardlink",
        conflictPolicy: rommConfig.conflictPolicy || "rename",
        folderNamingTemplate: rommConfig.folderNamingTemplate || "{title}",
        singleFilePlacement: rommConfig.singleFilePlacement || "root",
        multiFilePlacement: "subfolder",
        includeRegionLanguageTags: !!rommConfig.includeRegionLanguageTags,
        allowedSlugs: rommConfig.allowedSlugs,
        allowAbsoluteBindings: !!rommConfig.allowAbsoluteBindings,
        bindingMissingBehavior: rommConfig.bindingMissingBehavior || "fallback",
      });
    }
  }, [rommConfig]);

  const parseJsonMap = (raw: string): Record<string, string> => {
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v ?? "")]));
  };

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
  });

  const updateRommMutation = useMutation({
    mutationFn: async (data: RomMConfig) => {
      await apiRequest("PATCH", "/api/imports/romm", data);
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "RomM configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/romm"] });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/hardlink/check"] });
    },
  });

  if (configLoading || rommLoading) {
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
          <TabsTrigger value="romm">RomM</TabsTrigger>
          <TabsTrigger value="paths">Path Mappings</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Import & Post-Processing</CardTitle>
              <CardDescription>
                Configure post-processing, auto-unpack, overwrite behavior, library root, transfer
                mode, platform filter, and rename pattern for imported downloads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {localConfig && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable Post-Processing</Label>
                      <div className="text-xs text-muted-foreground">
                        Master switch for the import engine.
                      </div>
                    </div>
                    <Switch
                      checked={localConfig.enablePostProcessing}
                      onCheckedChange={(c) =>
                        setLocalConfig({ ...localConfig, enablePostProcessing: c })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto-Unpack Archives</Label>
                      <div className="text-xs text-muted-foreground">
                        Automatically extract .zip, .rar, .7z files.
                      </div>
                    </div>
                    <Switch
                      checked={localConfig.autoUnpack}
                      onCheckedChange={(c) => setLocalConfig({ ...localConfig, autoUnpack: c })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Overwrite Existing Files</Label>
                      <div className="text-xs text-muted-foreground">
                        Replace files if they already exist in destination.
                      </div>
                    </div>
                    <Switch
                      checked={localConfig.overwriteExisting}
                      onCheckedChange={(c) =>
                        setLocalConfig({ ...localConfig, overwriteExisting: c })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Questarr Library Root</Label>
                    <Input
                      placeholder="/data/library"
                      value={localConfig.libraryRoot}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, libraryRoot: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Destination root used by Questarr. This is where files will be
                      moved/copied/linked to by default.
                    </p>
                  </div>
                  <div className="space-y-2">
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
                        <SelectItem value="move">Move</SelectItem>
                        <SelectItem value="copy">Copy</SelectItem>
                        <SelectItem value="hardlink">Hardlink</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Use hardlink to keep seeding torrents while importing.
                    </p>
                    {hardlinkCapability?.generic.supportedForAll === false &&
                      localConfig.transferMode === "hardlink" && (
                        <p className="text-xs text-amber-600">
                          Hardlink is not available for all configured download paths. Questarr will
                          fall back to copy for incompatible sources.
                        </p>
                      )}
                    {hardlinkCapability?.generic.supportedForAll === null && (
                      <p className="text-xs text-muted-foreground">
                        Hardlink check unavailable: configure at least one downloader download path.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Platform Filter</Label>
                    <p className="text-xs text-muted-foreground">
                      Empty selection means all platforms are eligible.
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
                          <p className="text-xs text-amber-600">
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
                            : "IGDB is not configured yet, so platform filters are unavailable."}
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
                        <div key={platform.id} className="flex items-start gap-3">
                          <Checkbox
                            id={`primary-platform-${platform.id}`}
                            checked={localConfig.importPlatformIds.includes(platform.id)}
                            onCheckedChange={() =>
                              togglePlatformId(localConfig.importPlatformIds, platform.id, (next) =>
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
                  <div className="space-y-2">
                    <Label>Rename Pattern</Label>
                    <Input
                      value={localConfig.renamePattern}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, renamePattern: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Available tags: {"{Title}"}, {"{Region}"}, {"{Platform}"}, {"{Year}"}
                    </p>
                  </div>
                  <div className="flex justify-end pt-4">
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="romm" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>RomM Provider Settings</CardTitle>
              <CardDescription>
                Configure RomM-specific routing and import behavior.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {localRomm && (
                <div className="space-y-6 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable RomM Provider</Label>
                      <div className="text-xs text-muted-foreground">
                        Enable RomM routing when platform mappings and slug rules match.
                      </div>
                    </div>
                    <Switch
                      checked={localRomm.enabled}
                      onCheckedChange={(c) => setLocalRomm({ ...localRomm, enabled: c })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>RomM Library Root</Label>
                    <Input
                      placeholder="/mnt/romm/library/roms"
                      value={localRomm.libraryRoot}
                      onChange={(e) => setLocalRomm({ ...localRomm, libraryRoot: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Base destination for RomM platform routing (for example, platform subfolders
                      or binding-map paths).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Platform Routing Mode</Label>
                    <Select
                      value={localRomm.platformRoutingMode}
                      onValueChange={(value) =>
                        setLocalRomm({
                          ...localRomm,
                          platformRoutingMode: value as RomMConfig["platformRoutingMode"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="slug-subfolder">slug-subfolder</SelectItem>
                        <SelectItem value="binding-map">binding-map</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Platform Bindings (JSON: slug -&gt; path)</Label>
                    <textarea
                      className="w-full min-h-[84px] rounded-md border bg-background px-3 py-2 text-sm"
                      value={JSON.stringify(localRomm.platformBindings, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = parseJsonMap(e.target.value);
                          setLocalRomm({ ...localRomm, platformBindings: parsed });
                        } catch {
                          // Keep existing value until valid JSON is entered.
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Platform Aliases (JSON: questarr key -&gt; fs_slug)</Label>
                    <textarea
                      className="w-full min-h-[84px] rounded-md border bg-background px-3 py-2 text-sm"
                      value={JSON.stringify(localRomm.platformAliases, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = parseJsonMap(e.target.value);
                          setLocalRomm({ ...localRomm, platformAliases: parsed });
                        } catch {
                          // Keep existing value until valid JSON is entered.
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Move Mode</Label>
                    <Select
                      value={localRomm.moveMode}
                      onValueChange={(value) =>
                        setLocalRomm({ ...localRomm, moveMode: value as RomMConfig["moveMode"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hardlink">Hardlink</SelectItem>
                        <SelectItem value="copy">Copy</SelectItem>
                        <SelectItem value="move">Move</SelectItem>
                        <SelectItem value="symlink">Symlink</SelectItem>
                      </SelectContent>
                    </Select>
                    {hardlinkCapability?.romm.supportedForAll === false &&
                      localRomm.moveMode === "hardlink" && (
                        <p className="text-xs text-amber-600">
                          Hardlink is not available for all configured download paths. RomM imports
                          will fall back to copy when cross-filesystem links are not possible.
                        </p>
                      )}
                  </div>
                  <div className="space-y-2">
                    <Label>Conflict Policy</Label>
                    <Select
                      value={localRomm.conflictPolicy}
                      onValueChange={(value) =>
                        setLocalRomm({
                          ...localRomm,
                          conflictPolicy: value as RomMConfig["conflictPolicy"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rename">Rename</SelectItem>
                        <SelectItem value="skip">Skip</SelectItem>
                        <SelectItem value="overwrite">Overwrite</SelectItem>
                        <SelectItem value="fail">Fail</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Folder Naming Template</Label>
                    <Input
                      value={localRomm.folderNamingTemplate}
                      onChange={(e) =>
                        setLocalRomm({ ...localRomm, folderNamingTemplate: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Single File Placement</Label>
                    <Select
                      value={localRomm.singleFilePlacement}
                      onValueChange={(value) =>
                        setLocalRomm({
                          ...localRomm,
                          singleFilePlacement: value as RomMConfig["singleFilePlacement"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="root">Root</SelectItem>
                        <SelectItem value="subfolder">Subfolder</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Allowed Slugs (comma separated, optional)</Label>
                    <Input
                      placeholder="ps2, snes, n64"
                      value={(localRomm.allowedSlugs || []).join(", ")}
                      onChange={(e) =>
                        setLocalRomm({
                          ...localRomm,
                          allowedSlugs: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Allow Absolute Bindings</Label>
                      <div className="text-xs text-muted-foreground">
                        Permit binding-map values to use absolute filesystem paths.
                      </div>
                    </div>
                    <Switch
                      checked={localRomm.allowAbsoluteBindings}
                      onCheckedChange={(c) =>
                        setLocalRomm({ ...localRomm, allowAbsoluteBindings: c })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Missing Binding Behavior</Label>
                    <Select
                      value={localRomm.bindingMissingBehavior}
                      onValueChange={(value) =>
                        setLocalRomm({
                          ...localRomm,
                          bindingMissingBehavior: value as RomMConfig["bindingMissingBehavior"],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fallback">Fallback to slug-subfolder</SelectItem>
                        <SelectItem value="error">Error on missing binding</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Include Region/Language Tags</Label>
                      <div className="text-xs text-muted-foreground">
                        Keep region/language tags in naming when available.
                      </div>
                    </div>
                    <Switch
                      checked={localRomm.includeRegionLanguageTags}
                      onCheckedChange={(c) =>
                        setLocalRomm({ ...localRomm, includeRegionLanguageTags: c })
                      }
                    />
                  </div>
                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={() => localRomm && updateRommMutation.mutate(localRomm)}
                      disabled={updateRommMutation.isPending}
                    >
                      {updateRommMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save RomM Config
                    </Button>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <p>RomM scan guidance:</p>
                    <p>1. Open RomM settings in RomM UI.</p>
                    <p>
                      2. Enable automatic library scan (scheduled or file-watch), or run manual
                      scans.
                    </p>
                    <p>3. Questarr does not trigger scans via API.</p>
                  </div>

                  <div className="pt-2">
                    <PlatformMappingSettings />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paths" className="space-y-4">
          <PathMappingSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
