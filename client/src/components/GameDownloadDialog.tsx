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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, Loader2, FileDown, PackagePlus, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";
import { groupTorrentsByCategory, type TorrentCategory } from "@/lib/torrent-categorizer";

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

import { apiRequest } from "@/lib/queryClient";

export default function GameDownloadDialog({ game, open, onOpenChange }: GameDownloadDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingGuid, setDownloadingGuid] = useState<string | null>(null);
  const [showBundleDialog, setShowBundleDialog] = useState(false);
  const [selectedMainTorrent, setSelectedMainTorrent] = useState<TorrentItem | null>(null);
  const [isDirectDownloadMode, setIsDirectDownloadMode] = useState(false);
  const [selectedUpdateIndices, setSelectedUpdateIndices] = useState<Set<number>>(new Set());

  // Filter states
  const [minSeeders, setMinSeeders] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"seeders" | "date" | "size">("seeders");
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState<Set<TorrentCategory>>(
    new Set(["main", "update", "dlc", "extra"] as TorrentCategory[])
  );

  // Auto-populate search when dialog opens with game title
  useEffect(() => {
    if (open && game) {
      setSearchQuery(game.title);
    } else if (!open) {
      setSearchQuery("");
      setShowBundleDialog(false);
      setSelectedMainTorrent(null);
      setIsDirectDownloadMode(false);
      setSelectedUpdateIndices(new Set());
      setMinSeeders(0);
      setSortBy("seeders");
      setShowFilters(false);
    }
  }, [open, game]);

  const { data: searchResults, isLoading: isSearching } = useQuery<SearchResult>({
    queryKey: [`/api/search?query=${encodeURIComponent(searchQuery)}`],
    enabled: open && searchQuery.trim().length > 0,
  });

  // Categorize torrents
  const categorizedTorrents = useMemo(() => {
    if (!searchResults?.items) return { main: [], update: [], dlc: [], extra: [] };
    return groupTorrentsByCategory(searchResults.items);
  }, [searchResults?.items]);

  // Apply filters and sorting
  const filteredCategorizedTorrents = useMemo(() => {
    const filtered: Record<TorrentCategory, TorrentItem[]> = {
      main: [],
      update: [],
      dlc: [],
      extra: [],
    };

    for (const [category, torrents] of Object.entries(categorizedTorrents) as [
      TorrentCategory,
      TorrentItem[],
    ][]) {
      if (!visibleCategories.has(category)) continue;

      filtered[category] = torrents
        .filter((t) => (t.seeders ?? 0) >= minSeeders)
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
  }, [categorizedTorrents, minSeeders, sortBy, visibleCategories]);

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
    mutationFn: async (torrents: TorrentItem[]) => {
      // Download multiple torrents sequentially
      const results = [];
      for (const torrent of torrents) {
        const response = await apiRequest("POST", "/api/downloads", {
          url: torrent.link,
          title: torrent.title,
          gameId: game?.id,
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
          results.length > 1 ? `Added ${successCount} of ${results.length} torrents` : undefined,
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
      setSelectedMainTorrent(null);
    },
  });

  const handleDownload = (torrent: TorrentItem) => {
    // Check if this is a main game torrent and we have updates available
    if (categorizedTorrents.update.length > 0) {
      const torrentCategory = groupTorrentsByCategory([torrent]);

      if (torrentCategory.main.length > 0) {
        // This is a main game torrent, ask if user wants to include updates
        setSelectedMainTorrent(torrent);
        setIsDirectDownloadMode(false);
        // Select all updates by default
        setSelectedUpdateIndices(new Set(categorizedTorrents.update.map((_, i) => i)));
        setShowBundleDialog(true);
        return;
      }
    }

    // Otherwise, download normally
    setDownloadingGuid(torrent.guid || torrent.link);
    downloadMutation.mutate([torrent]);
  };

  const handleBundleDownload = (includeUpdates: boolean) => {
    if (!selectedMainTorrent) return;

    const guid = selectedMainTorrent.guid || selectedMainTorrent.link;
    setDownloadingGuid(guid);

    if (includeUpdates && selectedUpdateIndices.size > 0) {
      // Download main game + selected updates
      const selectedUpdates = Array.from(selectedUpdateIndices).map(
        (i) => categorizedTorrents.update[i]
      );
      downloadMutation.mutate([selectedMainTorrent, ...selectedUpdates]);
    } else {
      // Download only main game
      downloadMutation.mutate([selectedMainTorrent]);
    }
  };

  const downloadTorrentFile = (torrent: TorrentItem) => {
    const link = document.createElement("a");
    link.href = torrent.link;
    link.download = `${torrent.title}.torrent`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDirectDownload = (torrent: TorrentItem) => {
    // Check if this is a main game torrent and we have updates available
    if (categorizedTorrents.update.length > 0) {
      const torrentCategory = groupTorrentsByCategory([torrent]);

      if (torrentCategory.main.length > 0) {
        // This is a main game torrent, ask if user wants to include updates
        setSelectedMainTorrent(torrent);
        setIsDirectDownloadMode(true);
        // Select all updates by default
        setSelectedUpdateIndices(new Set(categorizedTorrents.update.map((_, i) => i)));
        setShowBundleDialog(true);
        return;
      }
    }

    // Otherwise, download normally
    downloadTorrentFile(torrent);
    toast({
      title: "Download started",
      description: "Torrent file download initiated",
    });
  };

  const _handleDirectDownloadWithUpdates = async (mainTorrent: TorrentItem) => {
    // Check if there are updates to bundle
    if (categorizedTorrents.update.length === 0) {
      downloadTorrentFile(mainTorrent);
      toast({
        title: "Download started",
        description: "Torrent file download initiated",
      });
      return;
    }

    setSelectedMainTorrent(mainTorrent);
    setIsDirectDownloadMode(true);
    // Select all updates by default
    setSelectedUpdateIndices(new Set(categorizedTorrents.update.map((_, i) => i)));
    setShowBundleDialog(true);
  };

  const handleBundleDirectDownload = async (includeUpdates: boolean) => {
    if (!selectedMainTorrent) return;

    if (includeUpdates && selectedUpdateIndices.size > 0) {
      // Download selected updates as a ZIP bundle
      const selectedUpdates = Array.from(selectedUpdateIndices).map(
        (i) => categorizedTorrents.update[i]
      );
      const torrents = [selectedMainTorrent, ...selectedUpdates];

      try {
        const response = await apiRequest("POST", "/api/downloads/bundle", { torrents });

        // Download the ZIP file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${selectedMainTorrent.title}-bundle.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        toast({
          title: `Bundle downloaded`,
          description: `ZIP file with ${torrents.length} torrent(s)`,
        });
      } catch (error) {
        toast({
          title: "Failed to create bundle",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    } else {
      downloadTorrentFile(selectedMainTorrent);
      toast({
        title: "Download started",
        description: "Torrent file download initiated",
      });
    }

    setShowBundleDialog(false);
    setSelectedMainTorrent(null);
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
    setSelectedUpdateIndices(new Set(categorizedTorrents.update.map((_, i) => i)));
  };

  const deselectAllUpdates = () => {
    setSelectedUpdateIndices(new Set());
  };

  const toggleCategory = (category: TorrentCategory) => {
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
          <DialogDescription>Search results for torrents matching this game</DialogDescription>
        </DialogHeader>

        <div className="flex-shrink-0 mt-4 space-y-3">
          <Input
            type="text"
            placeholder="Search for torrents..."
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
            <div className="grid grid-cols-2 gap-4 p-4 border rounded-md bg-muted/50">
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
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
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

              <div className="col-span-2 space-y-2">
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
              <div className="space-y-6">
                {/* Render each category separately */}
                {(["main", "update", "dlc", "extra"] as const).map((category) => {
                  const torrentsInCategory = filteredCategorizedTorrents[category];
                  if (torrentsInCategory.length === 0) return null;

                  // Sort by seeders within category
                  const sortedCategoryTorrents = [...torrentsInCategory].sort((a, b) => {
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
                          {torrentsInCategory.length}
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

                      {/* Torrents in this category */}
                      <div className="border rounded-md divide-y mb-4">
                        <div className="bg-muted/50 p-2 text-xs font-medium flex justify-between items-center">
                          <div>Release Name</div>
                          <div className="w-[80px] text-right">Actions</div>
                        </div>
                        {sortedCategoryTorrents.map((torrent: TorrentItem) => (
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
                                    <span
                                      className="truncate max-w-[200px]"
                                      title={torrent.description}
                                    >
                                      {torrent.description}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleDirectDownload(torrent)}
                                    className="h-8 w-8"
                                  >
                                    <FileDown className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Download .torrent file</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleDownload(torrent)}
                                    disabled={downloadingGuid !== null}
                                    className="h-8 w-8"
                                  >
                                    {downloadingGuid === (torrent.guid || torrent.link) ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Download className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Add to downloader</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        ))}
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
              {categorizedTorrents.update.length} update(s) are available for this game. Select
              which updates you want to download with the main game.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* List of updates with checkboxes */}
          {categorizedTorrents.update.length > 0 && (
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
                    {categorizedTorrents.update.map((update, index) => (
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
                {selectedUpdateIndices.size} of {categorizedTorrents.update.length} updates selected
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
