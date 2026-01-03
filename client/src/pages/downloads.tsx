import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  formatBytes,
  formatSpeed,
  formatETA,
  getStatusBadgeVariant,
  filterDownloadsByStatus,
  shouldShowSpeedBadge,
  shouldShowETABadge,
  shouldShowRatioBadge,
  shouldShowSizeBadge,
  shouldShowPeersBadge,
  shouldShowTorrentMetrics,
  shouldShowUsenetMetrics,
  shouldShowRepairStatus,
  shouldShowUnpackStatus,
  formatRepairStatus,
  formatUnpackStatus,
  formatAge,
  type DownloadStatusType,
  type DownloadType,
} from "@/lib/downloads-utils";
import { Play, Pause, Trash2, MoreHorizontal, RefreshCw, Info, Download, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import TorrentDetailsModal from "@/components/TorrentDetailsModal";

interface DownloadStatus {
  id: string;
  name: string;
  status: DownloadStatusType;
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
  // Download type and Usenet-specific fields
  downloadType?: DownloadType;
  repairStatus?: string;
  unpackStatus?: string;
  age?: number;
  grabs?: number;
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

export default function Downloads() {
  const { toast } = useToast();
  const [hasShownErrors, setHasShownErrors] = useState<Set<string>>(new Set());
  const [selectedTorrent, setSelectedTorrent] = useState<DownloadStatus | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DownloadStatusType | "all">("all");

  const {
    data: downloadsData,
    isLoading,
    refetch,
  } = useQuery<DownloadsResponse>({
    queryKey: ["/api/downloads"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const downloads = downloadsData?.torrents || [];

  // Memoize errors to avoid recreating array on every render
  const errors = useMemo(() => downloadsData?.errors || [], [downloadsData?.errors]);

  // Filter downloads based on selected status using utility function
  const filteredDownloads = filterDownloadsByStatus(downloads, statusFilter);

  // Show toast notifications for downloader errors
  // Only show each error once per session to avoid spam
  useEffect(() => {
    // Remove resolved errors from tracking
    if (errors.length === 0) {
      setHasShownErrors(new Set());
    } else {
      const currentErrorKeys = new Set(errors.map((e) => `${e.downloaderId}-${e.error}`));
      setHasShownErrors((prev) => {
        const newSet = new Set(prev);
        Array.from(prev).forEach((key) => {
          if (!currentErrorKeys.has(key)) {
            newSet.delete(key);
          }
        });
        return newSet;
      });

      // Show new errors
      errors.forEach((error) => {
        const errorKey = `${error.downloaderId}-${error.error}`;
        if (!hasShownErrors.has(errorKey)) {
          toast({
            title: `Downloader Error: ${error.downloaderName}`,
            description: error.error,
            variant: "destructive",
          });
          setHasShownErrors((prev) => {
            const newSet = new Set(prev);
            newSet.add(errorKey);
            return newSet;
          });
        }
      });
    }
  }, [errors, hasShownErrors, toast]);

  const handleShowDetails = (download: DownloadStatus) => {
    setSelectedTorrent(download);
    setDetailsModalOpen(true);
  };

  const pauseMutation = useMutation({
    mutationFn: async ({
      downloaderId,
      torrentId,
    }: {
      downloaderId: string;
      torrentId: string;
    }) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/downloaders/${downloaderId}/torrents/${torrentId}/pause`, {
        method: "POST",
        headers,
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
    mutationFn: async ({
      downloaderId,
      torrentId,
    }: {
      downloaderId: string;
      torrentId: string;
    }) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(
        `/api/downloaders/${downloaderId}/torrents/${torrentId}/resume`,
        {
          method: "POST",
          headers,
        }
      );
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
    mutationFn: async ({
      downloaderId,
      torrentId,
      deleteFiles,
    }: {
      downloaderId: string;
      torrentId: string;
      deleteFiles: boolean;
    }) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(
        `/api/downloaders/${downloaderId}/torrents/${torrentId}?deleteFiles=${deleteFiles}`,
        {
          method: "DELETE",
          headers,
        }
      );
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
    <div className="h-full overflow-auto p-8">
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

      {/* Status filter tabs */}
      <Tabs
        value={statusFilter}
        onValueChange={(value) => setStatusFilter(value as DownloadStatusType | "all")}
        className="mb-6"
        aria-label="Filter downloads by status"
      >
        <TabsList data-testid="filter-tabs">
          <TabsTrigger value="all" data-testid="filter-all">
            All
          </TabsTrigger>
          <TabsTrigger value="downloading" data-testid="filter-downloading">
            Downloading
          </TabsTrigger>
          <TabsTrigger value="seeding" data-testid="filter-seeding">
            Seeding
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="filter-completed">
            Completed
          </TabsTrigger>
          <TabsTrigger value="paused" data-testid="filter-paused">
            Paused
          </TabsTrigger>
          <TabsTrigger value="error" data-testid="filter-error">
            Error
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4">
        {filteredDownloads.length > 0 ? (
          filteredDownloads.map((download) => (
            <Card
              key={`${download.downloaderId}-${download.id}`}
              data-testid={`card-download-${download.id}`}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-lg leading-tight">{download.name}</CardTitle>
                    <CardDescription className="mt-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <Badge
                          variant={getStatusBadgeVariant(download.status)}
                          className="capitalize"
                          data-testid={`badge-status-${download.id}`}
                          aria-label={`Status: ${download.status}`}
                        >
                          {download.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="capitalize"
                          data-testid={`badge-downloader-${download.id}`}
                          aria-label={`Downloader: ${download.downloaderName}`}
                        >
                          {download.downloaderName}
                        </Badge>
                        {/* Download Type Badge */}
                        <Badge
                          variant={download.downloadType === "usenet" ? "secondary" : "default"}
                          className="text-xs"
                          data-testid={`badge-type-${download.id}`}
                        >
                          {download.downloadType === "usenet" ? (
                            <>
                              <Newspaper className="h-3 w-3 mr-1" />
                              USENET
                            </>
                          ) : (
                            <>
                              <Download className="h-3 w-3 mr-1" />
                              TORRENT
                            </>
                          )}
                        </Badge>
                        {shouldShowSizeBadge(download.size) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-size-${download.id}`}
                            aria-label={`Downloaded ${formatBytes(download.downloaded || 0)} of ${formatBytes(download.size!)}`}
                          >
                            {formatBytes(download.downloaded || 0)} / {formatBytes(download.size!)}
                          </Badge>
                        )}
                        {/* Usenet-specific: Repair Status */}
                        {shouldShowRepairStatus(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-repair-${download.id}`}
                            aria-label={`Repair: ${formatRepairStatus(download.repairStatus!)}`}
                          >
                            Repair: {formatRepairStatus(download.repairStatus!)}
                          </Badge>
                        )}
                        {/* Usenet-specific: Unpack Status */}
                        {shouldShowUnpackStatus(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-unpack-${download.id}`}
                            aria-label={`Unpack: ${formatUnpackStatus(download.unpackStatus!)}`}
                          >
                            Unpack: {formatUnpackStatus(download.unpackStatus!)}
                          </Badge>
                        )}
                        {shouldShowSpeedBadge(download.downloadSpeed) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-download-speed-${download.id}`}
                            aria-label={`Download speed: ${formatSpeed(download.downloadSpeed!)}`}
                          >
                            ↓ {formatSpeed(download.downloadSpeed!)}
                          </Badge>
                        )}
                        {shouldShowSpeedBadge(download.uploadSpeed) && shouldShowTorrentMetrics(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-upload-speed-${download.id}`}
                            aria-label={`Upload speed: ${formatSpeed(download.uploadSpeed!)}`}
                          >
                            ↑ {formatSpeed(download.uploadSpeed!)}
                          </Badge>
                        )}
                        {shouldShowETABadge(download.eta) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-eta-${download.id}`}
                            aria-label={`Estimated time remaining: ${formatETA(download.eta!)}`}
                          >
                            ETA: {formatETA(download.eta!)}
                          </Badge>
                        )}
                        {/* Torrent-specific: Peers */}
                        {shouldShowPeersBadge(download.seeders) && shouldShowTorrentMetrics(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-peers-${download.id}`}
                            aria-label={`${download.seeders} seeders, ${download.leechers || 0} leechers`}
                          >
                            {download.seeders}↑ / {download.leechers || 0}↓
                          </Badge>
                        )}
                        {/* Usenet-specific: Age */}
                        {download.age !== undefined && shouldShowUsenetMetrics(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-age-${download.id}`}
                            aria-label={`Age: ${formatAge(download.age)}`}
                          >
                            Age: {formatAge(download.age)}
                          </Badge>
                        )}
                        {/* Usenet-specific: Grabs */}
                        {download.grabs !== undefined && shouldShowUsenetMetrics(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-grabs-${download.id}`}
                            aria-label={`${download.grabs} grabs`}
                          >
                            {download.grabs} grabs
                          </Badge>
                        )}
                        {shouldShowRatioBadge(download.ratio) && shouldShowTorrentMetrics(download) && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-ratio-${download.id}`}
                            aria-label={`Share ratio: ${download.ratio?.toFixed(2) ?? "0.00"}`}
                          >
                            Ratio: {download.ratio?.toFixed(2) ?? "0.00"}
                          </Badge>
                        )}
                      </div>
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    {download.status === "paused" ? (
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
                        <Button
                          variant="outline"
                          size="icon"
                          data-testid={`button-menu-${download.id}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onClick={() => handleShowDetails(download)}
                          data-testid={`button-details-${download.id}`}
                        >
                          <Info className="h-4 w-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
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
                    <span data-testid={`text-progress-value-${download.id}`}>
                      {download.progress.toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={download.progress}
                    className="h-2"
                    data-testid={`progress-bar-${download.id}`}
                  />
                  {download.error && (
                    <div
                      className="text-sm text-destructive mt-2"
                      data-testid={`text-error-${download.id}`}
                    >
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
              <CardTitle data-testid="text-no-downloads-title">
                {downloads.length === 0
                  ? "No Active Downloads"
                  : `No ${
                      statusFilter === "all"
                        ? "Active"
                        : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)
                    } Downloads`}
              </CardTitle>
              <CardDescription data-testid="text-no-downloads-description">
                {downloads.length === 0
                  ? "Use the Search page to find and download games from your configured indexers."
                  : `No downloads match the "${statusFilter}" filter. Try selecting a different filter.`}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      {/* Torrent Details Modal */}
      {selectedTorrent && (
        <TorrentDetailsModal
          downloaderId={selectedTorrent.downloaderId}
          torrentId={selectedTorrent.id}
          torrentName={selectedTorrent.name}
          open={detailsModalOpen}
          onOpenChange={setDetailsModalOpen}
        />
      )}
    </div>
  );
}
