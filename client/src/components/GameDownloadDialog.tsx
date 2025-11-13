import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, HardDrive, Users, Calendar, Loader2 } from "lucide-react";
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

export default function GameDownloadDialog({
  game,
  open,
  onOpenChange,
}: GameDownloadDialogProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  // Auto-populate search when dialog opens with game title
  useEffect(() => {
    if (open && game) {
      setSearchQuery(game.title);
    }
  }, [open, game]);

  const { data: searchResults, isLoading: isSearching } = useQuery<SearchResult>({
    queryKey: ["/api/search", searchQuery],
    enabled: open && searchQuery.trim().length > 0,
  });

  const downloadMutation = useMutation({
    mutationFn: async (torrent: TorrentItem) => {
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: torrent.link,
          title: torrent.title,
          category: "games",
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add download");
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
  });

  const handleDownload = (torrent: TorrentItem) => {
    downloadMutation.mutate(torrent);
  };

  if (!game) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Download {game.title}</DialogTitle>
          <DialogDescription>
            Search results for torrents matching this game
          </DialogDescription>
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
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Found {searchResults.total} result{searchResults.total !== 1 ? "s" : ""}
                </p>
                {searchResults.items.map((torrent, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base leading-tight mb-2">
                            {torrent.title}
                          </CardTitle>
                          <CardDescription>
                            <div className="flex flex-wrap gap-2 items-center">
                              {torrent.size && (
                                <Badge variant="outline" className="flex items-center">
                                  <HardDrive className="h-3 w-3 mr-1" />
                                  {formatBytes(torrent.size)}
                                </Badge>
                              )}
                              {torrent.seeders !== undefined && (
                                <Badge variant="outline" className="flex items-center">
                                  <Users className="h-3 w-3 mr-1" />
                                  {torrent.seeders}↑ / {torrent.leechers || 0}↓
                                </Badge>
                              )}
                              {torrent.pubDate && (
                                <Badge variant="outline" className="flex items-center">
                                  <Calendar className="h-3 w-3 mr-1" />
                                  {formatDate(torrent.pubDate)}
                                </Badge>
                              )}
                            </div>
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleDownload(torrent)}
                          disabled={downloadMutation.isPending}
                          className="flex-shrink-0"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    </CardHeader>
                    {torrent.description && (
                      <CardContent className="pt-0">
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {torrent.description}
                        </p>
                      </CardContent>
                    )}
                  </Card>
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
