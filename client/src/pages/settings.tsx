import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, Database, Server, Key, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Config } from "@shared/schema";

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    data: config,
    isLoading,
    error,
  } = useQuery<Config>({
    queryKey: ["/api/config"],
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
          <p className="text-muted-foreground">View system configuration (read-only)</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-4xl">
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
