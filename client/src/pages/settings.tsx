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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Config, UserSettings } from "@shared/schema";
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
    retry: false, // Don't retry if it fails, so we can show the error
  });

  // Local state for form
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [notifyMultipleTorrents, setNotifyMultipleTorrents] = useState(true);
  const [notifyUpdates, setNotifyUpdates] = useState(true);
  const [searchIntervalHours, setSearchIntervalHours] = useState(6);
  const [igdbRateLimitPerSecond, setIgdbRateLimitPerSecond] = useState(3);

  // Sync with fetched settings
  useEffect(() => {
    if (userSettings) {
      setAutoSearchEnabled(userSettings.autoSearchEnabled);
      setAutoDownloadEnabled(userSettings.autoDownloadEnabled);
      setNotifyMultipleTorrents(userSettings.notifyMultipleTorrents);
      setNotifyUpdates(userSettings.notifyUpdates);
      setSearchIntervalHours(userSettings.searchIntervalHours);
      setIgdbRateLimitPerSecond(userSettings.igdbRateLimitPerSecond);
    }
  }, [userSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<UserSettings>) => {
      const res = await apiRequest("PATCH", "/api/settings", updates);

      // Check if response is HTML (which means the route wasn't found and Vite served index.html)
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("API route not found. Please restart the server to apply changes.");
      }

      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Settings Updated",
        description: "Your auto-search preferences have been saved.",
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

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate({
      autoSearchEnabled,
      autoDownloadEnabled,
      notifyMultipleTorrents,
      notifyUpdates,
      searchIntervalHours,
      igdbRateLimitPerSecond,
    });
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
              <code className="px-1 py-0.5 bg-muted rounded">npm run db:push</code> to create the
              database schema, then restart the server.
            </AlertDescription>
          </Alert>
        )}

        {/* Auto-Search Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Search className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Auto-Search & Download</CardTitle>
            </div>
            <CardDescription>
              Automatically search for and download torrents for wanted games
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
                    How often to search for new torrents (1-168 hours)
                  </p>
                </div>
              )}

              {/* Auto Download Toggle */}
              {autoSearchEnabled && (
                <div className="flex items-center justify-between pl-4 border-l-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-download" className="text-sm font-medium">
                      Auto-Download Single Torrents
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically download when only one torrent is found
                    </p>
                  </div>
                  <Switch
                    id="auto-download"
                    checked={autoDownloadEnabled}
                    onCheckedChange={setAutoDownloadEnabled}
                  />
                </div>
              )}

              {/* Notify Multiple Torrents */}
              {autoSearchEnabled && (
                <div className="flex items-center justify-between pl-4 border-l-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="notify-multiple" className="text-sm font-medium">
                      Notify on Multiple Torrents
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Get notified when multiple torrents are available
                    </p>
                  </div>
                  <Switch
                    id="notify-multiple"
                    checked={notifyMultipleTorrents}
                    onCheckedChange={setNotifyMultipleTorrents}
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
                onClick={handleSaveSettings}
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

        {/* IGDB API Configuration */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Key className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">IGDB API</CardTitle>
            </div>
            <CardDescription>Twitch/IGDB API integration for game metadata</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Status</span>
              <Badge variant={config?.igdb.configured ? "default" : "secondary"}>
                {config?.igdb.configured ? "Configured" : "Not Configured"}
              </Badge>
            </div>
            {!config?.igdb.configured && (
              <p className="text-sm text-muted-foreground">
                Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables to enable IGDB
                integration.
              </p>
            )}
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
                onClick={handleSaveSettings}
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
