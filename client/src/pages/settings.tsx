import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  Key,
  RefreshCw,
  Search,
  Download,
  AlertCircle,
  Gauge,
  Eye,
  EyeOff,
  HelpCircle,
  Newspaper,
  Lock,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Gamepad2,
  Webhook,
  Ban,
  Trash2,
} from "lucide-react";
import { SiNexusmods } from "react-icons/si";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PathBrowser } from "@/components/PathBrowser";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, clearSearchCache } from "@/lib/queryClient";
import AutoDownloadRulesSettings from "@/components/AutoDownloadRulesSettings";
import PreferredReleaseGroupsSettings from "@/components/PreferredReleaseGroupsSettings";
import PasswordSettings from "@/components/PasswordSettings";
import type { Config, UserSettings, DownloadRules, ReleaseBlacklist } from "@shared/schema";
import { downloadRulesSchema } from "@shared/schema";
import { parseJsonStringArray, CANONICAL_PLATFORMS } from "@shared/title-utils";
import { useState, useEffect, useRef, useMemo } from "react";

interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
  valid: boolean;
}
export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: config,
    isLoading: configLoading,
    error: configError,
  } = useQuery<Config>({
    queryKey: ["/api/config"],
  });

  const { data: igdbSettings } = useQuery<{
    configured: boolean;
    source?: "env" | "database";
    clientId?: string;
  }>({
    queryKey: ["/api/settings/igdb"],
    queryFn: () => apiRequest("GET", "/api/settings/igdb").then((res) => res.json()),
  });

  const {
    data: userSettings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
    retry: 3, // Retry up to 3 times as migrations might be running
  });

  const { data: user } = useQuery<{ id: string; username: string; steamId64?: string }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: blacklistEntries, isLoading: blacklistLoading } = useQuery<
    (ReleaseBlacklist & { gameTitle: string })[]
  >({
    queryKey: ["/api/blacklist"],
  });

  const removeBlacklistMutation = useMutation({
    mutationFn: async ({ gameId, id }: { gameId: string; id: string }) => {
      await apiRequest("DELETE", `/api/games/${gameId}/blacklist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blacklist"] });
      toast({ description: "Release removed from blacklist" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to remove from blacklist" });
    },
  });

  const blacklistByGame = useMemo(() => {
    if (!blacklistEntries) return {};
    return blacklistEntries.reduce<Record<string, (ReleaseBlacklist & { gameTitle: string })[]>>(
      (acc, entry) => {
        (acc[entry.gameTitle] ??= []).push(entry);
        return acc;
      },
      {}
    );
  }, [blacklistEntries]);

  // Local state for form
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(true);
  const [autoSearchUnreleased, setAutoSearchUnreleased] = useState(false);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [notifyMultipleDownloads, setNotifyMultipleDownloads] = useState(true);
  const [notifyUpdates, setNotifyUpdates] = useState(true);
  const [searchIntervalHours, setSearchIntervalHours] = useState(6);
  const [igdbRateLimitPerSecond, setIgdbRateLimitPerSecond] = useState(3);

  // Local state for Steam form
  const [steamIdInput, setSteamIdInput] = useState("");

  // Local state for forms
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [downloadRules, setDownloadRules] = useState<DownloadRules | null>(null);
  const [preferredReleaseGroups, setPreferredReleaseGroups] = useState<string[]>([]);
  const [filterByPreferredGroups, setFilterByPreferredGroups] = useState(false);
  const [preferredPlatform, setPreferredPlatform] = useState<string>("");
  const [xrelSceneReleases, setXrelSceneReleases] = useState(true);
  const [xrelP2pReleases, setXrelP2pReleases] = useState(false);
  const [xrelApiBase, setXrelApiBase] = useState("");
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [showDiscordWebhook, setShowDiscordWebhook] = useState(false);
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [showNexusApiKey, setShowNexusApiKey] = useState(false);

  // Sync with fetched settings
  useEffect(() => {
    if (userSettings) {
      setAutoSearchEnabled(userSettings.autoSearchEnabled);
      setAutoSearchUnreleased(userSettings.autoSearchUnreleased ?? false);
      setAutoDownloadEnabled(userSettings.autoDownloadEnabled);
      setNotifyMultipleDownloads(userSettings.notifyMultipleDownloads);
      setNotifyUpdates(userSettings.notifyUpdates);
      setSearchIntervalHours(userSettings.searchIntervalHours);
      setIgdbRateLimitPerSecond(userSettings.igdbRateLimitPerSecond);

      // Parse download rules from JSON string
      if (userSettings.downloadRules) {
        try {
          const parsed = JSON.parse(userSettings.downloadRules);
          const validated = downloadRulesSchema.parse(parsed);
          setDownloadRules(validated);
        } catch (error) {
          console.warn("Failed to parse download rules", error);
          setDownloadRules(null);
        }
      } else {
        setDownloadRules(null);
      }
      setPreferredReleaseGroups(parseJsonStringArray(userSettings.preferredReleaseGroups));
      setFilterByPreferredGroups(userSettings.filterByPreferredGroups ?? false);
      setPreferredPlatform(userSettings.preferredPlatform ?? "");
      setXrelSceneReleases(userSettings.xrelSceneReleases ?? true);
      setXrelP2pReleases(userSettings.xrelP2pReleases ?? false);
    }
    if (config?.xrel?.apiBase !== undefined) {
      setXrelApiBase(config.xrel.apiBase);
    }

    if (igdbSettings?.clientId) {
      setIgdbClientId(igdbSettings.clientId);
    }
    if (igdbSettings?.configured) {
      setIgdbClientSecret("");
    }
    if (user?.steamId64) {
      setSteamIdInput(user.steamId64);
    }
  }, [userSettings, config, igdbSettings, user]);

  // SSL Settings State
  const [sslEnabled, setSslEnabled] = useState(false);
  const [sslPort, setSslPort] = useState(9898);
  const [sslCertPath, setSslCertPath] = useState("");
  const [sslKeyPath, setSslKeyPath] = useState("");
  const [sslRedirectHttp, setSslRedirectHttp] = useState(false);

  const { data: sslSettings } = useQuery({
    queryKey: ["/api/settings/ssl"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings/ssl");
      return res.json();
    },
  });

  const { data: discordSettings } = useQuery<{ configured: boolean; webhookUrl?: string }>({
    queryKey: ["/api/settings/discord"],
    queryFn: () => apiRequest("GET", "/api/settings/discord").then((r) => r.json()),
  });

  // Populate Discord webhook input with the stored URL when it loads
  useEffect(() => {
    if (discordSettings?.webhookUrl) {
      setDiscordWebhookUrl(discordSettings.webhookUrl);
    }
  }, [discordSettings?.webhookUrl]);

  const { data: nexusmodsSettings } = useQuery<{
    configured: boolean;
    source?: "env" | "database";
  }>({
    queryKey: ["/api/settings/nexusmods"],
    queryFn: () => apiRequest("GET", "/api/settings/nexusmods").then((r) => r.json()),
  });

  const updateDiscordMutation = useMutation({
    mutationFn: async (webhookUrl: string) => {
      const res = await apiRequest("POST", "/api/settings/discord", { webhookUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/discord"] });
      toast({ title: "Discord webhook saved" });
    },
    onError: () => {
      toast({ title: "Failed to save Discord webhook", variant: "destructive" });
    },
  });

  const updateNexusMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await apiRequest("POST", "/api/settings/nexusmods", { apiKey });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/nexusmods"] });
      setNexusApiKey("");
      toast({ title: "Nexus Mods API key saved" });
    },
    onError: () => {
      toast({ title: "Failed to save Nexus Mods API key", variant: "destructive" });
    },
  });

  const handleSaveNexus = () => {
    if (!nexusApiKey.trim()) return;
    updateNexusMutation.mutate(nexusApiKey.trim());
  };

  const [certInfo, setCertInfo] = useState<CertInfo | null>(null); // State for cert info
  const [isCertBrowserOpen, setIsCertBrowserOpen] = useState(false);
  const [isKeyBrowserOpen, setIsKeyBrowserOpen] = useState(false);

  useEffect(() => {
    if (sslSettings) {
      setSslEnabled(sslSettings.enabled);
      setSslPort(sslSettings.port);
      setSslCertPath(sslSettings.certPath || "");
      setSslKeyPath(sslSettings.keyPath || "");
      setSslRedirectHttp(sslSettings.redirectHttp);
      setCertInfo(sslSettings.certInfo);
    }
  }, [sslSettings]);

  const [selectedCert, setSelectedCert] = useState<File | null>(null);
  const [selectedKey, setSelectedKey] = useState<File | null>(null);
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const uploadCertMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCert || !selectedKey) throw new Error("Please select both files");

      const formData = new FormData();
      formData.append("cert", selectedCert);
      formData.append("key", selectedKey);

      const res = await fetch("/api/settings/ssl/upload", {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to upload certificate");
      }

      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Certificate Uploaded",
        description: data.message,
      });
      setSslCertPath(data.certPath);
      setSslKeyPath(data.keyPath);
      setSelectedCert(null);
      setSelectedKey(null);
      // Reset file inputs
      if (certInputRef.current) certInputRef.current.value = "";
      if (keyInputRef.current) keyInputRef.current.value = "";
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSslMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/ssl", {
        enabled: sslEnabled,
        port: sslPort,
        certPath: sslCertPath,
        keyPath: sslKeyPath,
        redirectHttp: sslRedirectHttp,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "SSL Settings Saved",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ssl"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateCertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/ssl/generate");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Certificate Generated",
        description: data.message,
      });
      setSslCertPath(data.certPath);
      setSslKeyPath(data.keyPath);
    },
    onError: (error: Error) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveSsl = () => {
    updateSslMutation.mutate();
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async ({
      updates,
      successMessage,
    }: {
      updates: Partial<UserSettings>;
      successMessage: string;
    }) => {
      const res = await apiRequest("PATCH", "/api/settings", updates);

      // Check if response is HTML (which means the route wasn't found and Vite served index.html)
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("API route not found. Please restart the server to apply changes.");
      }

      return { data: await res.json(), successMessage };
    },
    onSuccess: (data) => {
      toast({
        title: "Settings Updated",
        description: data.successMessage,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      console.error("Settings update error:", error);

      let message = error.message;
      if (message.includes("Unexpected token") || message.includes("JSON")) {
        message = "Server response invalid. Please restart the server.";
      }

      toast({
        title: "Update Failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const updateIgdbMutation = useMutation({
    mutationFn: async () => {
      const payload: { clientId: string; clientSecret?: string } = {
        clientId: igdbClientId,
      };
      if (igdbClientSecret) {
        payload.clientSecret = igdbClientSecret;
      }
      const res = await apiRequest("POST", "/api/settings/igdb", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "IGDB Updated",
        description: "Your IGDB credentials have been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/igdb"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const refreshMetadataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/games/refresh-metadata");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Metadata Refresh",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Metadata Refresh Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = configLoading || settingsLoading;
  const error = configError;

  const handleSaveAutoSearch = () => {
    updateSettingsMutation.mutate({
      updates: {
        autoSearchEnabled,
        autoSearchUnreleased,
        autoDownloadEnabled,
        notifyMultipleDownloads,
        notifyUpdates,
        searchIntervalHours,
        preferredPlatform: preferredPlatform || null,
      },
      successMessage: "Your auto-search preferences have been saved.",
    });
  };

  const handleSaveAdvanced = () => {
    updateSettingsMutation.mutate({
      updates: {
        igdbRateLimitPerSecond,
      },
      successMessage: "Advanced settings have been saved.",
    });
  };

  const saveXrelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings/xrel", {
        apiBase: xrelApiBase.trim() || undefined,
        xrelSceneReleases,
        xrelP2pReleases,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Settings Updated",
        description: "xREL.to options have been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveXrel = () => {
    saveXrelMutation.mutate();
  };

  const handleSaveIgdb = () => {
    const isAlreadyConfigured = igdbSettings?.configured === true;
    const bothCredentialsProvided = !!(igdbClientId && igdbClientSecret);
    const partialUpdateAllowed = isAlreadyConfigured && !!(igdbClientId || igdbClientSecret);
    const canSave = bothCredentialsProvided || partialUpdateAllowed;
    if (!canSave) {
      toast({
        title: "Missing Credentials",
        description: "Please provide both Client ID and Client Secret.",
        variant: "destructive",
      });
      return;
    }
    updateIgdbMutation.mutate();
  };

  const updateSteamIdMutation = useMutation({
    mutationFn: async (steamId: string) => {
      const res = await apiRequest("PUT", "/api/user/steam-id", { steamId });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Steam ID Updated",
        description: "Your Steam ID has been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSaveSteamId = () => {
    if (!steamIdInput) return;
    updateSteamIdMutation.mutate(steamIdInput);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading configuration...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Configuration</CardTitle>
            <CardDescription>Failed to load configuration. Please try again later.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configure your preferences and system settings
        </p>
      </div>

      <div className="w-full space-y-6">
        {/* Database Migration Alert */}
        {settingsError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Database Migration Required</AlertTitle>
            <AlertDescription>
              The user settings table hasn't been created yet. Please run{" "}
              <code className="px-1 py-0.5 bg-muted rounded">npm run db:migrate</code> to update the
              database schema, then restart the server.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="mb-8 flex w-full flex-nowrap overflow-x-auto [&>*]:shrink-0">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="blacklist">Blacklist</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            {/* Auto-Search Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Search className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Auto-Search & Download</CardTitle>
                </div>
                <CardDescription>
                  Automatically search for and download releases for wanted games
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {/* Auto Search Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-search" className="text-sm font-medium">
                        Enable Auto-Search
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Periodically search indexers for wanted games
                      </p>
                    </div>
                    <Switch
                      id="auto-search"
                      checked={autoSearchEnabled}
                      onCheckedChange={setAutoSearchEnabled}
                    />
                  </div>

                  {/* Search Interval */}
                  {autoSearchEnabled && (
                    <div className="space-y-2 pl-4 border-l-2">
                      <Label htmlFor="search-interval" className="text-sm font-medium">
                        Search Interval (hours)
                      </Label>
                      <Input
                        id="search-interval"
                        type="number"
                        min="1"
                        max="168"
                        value={searchIntervalHours}
                        onChange={(e) => setSearchIntervalHours(parseInt(e.target.value) || 6)}
                        className="w-32"
                      />
                      <p className="text-xs text-muted-foreground">
                        How often to search for new releases (1-168 hours)
                      </p>
                    </div>
                  )}

                  {/* Auto Search Unreleased Toggle */}
                  {autoSearchEnabled && (
                    <div className="flex items-center justify-between pl-4 border-l-2">
                      <div className="space-y-0.5">
                        <Label htmlFor="auto-search-unreleased" className="text-sm font-medium">
                          Search Unreleased Games
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Include unreleased (upcoming/delayed) games in search
                        </p>
                      </div>
                      <Switch
                        id="auto-search-unreleased"
                        checked={autoSearchUnreleased}
                        onCheckedChange={setAutoSearchUnreleased}
                      />
                    </div>
                  )}

                  {/* Auto Download Toggle */}
                  {autoSearchEnabled && (
                    <div className="flex items-center justify-between pl-4 border-l-2">
                      <div className="space-y-0.5">
                        <Label htmlFor="auto-download" className="text-sm font-medium">
                          Auto-Download Single Releases
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Automatically download when only one release is found
                        </p>
                      </div>
                      <Switch
                        id="auto-download"
                        checked={autoDownloadEnabled}
                        onCheckedChange={setAutoDownloadEnabled}
                      />
                    </div>
                  )}

                  {/* Notify Multiple Downloads */}
                  {autoSearchEnabled && (
                    <div className="flex items-center justify-between pl-4 border-l-2">
                      <div className="space-y-0.5">
                        <Label htmlFor="notify-multiple" className="text-sm font-medium">
                          Notify on Multiple Releases
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Get notified when multiple releases are available
                        </p>
                      </div>
                      <Switch
                        id="notify-multiple"
                        checked={notifyMultipleDownloads}
                        onCheckedChange={setNotifyMultipleDownloads}
                      />
                    </div>
                  )}

                  {/* Notify Updates */}
                  {autoSearchEnabled && (
                    <div className="flex items-center justify-between pl-4 border-l-2">
                      <div className="space-y-0.5">
                        <Label htmlFor="notify-updates" className="text-sm font-medium">
                          Notify on Game Updates
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Get notified when updates/patches are found
                        </p>
                      </div>
                      <Switch
                        id="notify-updates"
                        checked={notifyUpdates}
                        onCheckedChange={setNotifyUpdates}
                      />
                    </div>
                  )}
                </div>

                {/* Preferred Platform */}
                <div className="space-y-2 pt-4 border-t">
                  <Label htmlFor="preferred-platform" className="text-sm font-medium">
                    Preferred Platform
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Pre-filter results to this platform in the download dialog and auto-search. PC
                    also matches releases with no explicit platform tag.
                  </p>
                  <Select
                    value={preferredPlatform || "__none__"}
                    onValueChange={(v) => setPreferredPlatform(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger id="preferred-platform" className="w-48">
                      <SelectValue placeholder="No preference" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No preference</SelectItem>
                      {CANONICAL_PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end pt-4 border-t">
                  <Button
                    onClick={handleSaveAutoSearch}
                    disabled={updateSettingsMutation.isPending}
                    className="gap-2"
                  >
                    {updateSettingsMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Save Auto-Search
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules" className="space-y-6">
            <AutoDownloadRulesSettings
              rules={downloadRules}
              onChange={setDownloadRules}
              onReset={() => setDownloadRules(null)}
            />
            <PreferredReleaseGroupsSettings
              preferredGroups={preferredReleaseGroups}
              filterByPreferredGroups={filterByPreferredGroups}
              onGroupsChange={setPreferredReleaseGroups}
              onFilterChange={setFilterByPreferredGroups}
            />
          </TabsContent>

          <TabsContent value="services" className="space-y-6">
            {/* Steam Integration Card */}
            <Card id="steam-config">
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Gamepad2 className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Steam Integration</CardTitle>
                </div>
                <CardDescription>Sync your Steam Wishlist with Questarr.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="steam-id">Steam ID (64-bit)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="steam-id"
                        placeholder="76561198..."
                        value={steamIdInput}
                        onChange={(e) => setSteamIdInput(e.target.value)}
                      />
                      <Button
                        onClick={handleSaveSteamId}
                        disabled={updateSteamIdMutation.isPending}
                      >
                        {updateSteamIdMutation.isPending ? "Saving..." : "Save ID"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter your SteamID64 to sync your wishlist. You can find it on{" "}
                      <a
                        href="https://steamid.io"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        steamid.io
                      </a>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Nexus Mods Card */}
            <Card id="nexusmods-config">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <SiNexusmods className="h-5 w-5 text-amber-500" />
                    <CardTitle className="text-lg">Nexus Mods</CardTitle>
                  </div>
                  {nexusmodsSettings?.configured ? (
                    <Badge
                      variant={nexusmodsSettings.source === "database" ? "default" : "secondary"}
                    >
                      {nexusmodsSettings.source === "database"
                        ? "Database (Active)"
                        : "Environment Variable"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not Configured</Badge>
                  )}
                </div>
                <CardDescription>
                  Display trending mods and verify if your games have a Nexus Mods section.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nexus-api-key">Personal API Key</Label>
                  <div className="relative">
                    <Input
                      id="nexus-api-key"
                      type={showNexusApiKey ? "text" : "password"}
                      placeholder={
                        nexusmodsSettings?.configured
                          ? "Enter a new key to override the current one"
                          : "Enter your Nexus Mods API key"
                      }
                      value={nexusApiKey}
                      onChange={(e) => setNexusApiKey(e.target.value)}
                      className="pr-10"
                    />
                    {nexusApiKey && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowNexusApiKey(!showNexusApiKey)}
                        aria-label={showNexusApiKey ? "Hide API key" : "Show API key"}
                      >
                        {showNexusApiKey ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get your personal API key on the{" "}
                    <a
                      href="https://www.nexusmods.com/users/myaccount?tab=api"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Nexus Mods account page
                    </a>
                    . Rate limits: 500 req/hour, 20,000 req/day.
                    {nexusmodsSettings?.source === "env" && (
                      <span className="block mt-1">
                        A key is configured via the <code>NEXUSMODS_API_KEY</code> environment
                        variable. Saving a key here will override it.
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex justify-end pt-2 border-t">
                  <Button
                    onClick={handleSaveNexus}
                    disabled={updateNexusMutation.isPending || !nexusApiKey.trim()}
                    className="gap-2"
                  >
                    {updateNexusMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4" />
                        Save API Key
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* IGDB Card */}
            <Card id="igdb-config">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Key className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">IGDB API</CardTitle>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full">
                          <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          <span className="sr-only">How to get credentials</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80">
                        <div className="space-y-2 text-sm">
                          <h4 className="font-bold">How to get IGDB credentials:</h4>
                          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                            <li>
                              Go to the{" "}
                              <a
                                href="https://dev.twitch.tv/console"
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline"
                              >
                                Twitch Developer Portal
                              </a>
                            </li>
                            <li>Register a new application (name it 'Questarr')</li>
                            <li>
                              Set Redirect URI to{" "}
                              <code className="bg-muted px-1">http://localhost</code>
                            </li>
                            <li>Select 'Application Integration' as category</li>
                            <li>
                              Copy the <strong>Client ID</strong>
                            </li>
                            <li>
                              Click 'New Secret' to get your <strong>Client Secret</strong>
                            </li>
                          </ol>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <CardDescription>Twitch/IGDB API integration for game metadata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col space-y-2 pb-4 border-b">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Status</span>
                    {config?.igdb.configured ? (
                      <Badge variant={config.igdb.source === "database" ? "default" : "secondary"}>
                        {config.igdb.source === "database"
                          ? "Database (Active)"
                          : "Environment Variable"}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Not Configured</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Credentials configured here will override environment variables (IGDB_CLIENT_ID,
                    IGDB_CLIENT_SECRET).
                  </p>
                </div>

                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="igdb-client-id">Client ID</Label>
                    <Input
                      id="igdb-client-id"
                      placeholder="Enter your IGDB Client ID"
                      value={igdbClientId}
                      onChange={(e) => setIgdbClientId(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="igdb-client-secret">Client Secret</Label>
                    <div className="relative">
                      <Input
                        id="igdb-client-secret"
                        type={showClientSecret ? "text" : "password"}
                        placeholder={
                          config?.igdb.configured ? "********" : "Enter your IGDB Client Secret"
                        }
                        value={igdbClientSecret}
                        onChange={(e) => setIgdbClientSecret(e.target.value)}
                        className="pr-10"
                      />
                      {igdbClientSecret && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowClientSecret(!showClientSecret)}
                          aria-label={
                            showClientSecret ? "Hide client secret" : "Show client secret"
                          }
                        >
                          {showClientSecret ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t">
                  <Button
                    onClick={handleSaveIgdb}
                    disabled={updateIgdbMutation.isPending}
                    className="gap-2"
                  >
                    {updateIgdbMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4" />
                        Save Credentials
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* xREL.to Search Options */}
            <Card id="xrel-settings">
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Newspaper className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">xREL.to</CardTitle>
                </div>
                <CardDescription>
                  Alert when a wanted game appears on xREL.to (scene/P2P release list). API base URL
                  and search options for the auto-check.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="xrel-api-base" className="text-sm font-medium">
                      API base URL
                    </Label>
                    <Select value={xrelApiBase} onValueChange={setXrelApiBase}>
                      <SelectTrigger id="xrel-api-base" className="w-full font-mono text-sm">
                        <SelectValue placeholder="Select API base URL" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="https://xrel-api.nfos.to">
                          https://xrel-api.nfos.to (Mirror - Recommended)
                        </SelectItem>
                        <SelectItem value="https://api.xrel.to">
                          https://api.xrel.to (Official - Often blocked)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Use the mirror if your IP is blocked by Cloudflare on the official API.
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="xrel-scene" className="text-sm font-medium">
                        Include scene releases
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Search scene releases when checking for wanted games on xREL.to
                      </p>
                    </div>
                    <Switch
                      id="xrel-scene"
                      checked={xrelSceneReleases}
                      onCheckedChange={setXrelSceneReleases}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="xrel-p2p" className="text-sm font-medium">
                        Include P2P releases
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Search P2P releases when checking for wanted games on xREL.to
                      </p>
                    </div>
                    <Switch
                      id="xrel-p2p"
                      checked={xrelP2pReleases}
                      onCheckedChange={setXrelP2pReleases}
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-4 border-t">
                  <Button
                    onClick={handleSaveXrel}
                    disabled={saveXrelMutation.isPending}
                    className="gap-2"
                  >
                    {saveXrelMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Newspaper className="h-4 w-4" />
                        Save xREL.to options
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Advanced Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Gauge className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Advanced</CardTitle>
                </div>
                <CardDescription>
                  Advanced performance and API settings. Change these only if needed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label htmlFor="igdb-rate-limit" className="text-sm font-medium">
                      IGDB API Rate Limit (requests/second)
                    </Label>
                    <Input
                      id="igdb-rate-limit"
                      type="number"
                      min="1"
                      max="4"
                      value={igdbRateLimitPerSecond}
                      onChange={(e) => setIgdbRateLimitPerSecond(parseInt(e.target.value) || 3)}
                      className="w-32"
                    />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>IGDB allows 4 requests per second.</strong> Default is 3 to be
                        conservative.
                      </p>
                      <p>
                        Only increase if you experience slow loading times and are confident your
                        usage won't exceed the limit.
                      </p>
                      <p className="text-amber-500">
                        ⚠️ Setting too high may result in API blacklisting.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t">
                  <Button
                    onClick={handleSaveAdvanced}
                    disabled={updateSettingsMutation.isPending}
                    className="gap-2"
                  >
                    {updateSettingsMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Save Advanced Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
            {/* Discord Webhook Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Webhook className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">Discord Webhook</CardTitle>
                  </div>
                  {discordSettings?.configured ? (
                    <Badge
                      variant="default"
                      className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    >
                      Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not configured</Badge>
                  )}
                </div>
                <CardDescription>
                  Set a Discord webhook URL to share library stats directly to a Discord channel.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="discord-webhook">Webhook URL</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="discord-webhook"
                        type={showDiscordWebhook ? "text" : "password"}
                        placeholder={
                          discordSettings?.configured
                            ? "Enter new URL to replace existing webhook"
                            : "https://discord.com/api/webhooks/..."
                        }
                        value={discordWebhookUrl}
                        onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowDiscordWebhook((v) => !v)}
                      >
                        {showDiscordWebhook ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <Button
                      onClick={() => updateDiscordMutation.mutate(discordWebhookUrl)}
                      disabled={updateDiscordMutation.isPending || !discordWebhookUrl.trim()}
                    >
                      {updateDiscordMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Create a webhook in your Discord server under Channel Settings → Integrations.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="account" className="space-y-6">
            <PasswordSettings />
          </TabsContent>

          <TabsContent value="system" className="space-y-6">
            {/* Application Management */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Server className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Maintenance</CardTitle>
                </div>
                <CardDescription>Application maintenance and data management tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Clear Downloads Cache</p>
                      <p className="text-xs text-muted-foreground">
                        Clear cached torrent/NZB search results so the next search fetches fresh
                        data from all configured indexers.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearSearchCache();
                        toast({
                          title: "Downloads Cache Cleared",
                          description:
                            "Search results cache has been cleared. New searches will fetch fresh data.",
                        });
                      }}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Clear Cache
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Refresh Metadata</p>
                      <p className="text-xs text-muted-foreground">
                        Update all games in your library with the latest information from IGDB.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refreshMetadataMutation.mutate()}
                      disabled={refreshMetadataMutation.isPending}
                      className="gap-2"
                    >
                      {refreshMetadataMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Refresh All
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">SSL/HTTPS Configuration</CardTitle>
                </div>
                <CardDescription>
                  Configure secure access to Questarr. Requires server restart to apply changes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {sslSettings && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="ssl-enabled" className="text-sm font-medium">
                          Enable SSL
                        </Label>
                        <p className="text-xs text-muted-foreground">Turn on HTTPS support</p>
                      </div>
                      <Switch
                        id="ssl-enabled"
                        checked={sslEnabled}
                        onCheckedChange={setSslEnabled}
                      />
                    </div>

                    {sslEnabled && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="ssl-port">SSL Port</Label>
                          <Input
                            id="ssl-port"
                            type="number"
                            value={sslPort}
                            disabled
                            className="w-32 bg-muted"
                          />
                          <p className="text-xs text-muted-foreground">
                            Configured via SSL_PORT environment variable (e.g., in
                            docker-compose.yml) - Default: 9898
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="cert-path">Certificate Path (.crt/.pem)</Label>
                          <div className="flex gap-2">
                            <Input
                              id="cert-path"
                              value={sslCertPath}
                              onChange={(e) => setSslCertPath(e.target.value)}
                              placeholder="/path/to/server.crt"
                            />
                            <Button variant="outline" onClick={() => setIsCertBrowserOpen(true)}>
                              Browse
                            </Button>
                          </div>
                          <PathBrowser
                            isOpen={isCertBrowserOpen}
                            onClose={() => setIsCertBrowserOpen(false)}
                            onSelect={(path) => setSslCertPath(path)}
                            initialPath={sslCertPath}
                            title="Select Certificate File"
                            extensions={[".crt", ".pem", ".cer"]}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="key-path">Private Key Path (.key)</Label>
                          <div className="flex gap-2">
                            <Input
                              id="key-path"
                              value={sslKeyPath}
                              onChange={(e) => setSslKeyPath(e.target.value)}
                              placeholder="/path/to/server.key"
                            />
                            <Button variant="outline" onClick={() => setIsKeyBrowserOpen(true)}>
                              Browse
                            </Button>
                          </div>
                          <PathBrowser
                            isOpen={isKeyBrowserOpen}
                            onClose={() => setIsKeyBrowserOpen(false)}
                            onSelect={(path) => setSslKeyPath(path)}
                            initialPath={sslKeyPath}
                            title="Select Private Key File"
                            extensions={[".key", ".pem"]}
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label htmlFor="ssl-redirect">Force HTTPS</Label>
                              <p className="text-xs text-muted-foreground">
                                Redirect all HTTP traffic to HTTPS
                              </p>
                            </div>
                            <Switch
                              id="ssl-redirect"
                              checked={sslRedirectHttp}
                              onCheckedChange={setSslRedirectHttp}
                            />
                          </div>

                          {sslRedirectHttp && (
                            <Alert className="border-orange-500/50 bg-orange-500/10">
                              <AlertCircle className="h-4 w-4 text-orange-500" />
                              <AlertTitle>HTTP Port Will Be Disabled</AlertTitle>
                              <AlertDescription>
                                When HTTPS redirect is enabled, the HTTP port will be disabled on
                                the next server restart. Make sure you can access the server via
                                HTTPS before restarting to avoid losing access.
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>

                        <div className="pt-4 border-t">
                          <h4 className="text-sm font-medium mb-4">Certificate Status</h4>

                          {certInfo ? (
                            <div className="rounded-md border bg-card text-card-foreground shadow-sm mb-6 p-4 space-y-3">
                              <div className="flex items-center gap-2 mb-2">
                                {certInfo.valid ? (
                                  <ShieldCheck className="h-5 w-5 text-green-500" />
                                ) : (
                                  <ShieldAlert className="h-5 w-5 text-red-500" />
                                )}
                                <span className="font-semibold">
                                  {certInfo.selfSigned
                                    ? "Self-Signed Certificate"
                                    : "Valid Certificate"}
                                </span>
                              </div>

                              <div className="grid gap-1 text-sm text-muted-foreground">
                                <div className="flex justify-between">
                                  <span>Issued To:</span>
                                  <span className="font-mono text-xs">
                                    {certInfo.subject ? certInfo.subject.split(",")[0] : "Unknown"}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Issued By:</span>
                                  <span className="font-mono text-xs">
                                    {certInfo.issuer ? certInfo.issuer.split(",")[0] : "Unknown"}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    <span>Valid Until:</span>
                                  </div>
                                  <span>
                                    {certInfo.validTo
                                      ? new Date(certInfo.validTo).toLocaleDateString()
                                      : "Unknown"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground mb-4">
                              No valid certificate information found.
                            </p>
                          )}

                          <div className="space-y-4">
                            {certInfo?.selfSigned ? (
                              <div>
                                <p className="text-xs text-muted-foreground mb-2">
                                  You are using a self-signed certificate. You can renew it if it's
                                  expired or about to expire.
                                </p>
                                <Button
                                  variant="outline"
                                  onClick={() => generateCertMutation.mutate()}
                                  disabled={generateCertMutation.isPending}
                                >
                                  {generateCertMutation.isPending
                                    ? "Renewing..."
                                    : "Renew Self-Signed Certificate"}
                                </Button>
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs text-muted-foreground mb-2">
                                  Generate a self-signed certificate if you don't have one.
                                  <br />
                                  <span className="text-amber-500 font-semibold">
                                    Warning:
                                  </span>{" "}
                                  Browsers will show a security warning for self-signed
                                  certificates.
                                </p>
                                <Button
                                  variant="outline"
                                  onClick={() => generateCertMutation.mutate()}
                                  disabled={
                                    generateCertMutation.isPending ||
                                    (!!certInfo && !certInfo.selfSigned)
                                  }
                                >
                                  {generateCertMutation.isPending
                                    ? "Generating..."
                                    : "Generate Self-Signed Certificate"}
                                </Button>
                                {!!certInfo && !certInfo.selfSigned && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Certificate generation disabled because a non-self-signed
                                    certificate is detected.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="pt-4 border-t space-y-4">
                          <h4 className="text-sm font-medium">Upload Certificate</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="cert-upload">Certificate File (.crt/.pem)</Label>
                              <div className="flex items-center gap-2">
                                <Input
                                  id="cert-upload"
                                  type="file"
                                  accept=".crt,.pem,.cer"
                                  className="hidden"
                                  ref={certInputRef}
                                  onChange={(e) => setSelectedCert(e.target.files?.[0] || null)}
                                />
                                <Label
                                  htmlFor="cert-upload"
                                  className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${selectedCert ? "text-primary border-primary" : "text-muted-foreground"}`}
                                >
                                  <Upload className="mr-2 h-4 w-4" />
                                  {selectedCert ? selectedCert.name : "Select Certificate File"}
                                </Label>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="key-upload">Private Key File (.key/.pem)</Label>
                              <div className="flex items-center gap-2">
                                <Input
                                  id="key-upload"
                                  type="file"
                                  accept=".key,.pem"
                                  className="hidden"
                                  ref={keyInputRef}
                                  onChange={(e) => setSelectedKey(e.target.files?.[0] || null)}
                                />
                                <Label
                                  htmlFor="key-upload"
                                  className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${selectedKey ? "text-primary border-primary" : "text-muted-foreground"}`}
                                >
                                  <Upload className="mr-2 h-4 w-4" />
                                  {selectedKey ? selectedKey.name : "Select Private Key File"}
                                </Label>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => uploadCertMutation.mutate()}
                            disabled={!selectedCert || !selectedKey || uploadCertMutation.isPending}
                          >
                            {uploadCertMutation.isPending
                              ? "Uploading..."
                              : "Upload Certificate & Key"}
                          </Button>
                        </div>
                      </>
                    )}

                    <div className="flex justify-end pt-4 border-t">
                      <Button onClick={handleSaveSsl} disabled={updateSslMutation.isPending}>
                        {updateSslMutation.isPending ? "Saving..." : "Save SSL Settings"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="blacklist" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ban className="h-5 w-5" />
                  Blacklisted Releases
                </CardTitle>
                <CardDescription>
                  Releases hidden from search results. They will not appear in game download
                  searches or be auto-downloaded.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {blacklistLoading ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : !blacklistEntries || blacklistEntries.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No blacklisted releases.</div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(blacklistByGame).map(([gameTitle, entries]) => (
                      <div key={gameTitle}>
                        <h4 className="text-sm font-semibold mb-2">{gameTitle}</h4>
                        <div className="space-y-2">
                          {entries.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between rounded-md border p-3"
                            >
                              <div className="space-y-1">
                                <p className="text-sm font-medium leading-none">
                                  {entry.releaseTitle}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {entry.indexerName ? `${entry.indexerName} · ` : ""}
                                  {entry.createdAt
                                    ? new Date(entry.createdAt).toISOString().split("T")[0]
                                    : ""}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeBlacklistMutation.mutate({
                                    gameId: entry.gameId,
                                    id: entry.id,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
