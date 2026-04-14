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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Link2, CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type Game } from "@shared/schema";
import { type DownloadCategory } from "@shared/download-categorizer";
import { apiRequest } from "@/lib/queryClient";

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
      if (!data?.groups) return 0;
      const toProcess = data.groups.filter((g) => {
        const state = groupStates.get(g.baseTitle);
        return state && !state.skip && state.selectedGame;
      });

      setProgress({ done: 0, total: toProcess.length });

      let processedCount = 0;
      const groupErrors: string[] = [];

      for (let i = 0; i < toProcess.length; i++) {
        const group = toProcess[i];
        const state = groupStates.get(group.baseTitle)!;
        const selectedGame = state.selectedGame!;

        try {
          // Track the gameId returned by the first claim in this group so that
          // subsequent downloads (updates, DLC, extras) link to the same game row
          // instead of creating duplicate entries.
          let resolvedGroupGameId: string | undefined =
            selectedGame.source !== "igdb" ? selectedGame.id : undefined;

          const buildBody = (dl: (typeof group.downloads)[0], gid?: string) => {
            const body: Record<string, unknown> = {
              downloaderId: dl.downloaderId,
              downloadHash: dl.downloadHash,
              downloadTitle: dl.downloadTitle,
              currentStatus: dl.status,
              category: dl.category,
            };
            if (gid) {
              body.gameId = gid;
            } else {
              const g = selectedGame.data;
              body.newGame = {
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
              };
            }
            return body;
          };

          if (!resolvedGroupGameId && group.downloads.length > 0) {
            // Send the first download sequentially to obtain (or create) the game row,
            // then parallelise the remaining downloads using the resolved game ID.
            const first = group.downloads[0];
            const firstResponse = await apiRequest(
              "POST",
              "/api/downloads/claim",
              buildBody(first, undefined)
            );
            const firstResult = (await firstResponse.json()) as { gameId: string };
            resolvedGroupGameId = firstResult?.gameId;

            if (!resolvedGroupGameId) {
              throw new Error(`No gameId returned for group "${group.baseTitle}"`);
            }

            // Parallelize the remaining downloads now that we have a gameId
            await Promise.all(
              group.downloads
                .slice(1)
                .map((dl) =>
                  apiRequest("POST", "/api/downloads/claim", buildBody(dl, resolvedGroupGameId))
                )
            );
          } else {
            // Library game: all downloads already have a gameId — parallelise immediately
            await Promise.all(
              group.downloads.map((dl) =>
                apiRequest("POST", "/api/downloads/claim", buildBody(dl, resolvedGroupGameId))
              )
            );
          }

          processedCount++;
        } catch (err) {
          groupErrors.push(
            `"${group.baseTitle}": ${err instanceof Error ? err.message : "unknown error"}`
          );
        }

        setProgress({ done: i + 1, total: toProcess.length });
      }

      if (groupErrors.length > 0 && processedCount === 0) {
        throw new Error(`All groups failed: ${groupErrors[0]}`);
      }

      return processedCount;
    },
    onSuccess: (data) => {
      toast({ title: `Linked ${data ?? 0} group(s) to games` });
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

        <ScrollArea className="flex-1 min-h-0 pr-2">
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
        </ScrollArea>

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
    queryKey: ["/api/igdb/search", igdbDebouncedQuery],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/igdb/search?q=${encodeURIComponent(igdbDebouncedQuery)}&limit=6`
      ).then((r) => r.json()),
    enabled: state.igdbOpen && igdbDebouncedQuery.trim().length > 2,
  });

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
                onClick={() => onUpdate({ igdbOpen: !state.igdbOpen, igdbQuery: "" })}
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
              <div className="max-h-36 overflow-y-auto space-y-1">
                {searchingIgdb ? (
                  <p className="text-xs text-muted-foreground py-1 px-1">Searching…</p>
                ) : igdbResults.length === 0 &&
                  igdbDebouncedQuery.trim().length > 2 &&
                  !searchingIgdb ? (
                  <p className="text-sm text-muted-foreground py-1 px-1">No results found</p>
                ) : (
                  igdbResults.map((g) => (
                    <button
                      key={g.igdbId ?? g.id}
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
                      {g.releaseDate && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(g.releaseDate).getFullYear()}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
