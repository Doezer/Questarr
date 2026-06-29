import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Search, Link2, CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";
import { type DownloadCategory } from "@shared/download-categorizer";
import { apiRequest } from "@/lib/queryClient";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseReleaseDate } from "@/lib/utils";

interface ScanDownload {
  downloaderId: string;
  downloaderName: string;
  downloadId: string;
  downloadHash: string;
  downloadTitle: string;
  status: string;
  downloadType: "torrent" | "usenet";
  category: DownloadCategory;
  categoryConfidence: number;
}

interface ScanGroup {
  baseTitle: string;
  downloads: ScanDownload[];
  libraryMatch: { game: Game; confidence: number } | null;
}

interface ScanResponse {
  groups: ScanGroup[];
}

interface GroupState {
  selectedGame: { id?: string; title: string; source: "library" | "igdb"; data: Game } | null;
  skip: boolean;
  igdbQuery: string;
  igdbOpen: boolean;
  showUndatedGames: boolean;
}

interface ClaimBatchModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const CATEGORY_LABELS: Record<DownloadCategory, string> = {
  main: "Main",
  update: "Update",
  dlc: "DLC",
  extra: "Extra",
};

const CATEGORY_COLORS: Record<DownloadCategory, string> = {
  main: "bg-blue-500/20 text-blue-400",
  update: "bg-yellow-500/20 text-yellow-400",
  dlc: "bg-purple-500/20 text-purple-400",
  extra: "bg-gray-500/20 text-gray-400",
};

