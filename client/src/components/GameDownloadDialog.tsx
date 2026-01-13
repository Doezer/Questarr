import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, Loader2, PackagePlus, SlidersHorizontal, Newspaper } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { type Game, type Indexer } from "@shared/schema";
import { groupDownloadsByCategory, type DownloadCategory } from "@/lib/download-categorizer";

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

interface GameDownloadDialogProps {
  game: Game | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

import { apiRequest } from "@/lib/queryClient";
import { formatBytes, formatAge, isUsenetItem } from "@/lib/downloads-utils";

export default function GameDownloadDialog({ game, open, onOpenChange }: GameDownloadDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingGuid, setDownloadingGuid] = useState<string | null>(null);
  const [showBundleDialog, setShowBundleDialog] = useState(false);
  const [selectedMainDownload, setSelectedMainDownload] = useState<DownloadItem | null>(null);
  const [isDirectDownloadMode, setIsDirectDownloadMode] = useState(false);
  const [selectedUpdateIndices, setSelectedUpdateIndices] = useState<Set<number>>(new Set());

  // Filter states
  const [minSeeders, setMinSeeders] = useState<number>(0);
  const [selectedIndexer, setSelectedIndexer] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"seeders" | "date" | "size">("seeders");
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState<Set<DownloadCategory>>(
    new Set(["main", "update", "dlc", "extra"] as DownloadCategory[])
  );

  // Auto-populate search when dialog opens with game title
  useEffect(() => {
    if (open && game) {
      setSearchQuery(game.title);
    } else if (!open) {
      setSearchQuery("");
      setShowBundleDialog(false);
      setSelectedMainDownload(null);
      setIsDirectDownloadMode(false);
      setSelectedUpdateIndices(new Set());
      setMinSeeders(0);
      setSelectedIndexer("all");
      setSortBy("seeders");
      setShowFilters(false);
    }
  }, [open, game]);

  const { data: searchResults, isLoading: isSearching } = useQuery<SearchResult>({
    queryKey: [`/api/search?query=${encodeURIComponent(searchQuery)}`],
    enabled: open && searchQuery.trim().length > 0,
  });

  const { data: enabledIndexers } = useQuery<Indexer[]>({
    queryKey: ["/api/indexers/enabled"],
    enabled: open,
  });

  // Categorize downloads
  const categorizedDownloads = useMemo(() => {
    if (!searchResults?.items) return { main: [], update: [], dlc: [], extra: [] };
    return groupDownloadsByCategory(searchResults.items);
  }, [searchResults?.items]);

  const availableIndexers = useMemo(() => {
    if (!searchResults?.items) return [];
    const indexers = new Set(searchResults.items.map((item) => item.indexerName).filter(Boolean));

    if (enabledIndexers) {
      const enabledNames = new Set(enabledIndexers.map((i) => i.name));
      return Array.from(indexers)
        .filter((name) => enabledNames.has(name as string))
        .sort();
    }

    return Array.from(indexers).sort();
  }, [searchResults?.items, enabledIndexers]);

  // Apply filters and sorting
  const filteredCategorizedDownloads = useMemo(() => {
    const filtered: Record<DownloadCategory, DownloadItem[]> = {
      main: [],
      update: [],
      dlc: [],
      extra: [],
    };

    for (const [category, downloads] of Object.entries(categorizedDownloads) as [
      DownloadCategory,
      DownloadItem[],
    ][]) {
      if (!visibleCategories.has(category)) continue;

      filtered[category] = downloads
        .filter((t) => (t.seeders ?? 0) >= minSeeders)
        .filter((t) => selectedIndexer === "all" || t.indexerName === selectedIndexer)
        .sort((a, b) => {
          if (sortBy === "seeders") {
            return (b.seeders ?? 0) - (a.seeders ?? 0);
          } else if (sortBy === "date") {
            return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
          } else {
            // size
            return (b.size ?? 0) - (a.size ?? 0);
          }
        });
    }

    return filtered;
  }, [categorizedDownloads, minSeeders, selectedIndexer, sortBy, visibleCategories]);

  // Sorted items for display (by date)
  const _sortedItems = useMemo(() => {
    if (!searchResults?.items) return [];
    return [...searchResults.items].sort((a, b) => {
      const dateA = new Date(a.pubDate).getTime();
      const dateB = new Date(b.pubDate).getTime();
      return dateB - dateA;
    });
  }, [searchResults?.items]);

