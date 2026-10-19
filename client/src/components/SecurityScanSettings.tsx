import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const REDACTED_PLACEHOLDER = "********";

interface SecurityScanSettingsData {
  virusTotal: {
    enabled: boolean;
    apiKey: string;
    threshold: number;
    blockUnknownHashes: boolean;
  };
  clamav: {
    enabled: boolean;
    host: string;
    port: number;
  };
}

export default function SecurityScanSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<SecurityScanSettingsData>({
    queryKey: ["/api/settings/security-scan"],
  });

  const [local, setLocal] = useState<SecurityScanSettingsData | null>(null);

  useEffect(() => {
    if (settings) setLocal(settings);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: SecurityScanSettingsData) => {
      await apiRequest("POST", "/api/settings/security-scan", data);
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Security scan configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/security-scan"] });
    },
    onError: () => {
      if (settings) setLocal(settings);
      toast({
        title: "Save Failed",
        description: "Could not update security scan settings.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (provider: "virustotal" | "clamav") => {
      await apiRequest("POST", "/api/settings/security-scan/test", { provider });
    },
    onSuccess: (_data, provider) => {
      toast({
        title: "Test Successful",
        description:
          provider === "virustotal"
            ? "VirusTotal API key is valid."
            : "Successfully connected to ClamAV.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Test Failed",
        description: error.message || "Could not reach the provider.",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !local) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The Test buttons hit the server's saved configuration, not these local,
  // possibly-unsaved edits — disable them (rather than silently testing stale
  // values) whenever the form has diverged from what's actually persisted.
  const isDirty = !!settings && JSON.stringify(local) !== JSON.stringify(settings);
  const testDisabled = testMutation.isPending || isDirty;
  const testTitle = isDirty ? "Save your changes before testing" : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">
              Scans downloads for malware before they're unpacked or moved into your library.
            </p>
          </div>

          <Separator />

          {/* ── VirusTotal ── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">VirusTotal (Hash-Based)</Label>
                <p className="text-xs text-muted-foreground">
                  Looks up the SHA-256 hash of the downloaded file against VirusTotal before import.
                  Requires a free VirusTotal API key.
                </p>
              </div>
              <Switch
                checked={local.virusTotal.enabled}
                onCheckedChange={(c) =>
                  setLocal({ ...local, virusTotal: { ...local.virusTotal, enabled: c } })
                }
              />
            </div>

            <div
              className={
                local.virusTotal.enabled ? "space-y-4" : "space-y-4 opacity-50 pointer-events-none"
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="vt-api-key">API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="vt-api-key"
                    type="password"
                    placeholder="Your VirusTotal API key"
                    value={local.virusTotal.apiKey}
                    onFocus={() => {
                      if (local.virusTotal.apiKey === REDACTED_PLACEHOLDER) {
                        setLocal({ ...local, virusTotal: { ...local.virusTotal, apiKey: "" } });
                      }
                    }}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        virusTotal: { ...local.virusTotal, apiKey: e.target.value },
                      })
                    }
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testDisabled}
                    title={testTitle}
                    onClick={() => testMutation.mutate("virustotal")}
                  >
                    Test
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vt-threshold">Detection Threshold</Label>
                <Input
                  id="vt-threshold"
                  type="number"
                  min={0}
                  value={local.virusTotal.threshold}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      virusTotal: {
                        ...local.virusTotal,
                        threshold: Number.parseInt(e.target.value, 10) || 0,
                      },
                    })
                  }
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  Abort the import if more than this many VirusTotal engines flag the file.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Block Unknown Hashes</Label>
                  <p className="text-xs text-muted-foreground">
                    Block files VirusTotal has never scanned before. Disabled by default so new
                    legitimate releases aren't blocked.
                  </p>
                </div>
                <Switch
                  checked={local.virusTotal.blockUnknownHashes}
                  onCheckedChange={(c) =>
                    setLocal({
                      ...local,
                      virusTotal: { ...local.virusTotal, blockUnknownHashes: c },
                    })
                  }
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* ── ClamAV ── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Local ClamAV (Deep Scan)</Label>
                <p className="text-xs text-muted-foreground">
                  Streams downloaded files through a ClamAV daemon for signature-based scanning.
                </p>
                <p className="text-xs text-muted-foreground">
                  A download ClamAV can't fully scan (clamd down, or a file over its size limits)
                  waits in Pending Manual Imports. Raise <code>StreamMaxLength</code>,{" "}
                  <code>MaxFileSize</code> and <code>MaxScanSize</code> in clamd.conf so large game
                  files get scanned.
                </p>
              </div>
              <Switch
                checked={local.clamav.enabled}
                onCheckedChange={(c) =>
                  setLocal({ ...local, clamav: { ...local.clamav, enabled: c } })
                }
              />
            </div>

            <div
              className={
                local.clamav.enabled ? "flex gap-4" : "flex gap-4 opacity-50 pointer-events-none"
              }
            >
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="clamav-host">Host</Label>
                <Input
                  id="clamav-host"
                  placeholder="clamav"
                  value={local.clamav.host}
                  onChange={(e) =>
                    setLocal({ ...local, clamav: { ...local.clamav, host: e.target.value } })
                  }
                />
              </div>
              <div className="space-y-1.5 w-32">
                <Label htmlFor="clamav-port">Port</Label>
                <Input
                  id="clamav-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={local.clamav.port}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      clamav: {
                        ...local.clamav,
                        port: Number.parseInt(e.target.value, 10) || 3310,
                      },
                    })
                  }
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={testDisabled}
                  title={testTitle}
                  onClick={() => testMutation.mutate("clamav")}
                >
                  Test
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={() => saveMutation.mutate(local)} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
