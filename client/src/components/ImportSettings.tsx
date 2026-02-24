import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ImportConfig, RomMConfig } from "@shared/schema";
import { PathMappingSettings } from "./PathMappingSettings";
import { PlatformMappingSettings } from "./PlatformMappingSettings";

export default function ImportSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries
  const { data: config, isLoading: configLoading } = useQuery<ImportConfig>({
    queryKey: ["/api/settings/import/config"],
  });
  const { data: rommConfig, isLoading: rommLoading } = useQuery<RomMConfig>({
    queryKey: ["/api/settings/import/romm"],
  });

  // Local State
  const [localConfig, setLocalConfig] = useState<ImportConfig | null>(null);
  const [localRomm, setLocalRomm] = useState<RomMConfig | null>(null);

  useEffect(() => {
    if (config) setLocalConfig(config);
  }, [config]);

  useEffect(() => {
    if (rommConfig) setLocalRomm(rommConfig);
  }, [rommConfig]);

  // Mutations
  const updateConfigMutation = useMutation({
    mutationFn: async (data: ImportConfig) => {
      await apiRequest("PATCH", "/api/settings/import/config", data);
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Import configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/import/config"] });
    },
  });

  const updateRommMutation = useMutation({
    mutationFn: async (data: RomMConfig) => {
      await apiRequest("PATCH", "/api/settings/import/romm", data);
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "RomM configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/import/romm"] });
    },
  });

  if (configLoading || rommLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="config" className="w-full">
        <TabsList>
          <TabsTrigger value="config">General Config</TabsTrigger>
          <TabsTrigger value="romm">RomM Integration</TabsTrigger>
          <TabsTrigger value="paths">Path Mappings</TabsTrigger>
          <TabsTrigger value="platforms">Platform Mappings</TabsTrigger>
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
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Delete Source Files</Label>
                      <div className="text-xs text-muted-foreground">
                        Remove original download after successful import.
                      </div>
                    </div>
                    <Switch
                      checked={localConfig.deleteSource}
                      onCheckedChange={(c) => setLocalConfig({ ...localConfig, deleteSource: c })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Library Root</Label>
                    <Input
                      placeholder="/data"
                      value={localConfig.libraryRoot}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, libraryRoot: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Root path where imported games are stored (e.g. /data or /mnt/library).
                    </p>
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
              <CardTitle>RomM Integration</CardTitle>
              <CardDescription>Connect to RomM (Rom Manager) for library scanning.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {localRomm && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable RomM Integration</Label>
                      <div className="text-xs text-muted-foreground">
                        Trigger RomM scans after import.
                      </div>
                    </div>
                    <Switch
                      checked={localRomm.enabled}
                      onCheckedChange={(c) => setLocalRomm({ ...localRomm, enabled: c })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>RomM URL</Label>
                    <Input
                      placeholder="http://localhost:8080"
                      value={localRomm.url || ""}
                      onChange={(e) => setLocalRomm({ ...localRomm, url: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <Input
                      type="password"
                      placeholder="API Key"
                      value={localRomm.apiKey || ""}
                      onChange={(e) => setLocalRomm({ ...localRomm, apiKey: e.target.value })}
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
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paths" className="space-y-4">
          <PathMappingSettings />
        </TabsContent>

        <TabsContent value="platforms" className="space-y-4">
          <PlatformMappingSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
