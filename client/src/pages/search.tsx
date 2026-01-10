import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { queryClient } from "@/lib/queryClient";
import { formatBytes, formatAge, isUsenetItem } from "@/lib/downloads-utils";
import { Search, Download, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

interface DownloadItem {
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
  indexerId?: string;
  indexerName?: string;
  // Usenet-specific fields
  grabs?: number;
  age?: number;
  poster?: string;
  group?: string;
}

interface SearchResult {
  items: DownloadItem[];
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
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [selectedDownload, setSelectedDownload] = useState<DownloadItem | null>(null);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const lastSearchQueryRef = useRef("");

  const {
    data: searchResults,
    isLoading: isSearching,
    error: searchError,
  } = useQuery<SearchResult>({
    queryKey: [`/api/search?query=${encodeURIComponent(debouncedSearchQuery)}`],
    enabled: debouncedSearchQuery.trim().length > 0,
  });

  const sortedItems = (searchResults?.items || []).slice().sort((a, b) => {
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
  });

  // Show toast notification when search completes
  useEffect(() => {
    // Only show notification if we actually performed a search
    if (
      debouncedSearchQuery &&
      debouncedSearchQuery !== lastSearchQueryRef.current &&
      !isSearching
    ) {
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
            description: `Found ${itemCount} result${itemCount !== 1 ? "s" : ""}`,
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
      lastSearchQueryRef.current = debouncedSearchQuery;
    }
  }, [searchResults, isSearching, searchError, debouncedSearchQuery, toast]);

  const { data: downloaders = [] } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders/enabled"],
  });

  const downloadMutation = useMutation({
    mutationFn: async (data: { download: DownloadItem; formData: DownloadForm }) => {
      const token = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/downloaders/${data.formData.downloaderId}/downloads`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: data.download.link,
          title: data.download.title,
          category: data.formData.category || undefined,
          downloadPath: data.formData.downloadPath,
          priority: data.formData.priority,
          downloadType: isUsenetItem(data.download) ? "usenet" : "torrent",
        }),
      });
      if (!response.ok) throw new Error("Failed to add download");
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Download started successfully" });
        setIsDownloadDialogOpen(false);
        setSelectedDownload(null);
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
      category: "",
      downloadPath: "",
      priority: 5,
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Query will automatically trigger due to the enabled condition
  };

  const handleDownload = (download: DownloadItem) => {
    const isUsenet = isUsenetItem(download);
    const compatibleDownloaders = downloaders.filter((d) =>
      isUsenet
        ? ["sabnzbd", "nzbget"].includes(d.type)
        : ["transmission", "rtorrent", "qbittorrent"].includes(d.type)
    );

    if (compatibleDownloaders.length === 0) {
      toast({
        title: "No compatible downloaders",
        description: `Please configure a ${isUsenet ? "Usenet" : "Torrent"} downloader in settings.`,
        variant: "destructive",
      });
      return;
    }

    setSelectedDownload(download);
    form.reset({
      downloaderId: compatibleDownloaders[0]?.id || "",
      category: "",
      downloadPath: "",
      priority: 5,
    });
    setIsDownloadDialogOpen(true);
  };

  const onSubmitDownload = (data: DownloadForm) => {
    if (selectedDownload) {
      downloadMutation.mutate({ download: selectedDownload, formData: data });
    }
  };

  // Filter downloaders for the dialog dropdown
  const filteredDownloaders = selectedDownload
    ? downloaders.filter((d) =>
        isUsenetItem(selectedDownload)
          ? ["sabnzbd", "nzbget"].includes(d.type)
          : ["transmission", "rtorrent", "qbittorrent"].includes(d.type)
      )
    : downloaders;

  return (
    <div className="h-full overflow-auto p-8">
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
          <CardDescription>Search for games using your configured Torznab indexers</CardDescription>
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
            <CardTitle className="text-destructive" data-testid="text-search-error-title">
              Search Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="text-search-error-message">
              Failed to search indexers. Please check your configuration.
            </p>
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
                <CardTitle
                  className="text-sm text-destructive"
                  data-testid="text-indexer-errors-title"
                >
                  Indexer Errors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1" data-testid="list-indexer-errors">
                  {searchResults.errors.map((error, index) => (
                    <li
                      key={index}
                      className="text-muted-foreground"
                      data-testid={`error-message-${index}`}
                    >
                      • {error}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="border rounded-md divide-y overflow-hidden">
            <div className="bg-muted/50 p-2 text-xs font-medium flex justify-between items-center px-4">
              <div>Release Name</div>
              <div className="w-[40px] text-right">Action</div>
            </div>
            {sortedItems.length > 0 ? (
              sortedItems.map((download, index) => {
                const isUsenet = isUsenetItem(download);
                return (
                  <div
                    key={index}
                    className="p-3 text-sm flex justify-between items-center hover:bg-muted/30 transition-colors gap-4 px-4"
                    data-testid={`card-torrent-${index}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-medium truncate flex-1" title={download.title}>
                          {download.title}
                        </div>
                        <Badge
                          variant={isUsenet ? "secondary" : "default"}
                          className="text-xs flex-shrink-0"
                        >
                          {isUsenet ? (
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
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(download.pubDate)}</span>
                        <span>•</span>
                        <span>{download.size ? formatBytes(download.size) : "-"}</span>
                        <span>•</span>
                        {isUsenet ? (
                          <>
                            {download.grabs !== undefined && (
                              <>
                                <span className="text-blue-600 font-medium">{download.grabs}</span>
                                <span>grabs</span>
                                {download.age !== undefined && <span>•</span>}
                              </>
                            )}
                            {download.age !== undefined && (
                              <>
                                <span className="text-purple-600 font-medium">
                                  {formatAge(download.age)}
                                </span>
                                <span>old</span>
                              </>
                            )}
                          </>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-green-600 font-medium">
                              {download.seeders ?? 0}
                            </span>
                            <span>/</span>
                            <span className="text-red-600 font-medium">
                              {download.leechers ?? 0}
                            </span>
                            <span>peers</span>
                          </div>
                        )}
                        {download.description && (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-[300px]" title={download.description}>
                              {download.description}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="w-[40px] text-right flex-shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="inline-block"
                            tabIndex={downloaders.length === 0 ? 0 : -1}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDownload(download)}
                              disabled={downloaders.length === 0}
                              className="h-8 w-8"
                              data-testid={`button-download-${index}`}
                              aria-label="Start download"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {downloaders.length === 0
                              ? "Configure a downloader first"
                              : "Start download"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-muted-foreground" data-testid="card-no-results">
                <p className="font-medium text-foreground">No Results Found</p>
                <p className="text-sm mt-1">
                  Try adjusting your search terms or check if your indexers are properly configured.
                </p>
              </div>
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
              Configure download settings for: {selectedDownload?.title}
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
                        {filteredDownloaders.map((downloader) => (
                          <SelectItem
                            key={downloader.id}
                            value={downloader.id}
                            data-testid={`option-downloader-${downloader.id}`}
                          >
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
                      <Input placeholder="games" {...field} data-testid="input-download-category" />
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
