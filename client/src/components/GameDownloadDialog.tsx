import React, { useState, useEffect, useMemo, useCallback } from "react";
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
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Download,
  Loader2,
  PackagePlus,
  SlidersHorizontal,
  Newspaper,
  Magnet,
  MoreVertical,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Activity,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type Game,
  type Indexer,
  type UserSettings,
  type Downloader,
  downloadRulesSchema,
} from "@shared/schema";
import { groupDownloadsByCategory, type DownloadCategory } from "@shared/download-categorizer";
import { parseReleaseMetadata } from "@shared/title-utils";

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
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"seeders" | "date" | "size">("seeders");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState<Set<DownloadCategory>>(
    new Set(["main", "update", "dlc", "extra"] as DownloadCategory[])
  );

  const setDefaults = useCallback(() => {
    setSearchQuery("");
    setShowBundleDialog(false);
    setSelectedMainDownload(null);
    setIsDirectDownloadMode(false);
    setSelectedUpdateIndices(new Set());
    setMinSeeders(0);
    setSelectedIndexer("all");
    setSelectedGroups([]);
    setSortBy("seeders");
    setSortOrder("desc");
    setShowFilters(false);
    setVisibleCategories(new Set(["main", "update", "dlc", "extra"] as DownloadCategory[]));
  }, []);

  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
    enabled: open,
  });

  const applyDownloadRules = useCallback(() => {
    if (userSettings?.downloadRules) {
      try {
        const rules = downloadRulesSchema.parse(JSON.parse(userSettings.downloadRules));
        setMinSeeders(rules.minSeeders);
        setSortBy(rules.sortBy);
        setSortOrder("desc"); // Default to desc when applying rules
        if (rules.visibleCategories) {
          setVisibleCategories(new Set(rules.visibleCategories as DownloadCategory[]));
        }
      } catch (error) {
        console.warn("Failed to apply download rules from settings", error);
      }
    }
  }, [userSettings?.downloadRules]);

  // Auto-populate search when dialog opens with game title
  useEffect(() => {
    if (open && game) {
      setSearchQuery(game.title);
      applyDownloadRules();
    } else if (!open) {
      setDefaults();
    }
  }, [open, game, applyDownloadRules, setDefaults]);

  const { data: searchResults, isLoading: isSearching } = useQuery<SearchResult>({
    queryKey: [`/api/search?query=${encodeURIComponent(searchQuery)}`],
    enabled: open && searchQuery.trim().length > 0,
  });

  const { data: enabledIndexers } = useQuery<Indexer[]>({
    queryKey: ["/api/indexers/enabled"],
    enabled: open,
  });

  const { data: downloaders = [] } = useQuery<Downloader[]>({
    queryKey: ["/api/downloaders/enabled"],
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

  const availableGroups = useMemo(() => {
    if (!searchResults?.items) return [];
    const groups = new Set<string>();
    searchResults.items.forEach((item) => {
      const metadata = parseReleaseMetadata(item.title);
      if (metadata.group) {
        groups.add(metadata.group);
      }
    });
    return Array.from(groups).sort();
  }, [searchResults?.items]);

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
        .filter((t) => {
          if (selectedGroups.length === 0) return true;
          const metadata = parseReleaseMetadata(t.title);
          return metadata.group && selectedGroups.includes(metadata.group);
        })
        .sort((a, b) => {
          let comparison = 0;
          if (sortBy === "seeders") {
            comparison = (b.seeders ?? 0) - (a.seeders ?? 0);
          } else if (sortBy === "date") {
            comparison = new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
          } else {
            // size
            comparison = (b.size ?? 0) - (a.size ?? 0);
          }
          return sortOrder === "desc" ? comparison : -comparison;
        });
    }

    return filtered;
  }, [
    categorizedDownloads,
    minSeeders,
    selectedIndexer,
    selectedGroups,
    sortBy,
    sortOrder,
    visibleCategories,
  ]);

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

  const sendToDownloaderMutation = useMutation({
    mutationFn: async ({
      download,
      downloaderId,
    }: {
      download: DownloadItem;
      downloaderId: string;
    }) => {
      const response = await apiRequest("POST", `/api/downloaders/${downloaderId}/downloads`, {
        url: download.link,
        title: download.title,
        gameId: game?.id,
        downloadType: isUsenetItem(download) ? "usenet" : "torrent",
      });
      return response.json();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({ title: "Download started successfully" });
        queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
        onOpenChange(false);
      } else {
        toast({ title: result.message || "Failed to start download", variant: "destructive" });
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

  // Unused currently, can this be removed?
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

  // Unused currently, can this be removed?
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

  const toggleSort = (field: "seeders" | "date" | "size") => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const SortHeader = ({
    field,
    label,
    className = "",
  }: {
    field: "seeders" | "date" | "size";
    label: string;
    className?: string;
  }) => (
    <button
      onClick={() => toggleSort(field)}
      className={cn(
        "flex items-center hover:text-foreground transition-colors uppercase tracking-wider font-bold",
        sortBy === field ? "text-foreground" : "text-muted-foreground/70",
        className
      )}
    >
      {label}
      {sortBy === field ? (
        sortOrder === "asc" ? (
          <ArrowUp className="h-3 w-3 ml-1" />
        ) : (
          <ArrowDown className="h-3 w-3 ml-1" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );

  if (!game) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
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
            <Badge variant="outline" className="text-xs capitalize">
              Sorted by: {sortBy} ({sortOrder === "asc" ? "Asc" : "Desc"})
            </Badge>
          </div>

          {showFilters && (
            <div className="grid grid-cols-3 gap-4 p-4 border rounded-md bg-muted/50">
              <div className="space-y-2">
                <Label htmlFor="indexer" className="text-sm">
                  Indexer
                </Label>
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
                <Label htmlFor="group" className="text-sm">
                  Release Groups
                </Label>
                <MultiSelect
                  id="group-select"
                  placeholder="All Groups"
                  options={availableGroups.map((group) => ({ label: group, value: group }))}
                  selected={selectedGroups}
                  onChange={setSelectedGroups}
                  disabled={availableGroups.length === 0}
                />
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
              <div className="space-y-8">
                {/* Render each category separately */}
                {(["main", "update", "dlc", "extra"] as const).map((category) => {
                  const downloadsInCategory = filteredCategorizedDownloads[category] || [];
                  if (downloadsInCategory.length === 0) return null;

                  return (
                    <div key={category} className="relative">
                      {/* Category Header */}
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <h3 className="font-bold text-lg capitalize tracking-tight">
                          {category === "main"
                            ? "Main Game"
                            : category === "update"
                              ? "Updates & Patches"
                              : category === "dlc"
                                ? "DLC & Expansions"
                                : "Extras"}
                        </h3>
                        <Badge variant="secondary" className="text-xs font-semibold">
                          {downloadsInCategory.length}
                        </Badge>
                      </div>

                      {/* Downloads in this category */}
                      <div className="border rounded-md divide-y mb-4 bg-card overflow-hidden">
                        {/* Sticky Sort Header */}
                        <div className="sticky top-0 z-10 bg-muted/95 backdrop-blur-md p-3 text-[10px] font-bold flex items-center px-4 border-b group">
                          <div className="flex-1 flex items-center">
                            <span className="text-muted-foreground/70 uppercase tracking-widest">
                              Release Information
                            </span>
                          </div>
                          <div className="flex items-center gap-6 md:gap-10">
                            <SortHeader
                              field="date"
                              label="Date"
                              className="min-w-[70px] justify-end"
                            />
                            <SortHeader
                              field="size"
                              label="Size"
                              className="min-w-[70px] justify-end"
                            />
                            <SortHeader
                              field="seeders"
                              label="Health"
                              className="min-w-[70px] justify-end"
                            />
                            <div className="w-[80px] text-right text-muted-foreground/70 uppercase tracking-widest">
                              Actions
                            </div>
                          </div>
                        </div>

                        {downloadsInCategory.map((download: DownloadItem) => {
                          const isUsenet = isUsenetItem(download);
                          const metadata = parseReleaseMetadata(download.title);

                          // Health calculation
                          let healthColor = "text-muted-foreground";

                          if (isUsenet) {
                            const grabs = download.grabs ?? 0;
                            if (grabs > 100) healthColor = "text-green-500";
                            else if (grabs > 20) healthColor = "text-amber-500";
                            else healthColor = "text-red-500";
                          } else {
                            const seeders = download.seeders ?? 0;
                            if (seeders >= 20) healthColor = "text-green-500";
                            else if (seeders >= 5) healthColor = "text-amber-500";
                            else healthColor = "text-red-500";
                          }

                          const pubDate = new Date(download.pubDate);
                          const hoursOld = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
                          const isNew = hoursOld <= 24;

                          return (
                            <div
                              key={download.guid || download.link}
                              className="p-4 text-sm hover:bg-muted/30 transition-colors group/row"
                            >
                              <div className="flex items-center gap-4">
                                {/* Left Side: Title and Metadata */}
                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={cn(
                                            "h-5 w-5 flex items-center justify-center rounded-full flex-shrink-0",
                                            isUsenet ? "text-amber-500" : "text-violet-500"
                                          )}
                                        >
                                          {isUsenet ? (
                                            <Newspaper className="h-4 w-4" />
                                          ) : (
                                            <Magnet className="h-4 w-4" />
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {isUsenet ? "Usenet (NZB)" : "Torrent"}
                                      </TooltipContent>
                                    </Tooltip>

                                    <h4 className="font-bold text-base truncate leading-tight">
                                      {metadata.gameTitle || download.title}
                                    </h4>

                                    {isNew && (
                                      <Badge
                                        variant="default"
                                        className="h-4 px-1 text-[8px] uppercase bg-blue-600 hover:bg-blue-600"
                                      >
                                        NEW
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Metadata Line */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {metadata.version && (
                                      <Badge
                                        variant="secondary"
                                        className="h-5 px-1.5 text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border-none"
                                      >
                                        {metadata.version}
                                      </Badge>
                                    )}
                                    {metadata.languages?.map((lang) => (
                                      <Badge
                                        key={lang}
                                        variant="secondary"
                                        className="h-5 px-1.5 text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 border-none"
                                      >
                                        {lang}
                                      </Badge>
                                    ))}
                                    {metadata.drm && (
                                      <Badge
                                        variant="secondary"
                                        className="h-5 px-1.5 text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border-none"
                                      >
                                        {metadata.drm}
                                      </Badge>
                                    )}
                                    {metadata.platform && (
                                      <Badge
                                        variant="secondary"
                                        className="h-5 px-1.5 text-[10px] bg-orange-500/10 text-orange-600 dark:text-orange-400 border-none"
                                      >
                                        {metadata.platform}
                                      </Badge>
                                    )}
                                    {metadata.isScene && (
                                      <Badge
                                        variant="outline"
                                        className="h-5 px-1.5 text-[10px] border-muted-foreground/30 text-muted-foreground uppercase tracking-tighter"
                                      >
                                        Scene
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Release info line */}
                                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                                    <span
                                      className="font-medium truncate max-w-[300px]"
                                      title={download.title}
                                    >
                                      {download.title}
                                    </span>
                                    {metadata.group && (
                                      <>
                                        <span>•</span>
                                        <span className="font-bold text-foreground/50">
                                          {metadata.group}
                                        </span>
                                      </>
                                    )}
                                    <span>•</span>
                                    <span>{download.indexerName}</span>
                                  </div>
                                </div>

                                {/* Right Side: Metrics and Actions */}
                                <div className="flex items-center gap-6 md:gap-10 flex-shrink-0">
                                  {/* Date Column */}
                                  <div className="min-w-[70px] text-right">
                                    <div className="text-xs font-medium">
                                      {formatDate(download.pubDate)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground/50">
                                      {formatAge(isUsenet ? download.age : hoursOld / 24)}
                                    </div>
                                  </div>

                                  {/* Size Column */}
                                  <div className="min-w-[70px] text-right font-mono text-xs font-bold">
                                    {download.size ? formatBytes(download.size) : "-"}
                                  </div>

                                  {/* Health Column */}
                                  <div
                                    className={cn(
                                      "min-w-[70px] text-right flex flex-col items-end justify-center",
                                      healthColor
                                    )}
                                  >
                                    <div className="flex items-center gap-1 font-bold">
                                      <Activity className="h-3 w-3" />
                                      {isUsenet ? (download.grabs ?? 0) : (download.seeders ?? 0)}
                                    </div>
                                    <div className="text-[10px] uppercase font-bold opacity-70">
                                      {isUsenet ? "Grabs" : "Seeds"}
                                    </div>
                                  </div>

                                  {/* Actions Column */}
                                  <div className="w-[80px] flex items-center justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDownload(download)}
                                      disabled={
                                        downloadingGuid === (download.guid || download.link)
                                      }
                                      className="h-9 w-9 hover:bg-primary hover:text-primary-foreground transition-all"
                                    >
                                      {downloadingGuid === (download.guid || download.link) ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Download className="h-4 w-4" />
                                      )}
                                    </Button>

                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-9 w-9">
                                          <MoreVertical className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          onClick={() => {
                                            navigator.clipboard.writeText(download.link);
                                            toast({ description: "Link copied to clipboard" });
                                          }}
                                        >
                                          <Copy className="h-4 w-4 mr-2" />
                                          Copy {isUsenet ? "NZB" : "Torrent"} Link
                                        </DropdownMenuItem>

                                        {(() => {
                                          const compatibleDownloaders = downloaders.filter((d) =>
                                            isUsenet
                                              ? ["sabnzbd", "nzbget"].includes(d.type)
                                              : [
                                                  "transmission",
                                                  "rtorrent",
                                                  "qbittorrent",
                                                ].includes(d.type)
                                          );

                                          if (compatibleDownloaders.length <= 1) {
                                            return null;
                                          }

                                          return (
                                            <DropdownMenuSub>
                                              <DropdownMenuSubTrigger>
                                                <Download className="h-4 w-4 mr-2" />
                                                Send to downloader
                                              </DropdownMenuSubTrigger>
                                              <DropdownMenuPortal>
                                                <DropdownMenuSubContent>
                                                  {compatibleDownloaders.map((d) => (
                                                    <DropdownMenuItem
                                                      key={d.id}
                                                      onClick={() =>
                                                        sendToDownloaderMutation.mutate({
                                                          download,
                                                          downloaderId: d.id,
                                                        })
                                                      }
                                                    >
                                                      {d.name}
                                                    </DropdownMenuItem>
                                                  ))}
                                                </DropdownMenuSubContent>
                                              </DropdownMenuPortal>
                                            </DropdownMenuSub>
                                          );
                                        })()}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "outline" })}
              onClick={() => {
                if (isDirectDownloadMode) {
                  handleBundleDirectDownload(false);
                } else {
                  handleBundleDownload(false);
                }
              }}
            >
              Only the main game
            </AlertDialogAction>
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