  const downloadMutation = useMutation({
    mutationFn: async (downloads: DownloadItem[]) => {
      // Download multiple items sequentially
      const results = [];
      for (const download of downloads) {
        const response = await apiRequest("POST", "/api/downloads", {
          url: download.link,
          title: download.title,
          gameId: game?.id,
          downloadType: isUsenetItem(download) ? "usenet" : "torrent",
        });
        results.push(await response.json());
      }
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter((r) => r.success).length;
      toast({
        title: `${successCount} download(s) started successfully`,
        description:
          results.length > 1 ? `Added ${successCount} of ${results.length} downloads` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      onOpenChange(false);
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
      setShowBundleDialog(false);
      setSelectedMainDownload(null);
    },
  });

  const handleDownload = (download: DownloadItem) => {
    // Check if this is a main game download and we have updates available
    if (categorizedDownloads.update.length > 0) {
      const downloadCategory = groupDownloadsByCategory([download]);

      if (downloadCategory.main.length > 0) {
        // This is a main game download, ask if user wants to include updates
        setSelectedMainDownload(download);
        setIsDirectDownloadMode(false);
        // Select all updates by default
        setSelectedUpdateIndices(new Set(categorizedDownloads.update.map((_, i) => i)));
        setShowBundleDialog(true);
        return;
      }
    }

    // Otherwise, download normally
    setDownloadingGuid(download.guid || download.link);
    downloadMutation.mutate([download]);
  };

  const handleBundleDownload = (includeUpdates: boolean) => {
    if (!selectedMainDownload) return;

    const guid = selectedMainDownload.guid || selectedMainDownload.link;
    setDownloadingGuid(guid);

    if (includeUpdates && selectedUpdateIndices.size > 0) {
      // Download main game + selected updates
      const selectedUpdates = Array.from(selectedUpdateIndices).map(
        (i) => categorizedDownloads.update[i]
      );
      downloadMutation.mutate([selectedMainDownload, ...selectedUpdates]);
    } else {
      // Download only main game
      downloadMutation.mutate([selectedMainDownload]);
    }
  };

  const downloadFile = (download: DownloadItem) => {
    const link = document.createElement("a");
    link.href = download.link;
    const isUsenet = isUsenetItem(download);
    link.download = `${download.title}.${isUsenet ? "nzb" : "torrent"}`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const _handleDirectDownload = (download: DownloadItem) => {
    // Check if this is a main game download and we have updates available
    if (categorizedDownloads.update.length > 0) {
      const downloadCategory = groupDownloadsByCategory([download]);

      if (downloadCategory.main.length > 0) {
        // This is a main game download, ask if user wants to include updates
        setSelectedMainDownload(download);
        setIsDirectDownloadMode(true);
        // Select all updates by default
        setSelectedUpdateIndices(new Set(categorizedDownloads.update.map((_, i) => i)));
        setShowBundleDialog(true);
        return;
      }
    }

    // Otherwise, download normally
    downloadFile(download);
    toast({
      title: "Download started",
      description: "File download initiated",
    });
  };

  const _handleDirectDownloadWithUpdates = async (mainDownload: DownloadItem) => {
    // Check if there are updates to bundle
    if (categorizedDownloads.update.length === 0) {
      downloadFile(mainDownload);
      toast({
        title: "Download started",
        description: "File download initiated",
      });
      return;
    }

    setSelectedMainDownload(mainDownload);
    setIsDirectDownloadMode(true);
    // Select all updates by default
    setSelectedUpdateIndices(new Set(categorizedDownloads.update.map((_, i) => i)));
    setShowBundleDialog(true);
  };

  const handleBundleDirectDownload = async (includeUpdates: boolean) => {
    if (!selectedMainDownload) return;

    if (includeUpdates && selectedUpdateIndices.size > 0) {
      // Download selected updates as a ZIP bundle
      const selectedUpdates = Array.from(selectedUpdateIndices).map(
        (i) => categorizedDownloads.update[i]
      );
      const downloads = [selectedMainDownload, ...selectedUpdates];

      try {
        const response = await apiRequest("POST", "/api/downloads/bundle", { downloads });

        // Download the ZIP file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${selectedMainDownload.title}-bundle.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        toast({
          title: `Bundle downloaded`,
          description: `ZIP file with ${downloads.length} item(s)`,
        });
      } catch (error) {
        toast({
          title: "Failed to create bundle",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    } else {
      downloadFile(selectedMainDownload);
      toast({
        title: "Download started",
        description: "File download initiated",
      });
    }

    setShowBundleDialog(false);
    setSelectedMainDownload(null);
  };

  const toggleUpdateSelection = (index: number) => {
    setSelectedUpdateIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const selectAllUpdates = () => {
    setSelectedUpdateIndices(new Set(categorizedDownloads.update.map((_, i) => i)));
  };

  const deselectAllUpdates = () => {
    setSelectedUpdateIndices(new Set());
  };

  const toggleCategory = (category: DownloadCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (!game) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Download {game.title}</DialogTitle>
          <DialogDescription>
            Search results for torrents and NZBs matching this game.{" "}
            <span className="text-muted-foreground/80">
              Tip: Enable auto-download in Settings to automatically download new releases.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-shrink-0 mt-4 space-y-3">
          <Input
            type="text"
            placeholder="Search for downloads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {showFilters ? "Hide Filters" : "Show Filters"}
            </Button>
            {minSeeders > 0 && (
              <Badge variant="secondary" className="text-xs">
                Min Seeders: {minSeeders}
              </Badge>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-3 gap-4 p-4 border rounded-md bg-muted/50">
              <div className="space-y-2">
                <Label htmlFor="indexer" className="text-sm">Indexer</Label>
                <Select
                  value={selectedIndexer}
                  onValueChange={setSelectedIndexer}
                  disabled={availableIndexers.length === 1}
                >
                  <SelectTrigger id="indexer">
                    <SelectValue placeholder="All Indexers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {availableIndexers.length === 1 ? availableIndexers[0] : "All Indexers"}
                    </SelectItem>
                    {availableIndexers.length > 1 &&
                      availableIndexers.map((indexer) => (
                        <SelectItem key={indexer} value={indexer as string}>
                          {indexer}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="minSeeders" className="text-sm">
                  Min Seeders
                </Label>
                <Input
                  id="minSeeders"
                  type="number"
                  min="0"
                  value={minSeeders}
                  onChange={(e) => setMinSeeders(parseInt(e.target.value) || 0)}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sortBy" className="text-sm">
                  Sort By
                </Label>
                <Select
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as "seeders" | "date" | "size")}
                >
                  <SelectTrigger id="sortBy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seeders">Seeders (High to Low)</SelectItem>
                    <SelectItem value="date">Date (Newest First)</SelectItem>
                    <SelectItem value="size">Size (Largest First)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-3 space-y-2">
                <Label className="text-sm">Categories</Label>
                <div className="flex flex-wrap gap-2">
                  {(["main", "update", "dlc", "extra"] as const).map((cat) => (
                    <div key={cat} className="flex items-center">
                      <Checkbox
                        id={`cat-${cat}`}
                        checked={visibleCategories.has(cat)}
                        onCheckedChange={() => toggleCategory(cat)}
                      />
                      <label
                        htmlFor={`cat-${cat}`}
                        className="ml-2 text-sm cursor-pointer capitalize"
                      >
                        {cat === "main"
                          ? "Main Game"
                          : cat === "update"
                            ? "Updates"
                            : cat === "dlc"
                              ? "DLC"
                              : "Extras"}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 mt-4 overflow-y-auto">
          <div className="space-y-4 pr-4">
            {isSearching && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Searching...</span>
              </div>
            )}

            {!isSearching && searchResults && searchResults.items.length === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>No Results Found</CardTitle>
                  <CardDescription>
                    No downloads found for this game. Try configuring indexers in settings.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {!isSearching && searchResults && searchResults.items.length > 0 && (
              <div className="space-y-6">
                {/* Render each category separately */}
                {(["main", "update", "dlc", "extra"] as const).map((category) => {
                  const downloadsInCategory = filteredCategorizedDownloads[category];
                  if (downloadsInCategory.length === 0) return null;

                  // Sort by seeders within category
                  const sortedCategoryDownloads = [...downloadsInCategory].sort((a, b) => {
                    const seedersA = a.seeders || 0;
                    const seedersB = b.seeders || 0;
                    return seedersB - seedersA;
                  });

                  return (
                    <div key={category}>
                      {/* Category Header */}
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-semibold text-base capitalize">
                          {category === "main"
                            ? "Main Game"
                            : category === "update"
                              ? "Updates & Patches"
                              : category === "dlc"
                                ? "DLC & Expansions"
                                : "Extras"}
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                          {downloadsInCategory.length}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        {category === "main"
                          ? "Full game downloads"
                          : category === "update"
                            ? "Game updates, patches, hotfixes, and crackfixes"
                            : category === "dlc"
                              ? "Downloadable content, expansions, and season passes"
                              : "Soundtracks, artbooks, and other bonus content"}
                      </div>

                      {/* Downloads in this category */}
                      <div className="border rounded-md divide-y mb-4">
                        <div className="bg-muted/50 p-2 text-xs font-medium flex justify-between items-center">
                          <div>Release Name</div>
                          <div className="w-[80px] text-right">Actions</div>
                        </div>
                        {sortedCategoryDownloads.map((download: DownloadItem) => {
                          const isUsenet = isUsenetItem(download);
                          return (
                            <div
                              key={download.guid || download.link}
                              className="p-2 text-sm hover:bg-muted/30 transition-colors"
                            >
                              <div className="flex justify-between items-start gap-4 mb-2">
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      {download.comments ? (
                                        <a
                                          href={download.comments}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          aria-label={`${download.title}`}
                                          className="font-medium flex-1 overflow-hidden whitespace-nowrap text-ellipsis max-w-100 cursor-pointer hover:underline"
                                        >
                                          {download.title}
                                        </a>
                                      ) : (
                                        <div className="font-medium flex-1 overflow-hidden whitespace-nowrap text-ellipsis max-w-100">
                                          {download.title}
                                        </div>
                                      )}
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="start">
                                      {download.title}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => handleDownload(download)}
                                  disabled={downloadingGuid === (download.guid || download.link)}
                                  className="h-7 flex-shrink-0"
                                >
                                  {downloadingGuid === (download.guid || download.link) ? (
                                    <>
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                      Downloading...
                                    </>
                                  ) : (
                                    <>
                                      <Download
                                        className="h-3 w-3 mr-1"
                                        data-testid="icon-download-action"
                                      />
                                      Download
                                    </>
                                  )}
                                </Button>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span>{formatDate(download.pubDate)}</span>
                                  <span>•</span>
                                  <span>{download.size ? formatBytes(download.size) : "-"}</span>
                                  <span>•</span>
                                  {isUsenet ? (
                                    <div className="flex items-center gap-2">
                                      {download.grabs !== undefined && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-blue-600 font-medium">
                                            {download.grabs}
                                          </span>
                                          <span>grabs</span>
                                        </div>
                                      )}
                                      {download.grabs !== undefined && download.age !== undefined && (
                                        <span>•</span>
                                      )}
                                      {download.age !== undefined && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-purple-600 font-medium">
                                            {formatAge(download.age)}
                                          </span>
                                          <span>old</span>
                                        </div>
                                      )}
                                    </div>
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
                                      <span
                                        className="truncate max-w-[200px]"
                                        title={download.description}
                                      >
                                        {download.description}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {download.indexerName && (
                                  <span className="flex-shrink-0">{download.indexerName}</span>
                                )}
                                <div className="flex flex-grow-1 justify-end">
                                  <Badge
                                    variant={isUsenet ? "secondary" : "default"}
                                    className="text-xs flex-shrink-0"
                                  >
                                    {isUsenet ? (
                                      <>
                                        <Newspaper className="h-3 w-3 mr-1" />
                                        NZB
                                      </>
                                    ) : (
                                      <>
                                        <Download className="h-3 w-3 mr-1" />
                                        TORRENT
                                      </>
                                    )}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
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

      {/* Bundle Confirmation Dialog */}
      <AlertDialog open={showBundleDialog} onOpenChange={setShowBundleDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Download with Updates?</AlertDialogTitle>
            <AlertDialogDescription>
              {categorizedDownloads.update.length} update(s) are available for this game. Select
              which updates you want to download with the main game.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* List of updates with checkboxes */}
          {categorizedDownloads.update.length > 0 && (
            <div className="my-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Available Updates:</div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllUpdates}
                    className="h-7 text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deselectAllUpdates}
                    className="h-7 text-xs"
                  >
                    Deselect All
                  </Button>
                </div>
              </div>
              <div className="border rounded-md">
                <ScrollArea className="h-[300px]">
                  <div className="p-3 space-y-3">
                    {categorizedDownloads.update.map((update, index) => (
                      <div
                        key={update.guid || update.link}
                        className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          id={`update-${index}`}
                          checked={selectedUpdateIndices.has(index)}
                          onCheckedChange={() => toggleUpdateSelection(index)}
                          className="mt-1"
                        />
                        <label
                          htmlFor={`update-${index}`}
                          className="flex-1 cursor-pointer text-sm"
                        >
                          <div className="font-medium">{update.title}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                            {update.size && <span>{formatBytes(update.size)}</span>}
                            {update.seeders !== undefined && (
                              <>
                                <span>•</span>
                                <span className="text-green-600">{update.seeders} seeders</span>
                              </>
                            )}
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                {selectedUpdateIndices.size} of {categorizedDownloads.update.length} updates
                selected
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (isDirectDownloadMode) {
                  handleBundleDirectDownload(false);
                } else {
                  handleBundleDownload(false);
                }
              }}
            >
              No, just the main game
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (isDirectDownloadMode) {
                  handleBundleDirectDownload(true);
                } else {
                  handleBundleDownload(true);
                }
              }}
              disabled={selectedUpdateIndices.size === 0}
            >
              <PackagePlus className="w-4 h-4 mr-2" />
              Download with {selectedUpdateIndices.size} update(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
