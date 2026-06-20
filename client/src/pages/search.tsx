import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import { useQuery, useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatBytes, formatAge, isUsenetItem, getDownloadTypeColor } from "@/lib/downloads-utils";
import { isTorrentDownloaderType, isUsenetDownloaderType } from "@shared/downloader-types";
import { cleanReleaseName } from "@shared/title-utils";
import { Search, Download, Newspaper, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Game } from "@shared/schema";
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

const PAGE_SIZE = 50;

export default function SearchPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [selectedDownload, setSelectedDownload] = useState<DownloadItem | null>(null);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const lastSearchQueryRef = useRef("");
  const sentinelRef = useRef<HTMLDivElement>(null); // NOSONAR

  const {
    data,
    isLoading: isSearching,
    error: searchError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery<SearchResult, Error, InfiniteData<SearchResult>, string[], number>({
    queryKey: ["/api/search", debouncedSearchQuery],
    queryFn: ({ pageParam }) =>
      apiRequest(
        "GET",
        `/api/search?query=${encodeURIComponent(debouncedSearchQuery)}&limit=${PAGE_SIZE}&offset=${pageParam}`
      ).then((r) => r.json()),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      // Use "received a full page" as the continuation signal rather than comparing
      // against lastPage.total, which equals the current batch size for Torznab
      // indexers and would always terminate pagination after the first page.
      return lastPage.items.length >= PAGE_SIZE ? lastPageParam + lastPage.items.length : undefined;
    },
    enabled: debouncedSearchQuery.trim().length > 0,
  });

  const { data: libraryGames = [] } = useQuery<Game[]>({
    queryKey: ["/api/games", debouncedSearchQuery],
    queryFn: () =>
      apiRequest("GET", `/api/games?search=${encodeURIComponent(debouncedSearchQuery)}`).then((r) =>
        r.json()
      ),
    enabled: debouncedSearchQuery.trim().length > 0,
  });

  const removeGameMutation = useMutation({
    mutationFn: (gameId: string) => apiRequest("DELETE", `/api/games/${gameId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({ title: "Game removed from library" });
    },
    onError: () => {
      toast({ title: "Failed to remove game", variant: "destructive" });
    },
  });

  const allItems = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  const filteredAndSortedItems = useMemo(() => {
    // Parse YYYY-MM-DD date inputs as local midnight so the filter matches
    // what the user sees in toLocaleDateString(), not UTC midnight which would
    // shift boundaries by the user's UTC offset.
    const parseLocalDay = (s: string) => {
      const parts = s.split("-");
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
    };
    const fromTime = dateFrom ? parseLocalDay(dateFrom) : null;
    const toTime = dateTo ? parseLocalDay(dateTo) + 86399999 : null;
    const mapped: { item: DownloadItem; time: number }[] = [];
    for (const item of allItems) {
      const time = new Date(item.pubDate).getTime();
      if (
        !Number.isNaN(time) &&
        (fromTime === null || time >= fromTime) &&
        (toTime === null || time <= toTime)
      ) {
        mapped.push({ item, time });
      }
    }
    return mapped.sort((a, b) => b.time - a.time).map(({ item }) => item);
  }, [allItems, dateFrom, dateTo]);

  useEffect(() => {
    const el = sentinelRef.current;
    const Io = window.IntersectionObserver; // NOSONAR
    if (!el || !Io) return;
    const observer = new Io( // NOSONAR
      (entries) => {
        // Don't auto-fetch when an active date filter yields zero visible results —
        // that would spam the backend with rapid consecutive requests until hasNextPage
        // is exhausted (sentinel always visible in an empty list).
        const filterActive = !!(dateFrom || dateTo);
        const listIsEmpty = filteredAndSortedItems.length === 0;
        if (
          entries[0]?.isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage &&
          !(filterActive && listIsEmpty)
        ) {
          void fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    filteredAndSortedItems.length,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
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
      } else if (data) {
        const total = data.pages[0]?.total ?? 0;
        if (total > 0) {
          toast({
            title: "Search completed",
            description: `Found ${total} result${total !== 1 ? "s" : ""}`,
          });
        } else {
          toast({ title: "No results found", description: "Try a different search query" });
        }
        const errors = data.pages[0]?.errors;
        if (errors && errors.length > 0) {
          toast({
            title: "Some indexers failed",
            description: `${errors.length} indexer(s) encountered errors`,
            variant: "destructive",
          });
        }
      }
      lastSearchQueryRef.current = debouncedSearchQuery;
    }
  }, [data, isSearching, searchError, debouncedSearchQuery, toast]);

  const { data: downloaders = [] } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders/enabled"],
  });

  const downloadMutation = useMutation({
    mutationFn: ({ download, formData }: { download: DownloadItem; formData: DownloadForm }) =>
      apiRequest("POST", `/api/downloaders/${formData.downloaderId}/downloads`, {
        url: download.link,
        title: download.title,
        category: formData.category || undefined,
        downloadPath: formData.downloadPath,
        priority: formData.priority,
        downloadType: isUsenetItem(download) ? "usenet" : "torrent",
      }).then((r) => r.json()),
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Download started successfully" });
        setIsDownloadDialogOpen(false);
        setSelectedDownload(null);
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/downloads/summary"] });
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

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
  };

  const handleDownload = (download: DownloadItem) => {
    const isUsenet = isUsenetItem(download);
    const compatibleDownloaders = downloaders.filter((d) =>
      isUsenet ? isUsenetDownloaderType(d.type) : isTorrentDownloaderType(d.type)
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

  const onSubmitDownload = (formValues: DownloadForm) => {
    if (selectedDownload) {
      downloadMutation.mutate({ download: selectedDownload, formData: formValues });
    }
  };

  const filteredDownloaders = selectedDownload
    ? downloaders.filter((d) =>
        isUsenetItem(selectedDownload)
          ? isUsenetDownloaderType(d.type)
          : isTorrentDownloaderType(d.type)
      )
    : downloaders;

  const firstPage = data?.pages[0];
  const totalResults = firstPage?.total ?? 0;
  const indexerErrors = firstPage?.errors;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Search for games across configured indexers
        </p>
      </div>

      {/* Search Form */}
      <form
        onSubmit={handleSearch}
        className={`flex gap-2 ${showFilters ? "mb-3" : "mb-6"}`}
        data-testid="form-search"
      >
        <div className="flex-1">
          <Input
            placeholder="Enter game title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-query"
          />
        </div>
        <Button type="submit" disabled={isSearching} data-testid="button-search">
          {isSearching ? (
            <>
              <Search className="h-4 w-4 mr-2 animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" />
              Search
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Toggle filters"
          aria-expanded={showFilters}
          data-testid="button-toggle-filters"
        >
          {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </form>

      {/* Collapsible date filter row */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-md border bg-muted/30">
          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            Release date:
          </span>
          <div className="flex items-center gap-2">
            <label htmlFor="date-from" className="text-sm text-muted-foreground">
              From
            </label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40 h-8 text-sm"
              data-testid="input-date-from"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="date-to" className="text-sm text-muted-foreground">
              To
            </label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40 h-8 text-sm"
              data-testid="input-date-to"
            />
          </div>
          {!!(dateFrom || dateTo) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              data-testid="button-clear-dates"
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Search error */}
      {!!searchError && (
        <Card className="mb-6" data-testid="card-search-error">
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

      {!!data && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-semibold" data-testid="text-search-results-count">
              {totalResults} result{totalResults !== 1 ? "s" : ""} found
              {!!(dateFrom || dateTo) && filteredAndSortedItems.length !== allItems.length && (
                <span className="text-muted-foreground font-normal text-sm ml-2">
                  ({filteredAndSortedItems.length} shown with filter)
                </span>
              )}
            </h2>
            {!!indexerErrors && indexerErrors.length > 0 && (
              <Badge variant="destructive" data-testid="badge-indexer-errors">
                {indexerErrors.length} indexer error(s)
              </Badge>
            )}
          </div>

          {!!indexerErrors && indexerErrors.length > 0 && (
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
                  {indexerErrors.map((error, index) => (
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

          {/* Library match banner */}
          {libraryGames.length > 0 && (
            <div
              className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5"
              data-testid="banner-library-matches"
            >
              <span className="text-xs font-medium text-muted-foreground">In your library:</span>
              {libraryGames.map((game) => (
                <div
                  key={game.id}
                  className="flex items-center gap-1 rounded bg-muted px-2 py-0.5"
                  data-testid={`library-game-${game.id}`}
                >
                  <span className="text-sm">{game.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive/70 hover:text-destructive"
                    onClick={() => removeGameMutation.mutate(game.id)}
                    disabled={removeGameMutation.isPending}
                    aria-label={`Remove ${game.title} from library`}
                    data-testid={`button-remove-game-${game.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="border rounded-md divide-y overflow-hidden">
            <div className="bg-muted/50 p-2 text-xs font-medium flex justify-between items-center px-4">
              <div>Release Name</div>
              <div className="w-[40px] text-right">Action</div>
            </div>
            {filteredAndSortedItems.length > 0 ? (
              <>
                {filteredAndSortedItems.map((download, index) => {
                  const isUsenet = isUsenetItem(download);
                  const itemKey = download.guid ?? download.link;
                  return (
                    <div
                      key={itemKey}
                      className="p-3 text-sm flex justify-between items-center hover:bg-muted/30 transition-colors gap-4 px-4"
                      data-testid={`card-torrent-${index}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="font-medium truncate flex-1" title={download.title}>
                            {download.title}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded uppercase font-bold">
                            {cleanReleaseName(download.title)}
                          </div>
                          <Badge
                            className={`text-xs flex-shrink-0 border-none ${getDownloadTypeColor(isUsenet ? "usenet" : "torrent")}`}
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
                                  <span className="text-primary font-medium">{download.grabs}</span>
                                  <span>grabs</span>
                                  {download.age !== undefined && <span>•</span>}
                                </>
                              )}
                              {download.age !== undefined && (
                                <>
                                  <span className="text-muted-foreground font-medium">
                                    {formatAge(download.age)}
                                  </span>
                                  <span>old</span>
                                </>
                              )}
                            </>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                {download.seeders ?? 0}
                              </span>
                              <span>/</span>
                              <span className="text-destructive font-medium">
                                {download.leechers ?? 0}
                              </span>
                              <span>peers</span>
                            </div>
                          )}
                          {!!download.description && (
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
                })}
              </>
            ) : (
              <div className="p-8 text-center text-muted-foreground" data-testid="card-no-results">
                <p className="font-medium text-foreground">No Results Found</p>
                <p className="text-sm mt-1">
                  {dateFrom || dateTo
                    ? "No releases match the selected date range. Try adjusting the filter."
                    : "Try adjusting your search terms or check if your indexers are properly configured."}
                </p>
              </div>
            )}
            {/* Infinite scroll sentinel — always rendered so observer reattaches after filter changes */}
            <div ref={sentinelRef} className="flex justify-center py-3">
              {isFetchingNextPage && (
                <Search className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
      )}

      {!searchQuery && !data && (
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
