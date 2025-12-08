import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Search, Download, Calendar, Users, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

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

interface Downloader {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

const downloadSchema = z.object({
  downloaderId: z.string().min(1, "Please select a downloader"),
  category: z.string().optional(),
  downloadPath: z.string().optional(),
  priority: z.number().min(1).max(10).optional(),
});

type DownloadForm = z.infer<typeof downloadSchema>;

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

export default function SearchPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTorrent, setSelectedTorrent] = useState<TorrentItem | null>(null);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [lastSearchQuery, setLastSearchQuery] = useState("");

  const { data: searchResults, isLoading: isSearching, error: searchError } = useQuery<SearchResult>({
    queryKey: ["/api/search", searchQuery],
    enabled: searchQuery.trim().length > 0,
  });

  // Show toast notification when search completes
  useEffect(() => {
    // Only show notification if we actually performed a search
    if (searchQuery && searchQuery !== lastSearchQuery && !isSearching) {
      if (searchError) {
        toast({
          title: "Search failed",
          description: "Unable to search indexers. Please check your configuration.",
          variant: "destructive",
        });
      } else if (searchResults) {
        const itemCount = searchResults.items.length;
        if (itemCount > 0) {
          toast({
            title: "Search completed",
            description: `Found ${itemCount} result${itemCount !== 1 ? 's' : ''}`,
          });
        } else {
          toast({
            title: "No results found",
            description: "Try a different search query",
          });
        }
        
        // Show warning if there were indexer errors
        if (searchResults.errors && searchResults.errors.length > 0) {
          toast({
            title: "Some indexers failed",
            description: `${searchResults.errors.length} indexer(s) encountered errors`,
            variant: "destructive",
          });
        }
      }
      setLastSearchQuery(searchQuery);
    }
  }, [searchResults, isSearching, searchError, searchQuery, lastSearchQuery, toast]);

  const { data: downloaders = [] } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders/enabled"],
  });

  const downloadMutation = useMutation({
    mutationFn: async (data: { torrent: TorrentItem; formData: DownloadForm }) => {
      const response = await fetch(`/api/downloaders/${data.formData.downloaderId}/torrents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: data.torrent.link,
          title: data.torrent.title,
          category: data.formData.category || "games",
          downloadPath: data.formData.downloadPath,
          priority: data.formData.priority,
        }),
      });
      if (!response.ok) throw new Error("Failed to add download");
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Download started successfully" });
        setIsDownloadDialogOpen(false);
        setSelectedTorrent(null);
        // Refresh downloads
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      } else {
        toast({ title: result.message || "Failed to start download", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Failed to start download", variant: "destructive" });
    },
  });

  const form = useForm<DownloadForm>({
    resolver: zodResolver(downloadSchema),
    defaultValues: {
      downloaderId: "",
      category: "games",
      downloadPath: "",
      priority: 5,
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Query will automatically trigger due to the enabled condition
  };

  const handleDownload = (torrent: TorrentItem) => {
    if (downloaders.length === 0) {
      toast({ title: "No downloaders configured", variant: "destructive" });
      return;
    }

    setSelectedTorrent(torrent);
    form.reset({
      downloaderId: downloaders[0]?.id || "",
      category: "games",
      downloadPath: "",
      priority: 5,
    });
    setIsDownloadDialogOpen(true);
  };

  const onSubmitDownload = (data: DownloadForm) => {
    if (selectedTorrent) {
      downloadMutation.mutate({ torrent: selectedTorrent, formData: data });
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Game Search</h1>
        <p className="text-muted-foreground">Search for games across configured indexers</p>
      </div>

      {/* Search Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Search className="h-5 w-5 mr-2" />
            Search Games
          </CardTitle>
          <CardDescription>
            Search for games using your configured Torznab indexers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-4" data-testid="form-search">
            <div className="flex-1">
              <Input
                placeholder="Enter game title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-query"
              />
            </div>
            <Button type="submit" disabled={isSearching} data-testid="button-search">
              {isSearching ? "Searching..." : "Search"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchError && (
        <Card className="mb-8" data-testid="card-search-error">
          <CardHeader>
            <CardTitle className="text-destructive" data-testid="text-search-error-title">Search Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="text-search-error-message">Failed to search indexers. Please check your configuration.</p>
          </CardContent>
        </Card>
      )}

      {searchResults && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold" data-testid="text-search-results-count">
              Search Results ({searchResults.total} found)
            </h2>
            {searchResults.errors && searchResults.errors.length > 0 && (
              <Badge variant="destructive" data-testid="badge-indexer-errors">
                {searchResults.errors.length} indexer error(s)
              </Badge>
            )}
          </div>

          {searchResults.errors && searchResults.errors.length > 0 && (
            <Card className="mb-4" data-testid="card-indexer-errors">
              <CardHeader>
                <CardTitle className="text-sm text-destructive" data-testid="text-indexer-errors-title">Indexer Errors</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1" data-testid="list-indexer-errors">
                  {searchResults.errors.map((error, index) => (
                    <li key={index} className="text-muted-foreground" data-testid={`error-message-${index}`}>
                      • {error}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {searchResults.items.length > 0 ? (
              searchResults.items.map((torrent, index) => (
                <Card key={index} data-testid={`card-torrent-${index}`}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <CardTitle className="text-lg leading-tight">{torrent.title}</CardTitle>
                        <CardDescription className="mt-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            {torrent.size && (
                              <Badge variant="outline" className="flex items-center" data-testid={`badge-size-${index}`}>
                                <HardDrive className="h-3 w-3 mr-1" />
                                {formatBytes(torrent.size)}
                              </Badge>
                            )}
                            {torrent.seeders !== undefined && (
                              <Badge variant="outline" className="flex items-center" data-testid={`badge-peers-${index}`}>
                                <Users className="h-3 w-3 mr-1" />
                                {torrent.seeders}↑ / {torrent.leechers || 0}↓
                              </Badge>
                            )}
                            {torrent.pubDate && (
                              <Badge variant="outline" className="flex items-center" data-testid={`badge-date-${index}`}>
                                <Calendar className="h-3 w-3 mr-1" />
                                {formatDate(torrent.pubDate)}
                              </Badge>
                            )}
                            {torrent.category && (
                              <Badge variant="outline" data-testid={`badge-category-${index}`}>{torrent.category}</Badge>
                            )}
                          </div>
                        </CardDescription>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleDownload(torrent)}
                          disabled={downloaders.length === 0}
                          data-testid={`button-download-${index}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {torrent.description && (
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-description-${index}`}>
                        {torrent.description}
                      </p>
                    </CardContent>
                  )}
                </Card>
              ))
            ) : (
              <Card data-testid="card-no-results">
                <CardHeader>
                  <CardTitle data-testid="text-no-results-title">No Results Found</CardTitle>
                  <CardDescription data-testid="text-no-results-description">
                    Try adjusting your search terms or check if your indexers are properly configured.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </div>
        </div>
      )}

      {!searchQuery && !searchResults && (
        <Card data-testid="card-start-searching">
          <CardHeader>
            <CardTitle data-testid="text-start-searching-title">Start Searching</CardTitle>
            <CardDescription data-testid="text-start-searching-description">
              Enter a game title above to search across your configured indexers.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Download Dialog */}
      <Dialog open={isDownloadDialogOpen} onOpenChange={setIsDownloadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start Download</DialogTitle>
            <DialogDescription>
              Configure download settings for: {selectedTorrent?.title}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitDownload)} className="space-y-4">
              <FormField
                control={form.control}
                name="downloaderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Downloader</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-downloader">
                          <SelectValue placeholder="Select downloader" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {downloaders.map((downloader) => (
                          <SelectItem key={downloader.id} value={downloader.id} data-testid={`option-downloader-${downloader.id}`}>
                            {downloader.name} ({downloader.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="games"
                        {...field}
                        data-testid="input-download-category"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="downloadPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Download Path (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Use default path"
                        {...field}
                        data-testid="input-download-path"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority (1-10)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 5)}
                        data-testid="input-download-priority"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDownloadDialogOpen(false)}
                  data-testid="button-cancel-download"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={downloadMutation.isPending}
                  data-testid="button-start-download"
                >
                  {downloadMutation.isPending ? "Starting..." : "Start Download"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}