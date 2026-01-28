import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings as SettingsIcon,
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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import AutoDownloadRulesSettings from "@/components/AutoDownloadRulesSettings";
import PasswordSettings from "@/components/PasswordSettings";
import type { Config, UserSettings, DownloadRules } from "@shared/schema";
import { downloadRulesSchema } from "@shared/schema";
import { useState, useEffect } from "react";

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

  const {
    data: userSettings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
    retry: 3, // Retry up to 3 times as migrations might be running
  });

  // Local state for form
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [notifyMultipleDownloads, setNotifyMultipleDownloads] = useState(true);
  const [notifyUpdates, setNotifyUpdates] = useState(true);
  const [searchIntervalHours, setSearchIntervalHours] = useState(6);
  const [igdbRateLimitPerSecond, setIgdbRateLimitPerSecond] = useState(3);

  // Local state for IGDB form
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [downloadRules, setDownloadRules] = useState<DownloadRules | null>(null);

  // Sync with fetched settings
  useEffect(() => {
    if (userSettings) {
      setAutoSearchEnabled(userSettings.autoSearchEnabled);
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
    }

    if (config?.igdb.clientId) {
      setIgdbClientId(config.igdb.clientId);
    }
  }, [userSettings, config]);

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
      const res = await apiRequest("POST", "/api/settings/igdb", {
        clientId: igdbClientId,
        clientSecret: igdbClientSecret,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "IGDB Updated",
        description: "Your IGDB credentials have been saved.",
      });
      setIgdbClientId("");
      setIgdbClientSecret("");
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
        autoDownloadEnabled,
        notifyMultipleDownloads,
        notifyUpdates,
        searchIntervalHours,
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

  const handleSaveIgdb = () => {
    if (!igdbClientId || !igdbClientSecret) {
      toast({
        title: "Missing Credentials",
        description: "Please provide both Client ID and Client Secret.",
        variant: "destructive",
      });
      return;
    }
    updateIgdbMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading configuration...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
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
    <div className="h-full overflow-auto p-8">
      <div className="flex items-center mb-8">
        <SettingsIcon className="h-8 w-8 mr-3" />
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your preferences and system settings</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-4xl">
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

        {/* IGDB API Configuration */}
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
                    placeholder="Enter your IGDB Client Secret"
                    value={igdbClientSecret}
                    onChange={(e) => setIgdbClientSecret(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowClientSecret(!showClientSecret)}
                  >
                    {showClientSecret ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
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
                    Save Settings
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Auto-Download Rules */}
        <AutoDownloadRulesSettings
          rules={downloadRules}
          onChange={setDownloadRules}
          onReset={() => setDownloadRules(null)}
        />

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
                    Only increase if you experience slow loading times and are confident your usage
                    won't exceed the limit.
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
                    Save Settings
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Password Settings */}
        <PasswordSettings />

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
      </div>
    </div>
  );
}
