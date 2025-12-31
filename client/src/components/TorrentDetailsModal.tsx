import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  File,
  Server,
  HardDrive,
  Clock,
  Activity,
  Hash,
  Folder,
  Calendar,
  Users,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { TorrentFile, TorrentTracker, TorrentDetails } from "@shared/schema";

interface TorrentDetailsModalProps {
  downloaderId: string;
  torrentId: string;
  torrentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(isoString: string | undefined): string {
  if (!isoString) return "N/A";
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return "N/A";
  }
}

function getTrackerStatusColor(status: TorrentTracker["status"]): string {
  switch (status) {
    case "working":
      return "bg-green-500";
    case "updating":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
    case "inactive":
    default:
      return "bg-gray-500";
  }
}

function getPriorityBadgeVariant(
  priority: TorrentFile["priority"]
): "default" | "secondary" | "outline" | "destructive" {
  switch (priority) {
    case "high":
      return "default";
    case "normal":
      return "secondary";
    case "low":
      return "outline";
    case "off":
      return "destructive";
    default:
      return "outline";
  }
}

export default function TorrentDetailsModal({
  downloaderId,
  torrentId,
  torrentName,
  open,
  onOpenChange,
}: TorrentDetailsModalProps) {
  const {
    data: details,
    isLoading,
    error,
  } = useQuery<TorrentDetails>({
    queryKey: [`/api/downloaders/${downloaderId}/torrents/${torrentId}/details`],
    enabled: open && !!downloaderId && !!torrentId,
    refetchInterval: (query) => (query.state.error ? false : 5000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle
            className="text-xl font-bold leading-tight truncate"
            data-testid="torrent-details-title"
          >
            {torrentName}
          </DialogTitle>
          <DialogDescription>
            Torrent details including files, trackers, and metadata
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div
            className="flex items-center justify-center py-8"
            data-testid="torrent-details-loading"
          >
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
            <span>Loading torrent details...</span>
          </div>
        )}

        {error && (
          <div className="text-destructive py-4" data-testid="torrent-details-error">
            Failed to load torrent details:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </div>
        )}

        {details && (
          <Tabs defaultValue="info" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
              <TabsTrigger value="info" data-testid="tab-info">
                <Activity className="w-4 h-4 mr-2" />
                Info
              </TabsTrigger>
              <TabsTrigger value="files" data-testid="tab-files">
                <File className="w-4 h-4 mr-2" />
                Files ({details.files.length})
              </TabsTrigger>
              <TabsTrigger value="trackers" data-testid="tab-trackers">
                <Server className="w-4 h-4 mr-2" />
                Trackers ({details.trackers.length})
              </TabsTrigger>
            </TabsList>

            {/* Info Tab */}
            <TabsContent
              value="info"
              className="flex-1 overflow-hidden mt-4"
              data-testid="tab-content-info"
            >
              <ScrollArea className="h-full pr-4">
                <div className="space-y-6">
                  {/* General Info */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {details.hash && (
                      <div className="flex items-start gap-3">
                        <Hash className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Hash</p>
                          <p className="text-sm font-mono break-all" data-testid="detail-hash">
                            {details.hash}
                          </p>
                        </div>
                      </div>
                    )}

                    {details.downloadDir && (
                      <div className="flex items-start gap-3">
                        <Folder className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Download Location
                          </p>
                          <p className="text-sm break-all" data-testid="detail-download-dir">
                            {details.downloadDir}
                          </p>
                        </div>
                      </div>
                    )}

                    {details.size && (
                      <div className="flex items-start gap-3">
                        <HardDrive className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Size</p>
                          <p className="text-sm" data-testid="detail-size">
                            {formatBytes(details.downloaded || 0)} / {formatBytes(details.size)}
                          </p>
                        </div>
                      </div>
                    )}

                    {details.addedDate && (
                      <div className="flex items-start gap-3">
                        <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Added</p>
                          <p className="text-sm" data-testid="detail-added-date">
                            {formatDate(details.addedDate)}
                          </p>
                        </div>
                      </div>
                    )}

                    {details.completedDate && (
                      <div className="flex items-start gap-3">
                        <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Completed</p>
                          <p className="text-sm" data-testid="detail-completed-date">
                            {formatDate(details.completedDate)}
                          </p>
                        </div>
                      </div>
                    )}

                    {details.connectedPeers !== undefined && (
                      <div className="flex items-start gap-3">
                        <Users className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Connected Peers
                          </p>
                          <p className="text-sm" data-testid="detail-peers">
                            {details.connectedPeers}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Progress */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Progress</span>
                      <span data-testid="detail-progress">{details.progress.toFixed(1)}%</span>
                    </div>
                    <Progress value={details.progress} className="h-2" />
                  </div>

                  {/* Comment / Creator */}
                  {(details.comment || details.creator) && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        {details.creator && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">Created By</p>
                            <p className="text-sm" data-testid="detail-creator">
                              {details.creator}
                            </p>
                          </div>
                        )}
                        {details.comment && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">Comment</p>
                            <p className="text-sm" data-testid="detail-comment">
                              {details.comment}
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Files Tab */}
            <TabsContent
              value="files"
              className="flex-1 overflow-hidden mt-4"
              data-testid="tab-content-files"
            >
              <ScrollArea className="h-[400px] pr-4">
                {details.files.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8" data-testid="no-files">
                    No file information available
                  </div>
                ) : (
                  <div className="space-y-2">
                    {details.files.map((file, index) => (
                      <div
                        key={index}
                        className="border rounded-lg p-3 space-y-2"
                        data-testid={`file-${index}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <File className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                            <span className="text-sm break-all">{file.name}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge
                              variant={getPriorityBadgeVariant(file.priority)}
                              className="capitalize"
                            >
                              {file.priority}
                            </Badge>
                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                              {formatBytes(file.size)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={file.progress} className="h-1 flex-1" />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {file.progress.toFixed(1)}%
                          </span>
                        </div>
                        {!file.wanted && (
                          <Badge variant="outline" className="text-xs">
                            Skipped
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Trackers Tab */}
            <TabsContent
              value="trackers"
              className="flex-1 overflow-hidden mt-4"
              data-testid="tab-content-trackers"
            >
              <ScrollArea className="h-[400px] pr-4">
                {details.trackers.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8" data-testid="no-trackers">
                    No tracker information available
                  </div>
                ) : (
                  <div className="space-y-3">
                    {details.trackers.map((tracker, index) => (
                      <div
                        key={index}
                        className="border rounded-lg p-3 space-y-2"
                        data-testid={`tracker-${index}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <Server className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                            <span className="text-sm break-all font-mono">{tracker.url}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div
                              className={`w-2 h-2 rounded-full ${getTrackerStatusColor(tracker.status)}`}
                            />
                            <span className="text-sm capitalize">{tracker.status}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>Tier: {tracker.tier}</span>
                          {tracker.seeders !== undefined && <span>• Seeds: {tracker.seeders}</span>}
                          {tracker.leechers !== undefined && (
                            <span>• Leechers: {tracker.leechers}</span>
                          )}
                        </div>

                        {tracker.lastAnnounce && (
                          <div className="text-xs text-muted-foreground">
                            Last announce: {formatDate(tracker.lastAnnounce)}
                          </div>
                        )}

                        {tracker.nextAnnounce && (
                          <div className="text-xs text-muted-foreground">
                            Next announce: {formatDate(tracker.nextAnnounce)}
                          </div>
                        )}

                        {tracker.error && (
                          <div className="text-xs text-destructive">Error: {tracker.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
