import { useQuery } from "@tanstack/react-query";
import { Settings as SettingsIcon, Database, Server, Key } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Config {
  database: {
    connected: boolean;
    url?: string;
  };
  igdb: {
    configured: boolean;
    clientId?: string;
  };
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };
}

export default function SettingsPage() {
  const { data: config, isLoading, error } = useQuery<Config>({
    queryKey: ["/api/config"],
  });

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
            <CardDescription>
              Failed to load configuration. Please try again later.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center mb-8">
        <SettingsIcon className="h-8 w-8 mr-3" />
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">View system configuration (read-only)</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-4xl">
        {/* Database Configuration */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Database className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Database</CardTitle>
            </div>
            <CardDescription>PostgreSQL database connection status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Status</span>
              <Badge variant={config?.database.connected ? "default" : "destructive"}>
                {config?.database.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            {config?.database.url && (
              <div className="space-y-1">
                <span className="text-sm font-medium">Connection URL</span>
                <p className="text-sm text-muted-foreground font-mono break-all">
                  {config.database.url}
                </p>
              </div>
            )}
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
            {config?.igdb.clientId && (
              <div className="space-y-1">
                <span className="text-sm font-medium">Client ID</span>
                <p className="text-sm text-muted-foreground font-mono">
                  {config.igdb.clientId}
                </p>
              </div>
            )}
            {!config?.igdb.configured && (
              <p className="text-sm text-muted-foreground">
                Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET environment variables to enable IGDB integration.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Server Configuration */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <Server className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Server</CardTitle>
            </div>
            <CardDescription>Application server configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Host</span>
              <span className="text-sm text-muted-foreground font-mono">
                {config?.server.host}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Port</span>
              <span className="text-sm text-muted-foreground font-mono">
                {config?.server.port}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Environment</span>
              <Badge variant={config?.server.nodeEnv === "production" ? "default" : "secondary"}>
                {config?.server.nodeEnv}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
