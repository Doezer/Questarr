import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Play, Pause, Trash2, Download, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface DownloadStatus {
  id: string;
  name: string;
  status: 'downloading' | 'seeding' | 'completed' | 'paused' | 'error';
  progress: number; // 0-100
  downloadSpeed?: number; // bytes per second
  uploadSpeed?: number; // bytes per second
  eta?: number; // seconds
  size?: number; // total bytes
  downloaded?: number; // bytes downloaded
  seeders?: number;
  leechers?: number;
  ratio?: number;
  error?: string;
  downloaderId: string;
  downloaderName: string;
}

interface DownloaderError {
  downloaderId: string;
  downloaderName: string;
  error: string;
}

interface DownloadsResponse {
  torrents: DownloadStatus[];
  errors: DownloaderError[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + "/s";
}

function formatETA(seconds: number): string {
  if (seconds <= 0) return "∞";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getStatusColor(status: DownloadStatus['status']): string {
  switch (status) {
    case 'downloading':
      return 'bg-blue-500';
    case 'seeding':
      return 'bg-green-500';
    case 'completed':
      return 'bg-green-600';
    case 'paused':
      return 'bg-yellow-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

function getStatusBadgeVariant(status: DownloadStatus['status']): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'downloading':
    case 'seeding':
      return 'default';
    case 'completed':
      return 'outline';
    case 'paused':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default function DownloadsPage() {
  const { toast } = useToast();
  const [hasShownErrors, setHasShownErrors] = useState<Set<string>>(new Set());

  const { data: downloadsData, isLoading, refetch } = useQuery<DownloadsResponse>({
    queryKey: ["/api/downloads"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const downloads = downloadsData?.torrents || [];
  const errors = downloadsData?.errors || [];

  // Show toast notifications for downloader errors
  // Only show each error once per session to avoid spam
  useEffect(() => {
    if (errors.length > 0) {
      errors.forEach((error) => {
        const errorKey = `${error.downloaderId}-${error.error}`;
        if (!hasShownErrors.has(errorKey)) {
          toast({
            title: `Downloader Error: ${error.downloaderName}`,
            description: error.error,
            variant: "destructive",
          });
          setHasShownErrors(prev => {
            const newSet = new Set(prev);
            newSet.add(errorKey);
            return newSet;
          });
        }
      });
    }
  }, [errors, hasShownErrors, toast]);

  const pauseMutation = useMutation({
    mutationFn: async ({ downloaderId, torrentId }: { downloaderId: string; torrentId: string }) => {
      const response = await fetch(`/api/downloaders/${downloaderId}/torrents/${torrentId}/pause`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to pause torrent");
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Torrent paused" });
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      } else {
        toast({ title: result.message || "Failed to pause torrent", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Failed to pause torrent", variant: "destructive" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({ downloaderId, torrentId }: { downloaderId: string; torrentId: string }) => {
      const response = await fetch(`/api/downloaders/${downloaderId}/torrents/${torrentId}/resume`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to resume torrent");
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Torrent resumed" });
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      } else {
        toast({ title: result.message || "Failed to resume torrent", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Failed to resume torrent", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ downloaderId, torrentId, deleteFiles }: { downloaderId: string; torrentId: string; deleteFiles: boolean }) => {
      const response = await fetch(`/api/downloaders/${downloaderId}/torrents/${torrentId}?deleteFiles=${deleteFiles}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to remove torrent");
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Torrent removed" });
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      } else {
        toast({ title: result.message || "Failed to remove torrent", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Failed to remove torrent", variant: "destructive" });
    },
  });

  const handlePause = (download: DownloadStatus) => {
    pauseMutation.mutate({
      downloaderId: download.downloaderId,
      torrentId: download.id,
    });
  };

  const handleResume = (download: DownloadStatus) => {
    resumeMutation.mutate({
      downloaderId: download.downloaderId,
      torrentId: download.id,
    });
  };

  const handleRemove = (download: DownloadStatus, deleteFiles = false) => {
    removeMutation.mutate({
      downloaderId: download.downloaderId,
      torrentId: download.id,
      deleteFiles,
    });
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center space-x-2" data-testid="loading-downloads">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span data-testid="text-loading-downloads">Loading downloads...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Downloads</h1>
          <p className="text-muted-foreground">Monitor and manage active downloads</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {downloads.length > 0 ? (
          downloads.map((download) => (
            <Card key={`${download.downloaderId}-${download.id}`} data-testid={`card-download-${download.id}`}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-lg leading-tight">{download.name}</CardTitle>
                    <CardDescription className="mt-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <Badge variant={getStatusBadgeVariant(download.status)} className="capitalize" data-testid={`badge-status-${download.id}`}>
                          {download.status}
                        </Badge>
                        <Badge variant="outline" className="capitalize" data-testid={`badge-downloader-${download.id}`}>
                          {download.downloaderName}
                        </Badge>
                        {download.size && (
                          <Badge variant="outline" data-testid={`badge-size-${download.id}`}>
                            {formatBytes(download.downloaded || 0)} / {formatBytes(download.size)}
                          </Badge>
                        )}
                        {download.downloadSpeed && download.downloadSpeed > 0 && (
                          <Badge variant="outline" data-testid={`badge-download-speed-${download.id}`}>
                            ↓ {formatSpeed(download.downloadSpeed)}
                          </Badge>
                        )}
                        {download.uploadSpeed && download.uploadSpeed > 0 && (
                          <Badge variant="outline" data-testid={`badge-upload-speed-${download.id}`}>
                            ↑ {formatSpeed(download.uploadSpeed)}
                          </Badge>
                        )}
                        {download.eta && download.eta > 0 && (
                          <Badge variant="outline" data-testid={`badge-eta-${download.id}`}>
                            ETA: {formatETA(download.eta)}
                          </Badge>
                        )}
                        {download.seeders !== undefined && (
                          <Badge variant="outline" data-testid={`badge-peers-${download.id}`}>
                            {download.seeders}↑ / {download.leechers || 0}↓
                          </Badge>
                        )}
                        {download.ratio !== undefined && (
                          <Badge variant="outline" data-testid={`badge-ratio-${download.id}`}>
                            Ratio: {download.ratio.toFixed(2)}
                          </Badge>
                        )}
                      </div>
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    {download.status === 'paused' ? (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleResume(download)}
                        disabled={resumeMutation.isPending}
                        data-testid={`button-resume-${download.id}`}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handlePause(download)}
                        disabled={pauseMutation.isPending}
                        data-testid={`button-pause-${download.id}`}
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" data-testid={`button-menu-${download.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onClick={() => handleRemove(download, false)}
                          data-testid={`button-remove-${download.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove Torrent
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleRemove(download, true)}
                          className="text-destructive"
                          data-testid={`button-remove-files-${download.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove & Delete Files
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span data-testid={`text-progress-label-${download.id}`}>Progress</span>
                    <span data-testid={`text-progress-value-${download.id}`}>{download.progress.toFixed(1)}%</span>
                  </div>
                  <Progress value={download.progress} className="h-2" data-testid={`progress-bar-${download.id}`} />
                  {download.error && (
                    <div className="text-sm text-destructive mt-2" data-testid={`text-error-${download.id}`}>
                      Error: {download.error}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card data-testid="card-no-downloads">
            <CardHeader>
              <CardTitle data-testid="text-no-downloads-title">No Active Downloads</CardTitle>
              <CardDescription data-testid="text-no-downloads-description">
                Use the Search page to find and download games from your configured indexers.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}