export default function ClaimBatchModal({ open, onOpenChange }: ClaimBatchModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [groupStates, setGroupStates] = useState<Map<string, GroupState>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // CBM-4: Reset group states when modal closes so re-opens start fresh
  useEffect(() => {
    if (!open) {
      setGroupStates(new Map());
    }
  }, [open]);

  const { data, isLoading, error } = useQuery<ScanResponse>({
    queryKey: ["/api/downloads/scan"],
    queryFn: () => apiRequest("GET", "/api/downloads/scan").then((r) => r.json()),
    enabled: open,
    staleTime: 0,
  });

  // Initialize group states when scan data arrives or when modal reopens with cached data
  useEffect(() => {
    if (!open || !data?.groups) return;
    setGroupStates((prev) => {
      const next = new Map(prev);
      for (const group of data.groups) {
        if (!next.has(group.baseTitle)) {
          next.set(group.baseTitle, {
            selectedGame: group.libraryMatch
              ? {
                  id: group.libraryMatch.game.id,
                  title: group.libraryMatch.game.title,
                  source: "library",
                  data: group.libraryMatch.game,
                }
              : null,
            skip: false,
            igdbQuery: "",
            igdbOpen: false,
            showUndatedGames: false,
          });
        }
      }
      return next;
    });
  }, [data, open]);

  const updateGroup = useCallback((key: string, patch: Partial<GroupState>) => {
    setGroupStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(key);
      if (cur) next.set(key, { ...cur, ...patch });
      return next;
    });
  }, []);

  const claimAllMutation = useMutation({
    mutationFn: async () => {
      if (!data?.groups) return { count: 0, hadErrors: false };
      const toProcess = data.groups.filter((g) => {
        const state = groupStates.get(g.baseTitle);
        return state && !state.skip && state.selectedGame;
      });

      setProgress({ done: 0, total: toProcess.length });

      // Build all claim items upfront — IGDB groups send newGame for every download
      // so the server's igdbId dedup handles game reuse within the same batch.
      const items = toProcess.flatMap((group) => {
        const state = groupStates.get(group.baseTitle)!;
        const selectedGame = state.selectedGame!;
        const isLibrary = selectedGame.source === "library";
        const g = selectedGame.data;

        return group.downloads.map((dl) => {
          const base = {
            downloaderId: dl.downloaderId,
            downloadHash: dl.downloadHash,
            downloadTitle: dl.downloadTitle,
            currentStatus: dl.status,
            category: dl.category,
          };
          if (isLibrary) {
            return { ...base, gameId: selectedGame.id! };
          }
          return {
            ...base,
            newGame: {
              igdbId: g.igdbId,
              title: g.title,
              coverUrl: g.coverUrl,
              summary: g.summary,
              releaseDate: g.releaseDate,
              platforms: g.platforms,
              genres: g.genres,
              rating: g.rating,
              aggregatedRating: g.aggregatedRating,
              screenshots: g.screenshots,
              igdbWebsites: g.igdbWebsites,
            },
          };
        });
      });

      const response = await apiRequest("POST", "/api/downloads/claim-batch", { items });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Batch claim failed with status ${response.status}`);
      }
      const result = (await response.json()) as {
        addedCount: number;
        failedCount: number;
        skippedCount: number;
      };

      setProgress({ done: toProcess.length, total: toProcess.length });

      return { count: result.addedCount, hadErrors: result.failedCount > 0 };
    },
    onSuccess: (result) => {
      const { count, hadErrors } = result ?? { count: 0, hadErrors: false };
      if (hadErrors) {
        toast({
          title: `Linked ${count} group(s) — some groups failed`,
          description: "One or more groups could not be claimed. Check your downloads.",
          variant: "destructive",
        });
      } else {
        toast({ title: `Linked ${count} group(s) to games` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/downloads/scan"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: err.message || "Failed to claim downloads", variant: "destructive" });
    },
    onSettled: () => setProgress(null),
  });

  const pendingCount =
    data?.groups.filter((g) => {
      const state = groupStates.get(g.baseTitle);
      return state && !state.skip && state.selectedGame;
    }).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Scan Unlinked Downloads</DialogTitle>
          <DialogDescription>
            Downloads not yet tracked by Questarr, grouped by game. Select a game for each to link
            them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scanning downloads…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              Failed to scan downloads
            </div>
          )}

          {data && data.groups.length === 0 && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              All downloads are already linked to games
            </div>
          )}

          {data &&
            data.groups.map((group) => {
              const state = groupStates.get(group.baseTitle);
              if (!state) return null;
              return (
                <GroupRow
                  key={group.baseTitle}
                  group={group}
                  state={state}
                  onUpdate={(patch) => updateGroup(group.baseTitle, patch)}
                />
              );
            })}
        </div>

        {progress && (
          <p className="text-sm text-muted-foreground text-center">
            Claiming {progress.done} / {progress.total}…
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <span className="text-sm text-muted-foreground">{pendingCount} group(s) ready</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => claimAllMutation.mutate()}
              disabled={pendingCount === 0 || claimAllMutation.isPending}
            >
              <Link2 className="h-4 w-4 mr-2" />
              {claimAllMutation.isPending ? "Claiming…" : `Claim ${pendingCount}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupRow({
  group,
  state,
  onUpdate,
}: {
  group: ScanGroup;
  state: GroupState;
  onUpdate: (patch: Partial<GroupState>) => void;
}) {
  const [igdbDebouncedQuery, setIgdbDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setIgdbDebouncedQuery(state.igdbQuery), 500);
    return () => clearTimeout(t);
  }, [state.igdbQuery]);

  const { data: igdbResults = [], isLoading: searchingIgdb } = useQuery<Game[]>({
    queryKey: ["/api/igdb/search", igdbDebouncedQuery, state.showUndatedGames],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/igdb/search?q=${encodeURIComponent(igdbDebouncedQuery)}&limit=6&includeUndated=${state.showUndatedGames}`
      ).then((r) => r.json()),
    enabled: state.igdbOpen && igdbDebouncedQuery.trim().length > 2,
  });

  if (group.downloads.length === 0) return null;
  const mainDownload = group.downloads.find((d) => d.category === "main") ?? group.downloads[0];

  return (
    <div
      className={`border rounded-lg p-3 mb-3 transition-opacity ${state.skip ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id={`skip-${group.baseTitle}`}
          checked={!state.skip}
          onCheckedChange={(v) => onUpdate({ skip: !v })}
          aria-label="Include this group"
          className="mt-0.5"
        />

        <div className="flex-1 min-w-0">
          {/* Downloads in group */}
          <div className="space-y-1 mb-2">
            {group.downloads.map((dl) => (
              <div key={dl.downloadId} className="flex items-center gap-2 text-sm">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${CATEGORY_COLORS[dl.category]}`}
                >
                  {CATEGORY_LABELS[dl.category]}
                </span>
                <span className="truncate text-muted-foreground">{dl.downloadTitle}</span>
                <Badge variant="outline" className="text-xs shrink-0">
                  {dl.status}
                </Badge>
              </div>
            ))}
          </div>

          {/* Game match section */}
          {state.selectedGame ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-sm font-medium truncate">{state.selectedGame.title}</span>
              <Badge variant="secondary" className="text-xs shrink-0">
                {state.selectedGame.source === "library" ? "Library" : "IGDB"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs ml-auto"
                onClick={() => {
                  onUpdate({ igdbOpen: !state.igdbOpen, igdbQuery: "" });
                  setIgdbDebouncedQuery("");
                }}
              >
                Change
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
              <span className="text-sm text-muted-foreground">No library match found</span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs ml-auto"
                onClick={() =>
                  onUpdate({
                    igdbOpen: !state.igdbOpen,
                    igdbQuery: state.igdbOpen ? state.igdbQuery : mainDownload.downloadTitle,
                  })
                }
              >
                <Search className="h-3 w-3 mr-1" />
                Search IGDB
              </Button>
            </div>
          )}

          {/* Inline IGDB search */}
          {state.igdbOpen && (
            <div className="mt-2 space-y-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-7 h-8 text-sm"
                  placeholder="Search IGDB…"
                  value={state.igdbQuery}
                  onChange={(e) => onUpdate({ igdbQuery: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Show undated games first</p>
                  <p className="text-xs text-muted-foreground">
                    Include titles without a release date and place them before dated results.
                  </p>
                </div>
                <Switch
                  checked={state.showUndatedGames}
                  onCheckedChange={(showUndatedGames) => onUpdate({ showUndatedGames })}
                />
              </div>
              <div className="max-h-36 overflow-y-auto">
                <div className="space-y-1">
                  {searchingIgdb ? (
                    <p className="text-xs text-muted-foreground py-1 px-1">Searching…</p>
                  ) : igdbResults.length === 0 &&
                    igdbDebouncedQuery.trim().length > 2 &&
                    !searchingIgdb ? (
                    <p className="text-sm text-muted-foreground py-1 px-1">No results found</p>
                  ) : (
                    igdbResults.map((g) => (
                      <button
                        key={g.igdbId?.toString() ?? g.title}
                        type="button"
                        onClick={() => {
                          onUpdate({
                            selectedGame: {
                              id: undefined,
                              title: g.title,
                              source: "igdb",
                              data: g,
                            },
                            igdbOpen: false,
                          });
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1 rounded text-sm hover:bg-accent text-left"
                      >
                        {g.coverUrl ? (
                          <img
                            src={g.coverUrl}
                            alt={g.title}
                            className="h-8 w-6 object-cover rounded shrink-0"
                          />
                        ) : (
                          <div className="h-8 w-6 rounded bg-muted shrink-0" />
                        )}
                        <span className="truncate">{g.title}</span>
                        {g.releaseDate &&
                          (() => {
                            const { year, fullDate } = parseReleaseDate(g.releaseDate);
                            return fullDate ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground shrink-0 cursor-default">
                                    {year}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{fullDate}</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-xs text-muted-foreground shrink-0">{year}</span>
                            );
                          })()}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
