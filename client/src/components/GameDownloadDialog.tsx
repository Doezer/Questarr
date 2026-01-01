import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";

interface TorrentItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  category?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  guid?: string;
  comments?: string;
}

interface SearchResult {
  items: TorrentItem[];
  total: number;
  offset: number;
  errors?: string[];
}

interface GameDownloadDialogProps {
  game: Game | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

export default function GameDownloadDialog({ game, open, onOpenChange }: GameDownloadDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingGuid, setDownloadingGuid] = useState<string | null>(null);

  // Auto-populate search when dialog opens with game title
  useEffect(() => {
    if (open && game) {
      setSearchQuery(game.title);
    } else if (!open) {
      setSearchQuery("");
    }
  }, [open, game]);

  const { data: searchResults, isLoading: isSearching } = useQuery<SearchResult>({
    queryKey: [`/api/search?query=${encodeURIComponent(searchQuery)}`],
    enabled: open && searchQuery.trim().length > 0,
  });

  const sortedItems = React.useMemo(() => {
    if (!searchResults?.items) return [];
    return [...searchResults.items].sort((a, b) => {
      const dateA = new Date(a.pubDate).getTime();
      const dateB = new Date(b.pubDate).getTime();
      return dateB - dateA;
    });
  }, [searchResults?.items]);

  const downloadMutation = useMutation({
    mutationFn: async (torrent: TorrentItem) => {
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: torrent.link,
          title: torrent.title,
        }),
      });
      if (!response.ok) {
        let errorMessage = "Failed to add download";
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch {
          // Response is not JSON, use default error message
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: "Download started successfully",
          description: `Added to ${result.downloaderName || "downloader"}`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
        onOpenChange(false);
      } else {
        toast({
          title: "Failed to start download",
          description: result.message || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start download",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setDownloadingGuid(null);
    },
  });

  const handleDownload = (torrent: TorrentItem) => {
    const guid = torrent.guid || torrent.link;
    setDownloadingGuid(guid);
    downloadMutation.mutate(torrent);
  };

  if (!game) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Download {game.title}</DialogTitle>
          <DialogDescription>Search results for torrents matching this game</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 mt-4">
          <div className="space-y-4 pr-4">
            {isSearching && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Searching for torrents...</span>
              </div>
            )}

            {!isSearching && searchResults && searchResults.items.length === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>No Results Found</CardTitle>
                  <CardDescription>
                    No torrents found for this game. Try configuring indexers in settings.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {!isSearching && searchResults && searchResults.items.length > 0 && (
              <div className="border rounded-md divide-y">
                <div className="bg-muted/50 p-2 text-xs font-medium flex justify-between items-center">
                  <div>Release Name</div>
                  <div className="w-[40px] text-right">Action</div>
                </div>
                {sortedItems.map((torrent) => (
                  <div
                    key={torrent.guid || torrent.link}
                    className="p-2 text-sm flex justify-between items-center hover:bg-muted/30 transition-colors gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate" title={torrent.title}>
                        {torrent.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{formatDate(torrent.pubDate)}</span>
                        <span>•</span>
                        <span>{torrent.size ? formatBytes(torrent.size) : "-"}</span>
                        <span>•</span>
                        <div className="flex items-center gap-1">
                          <span className="text-green-600 font-medium">
                            {torrent.seeders ?? 0}
                          </span>
                          <span>/</span>
                          <span className="text-red-600 font-medium">
                            {torrent.leechers ?? 0}
                          </span>
                          <span>peers</span>
                        </div>
                        {torrent.description && (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-[200px]" title={torrent.description}>
                              {torrent.description}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="w-[40px] text-right flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownload(torrent)}
                        disabled={downloadingGuid !== null}
                        className="h-8 w-8"
                        title="Download"
                      >
                        {downloadingGuid === (torrent.guid || torrent.link) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchResults?.errors && searchResults.errors.length > 0 && (
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="text-sm text-destructive">Indexer Errors</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1">
                    {searchResults.errors.map((error, index) => (
                      <li key={index} className="text-muted-foreground">
                        • {error}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
