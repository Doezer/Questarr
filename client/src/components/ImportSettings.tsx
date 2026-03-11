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
  const { data: igdbPlatforms = [] } = useQuery<IgdbPlatform[]>({
    queryKey: ["/api/igdb/platforms"],
  });

  // Local State
  const [localConfig, setLocalConfig] = useState<ImportConfig | null>(null);
  const [localRomm, setLocalRomm] = useState<RomMConfig | null>(null);

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
    },
  });

  const updateRommMutation = useMutation({
    mutationFn: async (data: RomMConfig) => {
      await apiRequest("PATCH", "/api/imports/romm", data);
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "RomM configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/romm"] });
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

  return (
    <div className="space-y-6">
      <Tabs defaultValue="config" className="w-full">
        <TabsList>
          <TabsTrigger value="config">General Config</TabsTrigger>
          <TabsTrigger value="romm">Integration Target</TabsTrigger>
          <TabsTrigger value="paths">Path Mappings</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Import & Post-Processing</CardTitle>
              <CardDescription>
                Configure how downloads are processed after completion.
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
                    <Label>Primary Library Root</Label>
                    <Input
                      placeholder="/data"
                      value={localConfig.libraryRoot}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, libraryRoot: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Primary target root for non-integration imports.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Primary Transfer Mode</Label>
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
                      Use hardlink to keep torrent files seeding while importing.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Primary Platform Filter</Label>
                    <p className="text-xs text-muted-foreground">
                      Empty selection means all platforms are eligible.
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
                      {igdbPlatforms.map((platform) => (
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
              <CardTitle>Library Integration Target</CardTitle>
              <CardDescription>
                Configure a secondary import target for external library managers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {localRomm && localConfig && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable Integration Target</Label>
                      <div className="text-xs text-muted-foreground">
                        Enable secondary import destination for selected platforms.
                      </div>
                    </div>
                    <Switch
                      checked={localRomm.enabled}
                      onCheckedChange={(c) => setLocalRomm({ ...localRomm, enabled: c })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Integration Provider</Label>
                    <Select
                      value={localConfig.integrationProvider}
                      onValueChange={(value) =>
                        setLocalConfig({ ...localConfig, integrationProvider: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="romm">RomM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Integration Library Root</Label>
                    <Input
                      placeholder="/data/romm"
                      value={localConfig.integrationLibraryRoot}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, integrationLibraryRoot: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Integration Transfer Mode</Label>
                    <Select
                      value={localConfig.integrationTransferMode}
                      onValueChange={(value) =>
                        setLocalConfig({
                          ...localConfig,
                          integrationTransferMode: value as "move" | "copy" | "hardlink",
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
                  </div>
                  <div className="space-y-2">
                    <Label>Integration Platform Filter</Label>
                    <p className="text-xs text-muted-foreground">
                      Empty selection means all mapped platforms are eligible.
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
                      {igdbPlatforms.map((platform) => (
                        <div key={platform.id} className="flex items-start gap-3">
                          <Checkbox
                            id={`integration-platform-${platform.id}`}
                            checked={localConfig.integrationPlatformIds.includes(platform.id)}
                            onCheckedChange={() =>
                              togglePlatformId(
                                localConfig.integrationPlatformIds,
                                platform.id,
                                (next) =>
                                  setLocalConfig({ ...localConfig, integrationPlatformIds: next })
                              )
                            }
                          />
                          <label
                            htmlFor={`integration-platform-${platform.id}`}
                            className="cursor-pointer text-sm"
                          >
                            {platform.name}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>RomM Library Root</Label>
                    <Input
                      placeholder="/mnt/romm/library/roms"
                      value={localRomm.libraryRoot}
                      onChange={(e) => setLocalRomm({ ...localRomm, libraryRoot: e.target.value })}
                    />
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
                      variant="outline"
                      onClick={() => localConfig && updateConfigMutation.mutate(localConfig)}
                      disabled={updateConfigMutation.isPending}
                    >
                      {updateConfigMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save Integration Target
                    </Button>
                  </div>
                  <div className="flex justify-end">
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
                </>
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
