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
import { Loader2, Plus, X, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ImportConfig, RomMConfig, RomMConfigInput } from "@shared/schema";
import { PathMappingSettings } from "./PathMappingSettings";
import { PlatformMappingSettings } from "./PlatformMappingSettings";

type IgdbPlatform = { id: number; name: string };
type AppConfig = { igdb?: { configured?: boolean } };

type KVEntry = { key: string; value: string };

const recordToEntries = (record: Record<string, string>): KVEntry[] =>
  Object.keys(record).length === 0
    ? []
    : Object.entries(record).map(([key, value]) => ({ key, value }));

const entriesToRecord = (entries: KVEntry[]): Record<string, string> =>
  Object.fromEntries(entries.filter((e) => e.key.trim()).map((e) => [e.key.trim(), e.value]));

function KVEditor({
  entries,
  onChange,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  disabled,
}: {
  entries: KVEntry[];
  onChange: (next: KVEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}) {
  const updateEntry = (i: number, field: keyof KVEntry, val: string) => {
    const next = entries.map((e, idx) => (idx === i ? { ...e, [field]: val } : e));
    onChange(next);
  };
  const removeEntry = (i: number) => onChange(entries.filter((_, idx) => idx !== i));
  const addEntry = () => onChange([...entries, { key: "", value: "" }]);

  return (
    <div className="space-y-1.5">
      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">No entries. Click Add to create one.</p>
      )}
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="h-8 text-xs font-mono w-2/5"
            placeholder={keyPlaceholder}
            value={entry.key}
            onChange={(e) => updateEntry(i, "key", e.target.value)}
            disabled={disabled}
          />
          <span className="text-muted-foreground text-xs shrink-0">→</span>
          <Input
            className="h-8 text-xs font-mono flex-1"
            placeholder={valuePlaceholder}
            value={entry.value}
            onChange={(e) => updateEntry(i, "value", e.target.value)}
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeEntry(i)}
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1 mt-1"
        onClick={addEntry}
        disabled={disabled}
      >
        <Plus className="h-3 w-3" />
        Add
      </Button>
    </div>
  );
}

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
  const [localRomm, setLocalRomm] = useState<RomMConfigInput | null>(null);
  const [bindingEntries, setBindingEntries] = useState<KVEntry[]>([]);
  const [aliasEntries, setAliasEntries] = useState<KVEntry[]>([]);
  const [platformSearch, setPlatformSearch] = useState("");

  useEffect(() => {
    if (config) setLocalConfig(config);
  }, [config]);

  useEffect(() => {
    if (rommConfig) {
      const bindings = rommConfig.platformBindings || {};
      const aliases = rommConfig.platformAliases || {};
      setLocalRomm({
        ...rommConfig,
        libraryRoot: rommConfig.libraryRoot || "/data",
        platformRoutingMode: rommConfig.platformRoutingMode || "slug-subfolder",
        platformBindings: bindings,
        platformAliases: aliases,
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
      setBindingEntries(recordToEntries(bindings));
      setAliasEntries(recordToEntries(aliases));
    }
  }, [rommConfig]);

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
    mutationFn: async (data: RomMConfigInput) => {
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
                          <Label>Auto-Unpack Archives</Label>
                          <p className="text-xs text-muted-foreground">
                            Extract .zip, .rar, .7z after download.
                          </p>
                        </div>
                        <Switch
                          checked={localConfig.autoUnpack}
                          onCheckedChange={(c) => setLocalConfig({ ...localConfig, autoUnpack: c })}
                        />
                      </div>
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
                          Default destination root for imported files.
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

        <TabsContent value="romm" className="space-y-4">
          {localRomm && (
            <>
              <Card>
                <CardContent className="pt-6 space-y-0">
                  {/* Provider toggle — always interactive */}
                  <div className="flex items-center justify-between pb-6">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Enable RomM Provider</Label>
                      <p className="text-xs text-muted-foreground">
                        Route imported ROMs into the RomM library folder structure.
                      </p>
                    </div>
                    <Switch
                      checked={localRomm.enabled}
                      onCheckedChange={(c) => setLocalRomm({ ...localRomm, enabled: c })}
                    />
                  </div>

                  {/* Everything below dims when disabled */}
                  <div
                    className={
                      localRomm.enabled ? undefined : "opacity-50 pointer-events-none select-none"
                    }
                  >
                    <Separator className="mb-6" />

                    {/* ── Library ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Library
                    </p>
                    <div className="space-y-4 mb-6">
                      <div className="space-y-1.5">
                        <Label>Library Root</Label>
                        <Input
                          placeholder="/mnt/romm/library/roms"
                          value={localRomm.libraryRoot}
                          onChange={(e) =>
                            setLocalRomm({ ...localRomm, libraryRoot: e.target.value })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Base path where platform subfolders (or binding-map paths) will be
                          created.
                        </p>
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── Routing ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Platform Routing
                    </p>
                    <div className="space-y-4 mb-6">
                      <div className="space-y-1.5">
                        <Label>Routing Mode</Label>
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
                            <SelectItem value="slug-subfolder">
                              Slug subfolder — library/&lt;slug&gt;/
                            </SelectItem>
                            <SelectItem value="binding-map">
                              Binding map — explicit slug → path table
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {localRomm.platformRoutingMode === "binding-map" && (
                        <>
                          <div className="space-y-1.5">
                            <Label>Platform Bindings</Label>
                            <p className="text-xs text-muted-foreground">
                              Map each RomM slug to a destination path.
                            </p>
                            <KVEditor
                              entries={bindingEntries}
                              onChange={setBindingEntries}
                              keyPlaceholder="slug (e.g. ps2)"
                              valuePlaceholder="path (e.g. /data/ps2)"
                              disabled={!localRomm.enabled}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label>Allow Absolute Paths</Label>
                              <p className="text-xs text-muted-foreground">
                                Permit binding values that start with /.
                              </p>
                            </div>
                            <Switch
                              checked={localRomm.allowAbsoluteBindings}
                              onCheckedChange={(c) =>
                                setLocalRomm({ ...localRomm, allowAbsoluteBindings: c })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Missing Binding</Label>
                            <Select
                              value={localRomm.bindingMissingBehavior}
                              onValueChange={(value) =>
                                setLocalRomm({
                                  ...localRomm,
                                  bindingMissingBehavior:
                                    value as RomMConfig["bindingMissingBehavior"],
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="fallback">Fallback to slug subfolder</SelectItem>
                                <SelectItem value="error">Error</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}

                      <div className="space-y-1.5">
                        <Label>Platform Aliases</Label>
                        <p className="text-xs text-muted-foreground">
                          Override the slug used for a platform. Questarr key → RomM slug.
                        </p>
                        <KVEditor
                          entries={aliasEntries}
                          onChange={setAliasEntries}
                          keyPlaceholder="questarr key"
                          valuePlaceholder="romm slug"
                          disabled={!localRomm.enabled}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Allowed Slugs</Label>
                        <Input
                          placeholder="ps2, snes, n64 — leave empty for all"
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
                        <p className="text-xs text-muted-foreground">
                          Only import games matching these slugs. Empty = no filter.
                        </p>
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── File Transfer ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      File Transfer
                    </p>
                    <div className="space-y-4 mb-6">
                      <div className="space-y-1.5">
                        <Label>Transfer Mode</Label>
                        <Select
                          value={localRomm.moveMode}
                          onValueChange={(value) =>
                            setLocalRomm({
                              ...localRomm,
                              moveMode: value as RomMConfig["moveMode"],
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
                            <SelectItem value="symlink">Symlink</SelectItem>
                          </SelectContent>
                        </Select>
                        {hardlinkCapability?.romm.supportedForAll === false &&
                          localRomm.moveMode === "hardlink" && (
                            <p className="text-xs text-amber-500">
                              Hardlink unavailable for some download paths — will fall back to copy.
                            </p>
                          )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>On Conflict</Label>
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
                            <SelectItem value="rename">Rename — keep both</SelectItem>
                            <SelectItem value="skip">Skip — keep existing</SelectItem>
                            <SelectItem value="overwrite">Overwrite — replace existing</SelectItem>
                            <SelectItem value="fail">Fail — abort import</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── Naming ── */}
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Naming
                    </p>
                    <div className="space-y-4 mb-6">
                      <div className="space-y-1.5">
                        <Label>Folder Naming Template</Label>
                        <Input
                          value={localRomm.folderNamingTemplate}
                          onChange={(e) =>
                            setLocalRomm({ ...localRomm, folderNamingTemplate: e.target.value })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Available tokens: {"{title}"}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Single-File Placement</Label>
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
                            <SelectItem value="root">Root — directly in platform folder</SelectItem>
                            <SelectItem value="subfolder">
                              Subfolder — inside a named subfolder
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Include Region / Language Tags</Label>
                          <p className="text-xs text-muted-foreground">
                            Append region/language info to file names when available.
                          </p>
                        </div>
                        <Switch
                          checked={localRomm.includeRegionLanguageTags}
                          onCheckedChange={(c) =>
                            setLocalRomm({ ...localRomm, includeRegionLanguageTags: c })
                          }
                        />
                      </div>
                    </div>

                    <Separator className="mb-6" />

                    <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Questarr does not trigger RomM library scans. Enable automatic scanning
                        (scheduled or file-watch) in the RomM UI after importing.
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    localRomm &&
                    updateRommMutation.mutate({
                      ...localRomm,
                      platformBindings: entriesToRecord(bindingEntries),
                      platformAliases: entriesToRecord(aliasEntries),
                    })
                  }
                  disabled={updateRommMutation.isPending}
                >
                  {updateRommMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </div>

              <PlatformMappingSettings />
            </>
          )}
        </TabsContent>

        <TabsContent value="paths" className="space-y-4">
          <PathMappingSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
