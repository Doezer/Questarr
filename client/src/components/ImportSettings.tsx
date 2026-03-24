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
import {
  Loader2,
  Plus,
  X,
  Info,
  ArrowRight,
  Folder,
  Link,
  Copy,
  MoveRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ImportConfig, PlatformMapping, RomMConfig, RomMConfigInput } from "@shared/schema";
import { PathMappingSettings } from "./PathMappingSettings";

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
  const { data: platformMappings = [] } = useQuery<PlatformMapping[]>({
    queryKey: ["/api/imports/mappings/platforms"],
  });

  // Local State
  const [localConfig, setLocalConfig] = useState<ImportConfig | null>(null);
  const [localRomm, setLocalRomm] = useState<RomMConfigInput | null>(null);
  const [bindingEntries, setBindingEntries] = useState<KVEntry[]>([]);
  const [platformSearch, setPlatformSearch] = useState("");
  const [simpleMode, setSimpleMode] = useState(
    () => localStorage.getItem("questarr.rommSimpleMode") !== "false"
  );
  const [showMappingsTable, setShowMappingsTable] = useState(false);

  useEffect(() => {
    if (config) setLocalConfig(config);
  }, [config]);

  useEffect(() => {
    if (rommConfig) {
      const bindings = rommConfig.platformBindings || {};
      setLocalRomm({
        ...rommConfig,
        libraryRoot: rommConfig.libraryRoot || "/data",
        platformRoutingMode: rommConfig.platformRoutingMode || "slug-subfolder",
        platformBindings: bindings,
        moveMode: rommConfig.moveMode || "move",
        conflictPolicy: rommConfig.conflictPolicy || "rename",
        folderNamingTemplate: rommConfig.folderNamingTemplate || "{title}",
        singleFilePlacement: rommConfig.singleFilePlacement || "root",
        multiFilePlacement: "subfolder",
        includeRegionLanguageTags: !!rommConfig.includeRegionLanguageTags,
        allowedSlugs: rommConfig.allowedSlugs,
        bindingMissingBehavior: rommConfig.bindingMissingBehavior || "fallback",
      });
      setBindingEntries(recordToEntries(bindings));
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
    onError: (error: Error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
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
                          Where files are placed after import — used for PC games and any download
                          not handled by the RomM provider.
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

                  {/* Simple/Advanced mode toggle — always interactive */}
                  <div className="flex items-center justify-between border-t pt-4 pb-6">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Advanced Mode</Label>
                      <p className="text-xs text-muted-foreground">
                        Show routing, naming, and conflict options.
                      </p>
                    </div>
                    <Switch
                      checked={!simpleMode}
                      onCheckedChange={(checked) => {
                        setSimpleMode(!checked);
                        localStorage.setItem("questarr.rommSimpleMode", String(!checked));
                      }}
                    />
                  </div>

                  {/* Everything below dims when disabled */}
                  <div
                    className={
                      localRomm.enabled ? undefined : "opacity-50 pointer-events-none select-none"
                    }
                  >
                    <Separator className="mb-6" />

                    {simpleMode && (
                      <p className="text-xs text-muted-foreground mb-4">
                        Files are moved from your download folder into the correct platform
                        subfolder under your RomM library.
                      </p>
                    )}

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
                          Path to your RomM <code>library/roms/</code> folder. Platform subfolders
                          (e.g. <code>ngc/</code>, <code>ps2/</code>) are created here. This is
                          separate from the General Config library root, which is used for PC games.
                        </p>
                      </div>
                    </div>

                    {!simpleMode && (
                      <>
                        <Separator className="mb-6" />

                        {/* ── Platform Routing ── */}
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
                                    <SelectItem value="fallback">
                                      Fallback to slug subfolder
                                    </SelectItem>
                                    <SelectItem value="error">Error</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          )}

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
                      </>
                    )}

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
                      {!simpleMode && (
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
                              <SelectItem value="overwrite">
                                Overwrite — replace existing
                              </SelectItem>
                              <SelectItem value="fail">Fail — abort import</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {!simpleMode && (
                      <>
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
                                setLocalRomm({
                                  ...localRomm,
                                  folderNamingTemplate: e.target.value,
                                })
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
                                <SelectItem value="root">
                                  Root — directly in platform folder
                                </SelectItem>
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
                      </>
                    )}

                    <Separator className="mb-6" />

                    {/* ── Platform Slug Mappings ── */}
                    <div className="mb-6">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowMappingsTable((v) => !v)}
                      >
                        {showMappingsTable ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        Platform Slug Mappings
                        <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">
                          ({platformMappings.length})
                        </span>
                      </button>

                      {showMappingsTable && (
                        <div className="mt-3 rounded-md border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-muted/40">
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                  Questarr (IGDB)
                                </th>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                                  RomM Slug
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {platformMappings.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={2}
                                    className="px-3 py-3 text-center text-muted-foreground"
                                  >
                                    No mappings configured.
                                  </td>
                                </tr>
                              ) : (
                                platformMappings.map((m) => {
                                  const platform = igdbPlatforms.find(
                                    (p) => p.id === m.igdbPlatformId
                                  );
                                  return (
                                    <tr key={m.id} className="border-b last:border-0">
                                      <td className="px-3 py-2 font-mono">
                                        {platform ? (
                                          <span>
                                            <span className="text-foreground">{platform.name}</span>
                                            <span className="ml-1.5 text-muted-foreground/60">
                                              #{m.igdbPlatformId}
                                            </span>
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">
                                            #{m.igdbPlatformId}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 font-mono text-foreground">
                                        {m.rommPlatformName}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
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
                      "Questarr inspects the game's platform. If RomM is enabled and the platform maps to a known RomM slug, the file goes to your RomM library. Otherwise it goes to the General Config library root.",
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
                      name: "Symlink (RomM only)",
                      desc: "Creates a symbolic link in your RomM library pointing back to the original file in your download folder. The file is not duplicated or moved.",
                      when: "Use with RomM when you want your library to reflect downloads in real time without copying files. The torrent keeps seeding. Note: RomM must be able to follow the symlink from its container.",
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
                      desc: "Destination folder for PC games and any game that is not handled by the RomM provider (e.g. because RomM is disabled or the platform is not recognised). Example: /data/library or D:\\Games.",
                    },
                    {
                      name: "Transfer Mode",
                      desc: "How files are transferred to the library root. See Transfer Modes above. Hardlink is recommended when possible.",
                    },
                    {
                      name: "Platform Filter",
                      desc: "Limits PC imports to only the selected platforms. If no platforms are checked, all platforms are imported. This filter only applies to the PC (non-RomM) path — RomM imports use the Allowed Slugs filter instead.",
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

              {/* ── RomM settings ── */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  RomM settings
                </p>
                <div className="space-y-3">
                  {[
                    {
                      name: "Enable RomM Provider",
                      desc: "When enabled, games whose platform maps to a recognised RomM slug are imported into your RomM library instead of the general library. PC games always go to the general library regardless of this switch.",
                    },
                    {
                      name: "Library Root",
                      desc: "The library/roms/ folder that RomM manages. Platform subfolders (e.g. ps2/, ngc/) are created automatically under this path. This must be the same path that RomM itself sees — if RomM is in Docker, use the path inside that container.",
                    },
                    {
                      name: "Routing Mode — Slug subfolder",
                      desc: "Default. Files are placed in <Library Root>/<slug>/ where <slug> is the RomM platform identifier (e.g. ps2, ngc). This matches RomM's default layout and is correct for most setups.",
                    },
                    {
                      name: "Routing Mode — Binding map",
                      desc: "Lets you override the destination path per slug. Useful if you have organised your RomM library into custom folders that do not match the default slugs. Any slug not in the map falls back to slug subfolder behaviour (or errors, depending on Missing Binding setting).",
                    },
                    {
                      name: "Allowed Slugs",
                      desc: "Comma-separated list of slugs that are eligible for RomM import. Leave empty to allow all recognised platforms. Use this to prevent, for example, PC releases from being accidentally routed to RomM.",
                    },
                    {
                      name: "On Conflict",
                      desc: "What happens when a file with the same name already exists at the destination. Rename keeps both (adds a numeric suffix). Skip leaves the existing file untouched. Overwrite replaces it. Fail aborts the import and flags it for manual review.",
                    },
                    {
                      name: "Folder Naming Template",
                      desc: "For multi-file games, a subfolder is created inside the platform folder. This template controls its name. Token: {title} = normalised game title.",
                    },
                    {
                      name: "Single-File Placement",
                      desc: "Controls where a single-file game (e.g. a single .iso) lands. Root places it directly in the platform folder. Subfolder wraps it in a named subfolder the same way multi-file games are handled — useful for consistency.",
                    },
                    {
                      name: "Include Region / Language Tags",
                      desc: "When enabled, region and language codes extracted from the release name (e.g. (USA), (En,Fr)) are appended to the imported file name.",
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
                      title: "All-in-one (single host, no RomM)",
                      steps: [
                        "Enable Post-Processing.",
                        "Set Library Root to where you want games stored (e.g. /data/library).",
                        "Set Transfer Mode to Hardlink if the download folder is on the same volume, otherwise Copy.",
                        "Leave Path Mappings empty.",
                      ],
                    },
                    {
                      title: "Questarr + RomM in separate Docker containers",
                      steps: [
                        "Enable Post-Processing and Enable RomM Provider.",
                        "Set RomM Library Root to the path Questarr uses to reach RomM's library/roms/ folder (the Questarr-side mount, e.g. /mnt/romm/library/roms).",
                        "Add a Path Mapping so the download client's path is translated to a path Questarr can read.",
                        "Set Transfer Mode to Hardlink (if all volumes are on the same device) or Copy.",
                        "After import, trigger a library scan in the RomM UI — Questarr does not do this automatically.",
                      ],
                    },
                    {
                      title: "Mixed library (RomM for retro, general folder for PC)",
                      steps: [
                        "Enable both Post-Processing and RomM Provider.",
                        "Set Allowed Slugs to the retro platform slugs you use (e.g. ps2, snes, n64). Leave PC out of this list.",
                        "Set the General Config Library Root for PC games.",
                        "PC downloads will route to the general library; everything in Allowed Slugs goes to RomM.",
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
