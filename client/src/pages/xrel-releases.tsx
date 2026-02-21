import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Gamepad2, RefreshCw, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface XrelRelease {
  id: string;
  dirname: string;
  link_href: string;
  time: number;
  group_name: string;
  sizeMb?: number;
  sizeUnit?: string;
  ext_info?: { title: string; link_href: string };
  source: "scene" | "p2p";
  isWanted?: boolean;
  libraryStatus?: string;
  gameId?: string;
  matchCandidate?: {
    title: string;
    igdbId: number;
    // other fields if needed for UI
  };
}

interface XrelLatestResponse {
  list: XrelRelease[];
  pagination: { current_page: number; per_page: number; total_pages: number };
  total_count: number;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatSize(mb?: number, unit?: string): string {
  if (mb == null) return "—";
  if (unit === "GB" || (mb >= 1024 && !unit)) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} ${unit || "MB"}`;
}

function safeUrl(url: string | undefined): string {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

export default function XrelReleasesPage() {
  const [page, setPage] = useState(1);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isFetching, refetch } = useQuery<XrelLatestResponse>({
    queryKey: ["/api/xrel/latest", page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      const res = await fetch(`/api/xrel/latest?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch xREL latest");
      return res.json();
    },
  });

  const addGameMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch("/api/games/match-and-add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add game");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Game added",
        description: `Added "${data.title}" to your wanted list`,
      });
      // Iterate over the list and update the item that was added to avoid full refetch if possible,
      // but simpler to just invalidates queries
      queryClient.invalidateQueries({ queryKey: ["/api/xrel/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to add game",
        description: error.message,
      });
    },
  });

  const list = data?.list ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex flex-col gap-4 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Gamepad2 className="h-6 w-6" />
              xREL.to releases
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Latest game releases listed on xREL.to (scene/P2P). No download links — for reference
              only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Latest game releases</CardTitle>
            <CardDescription>
              Filtered to games only (master_game). Data from{" "}
              <a
                href="https://www.xrel.to"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                xREL.to
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <RefreshCw className="h-8 w-8 animate-spin mr-2" />
                Loading…
              </div>
            ) : list.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No game releases found on this page.</p>
                {page < totalPages && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Note: Results are filtered to games only, so some pages may appear empty.
                  </p>
                )}
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {list.map((rel) => (
                    <li
                      key={rel.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border/50 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate" title={rel.dirname}>
                          {rel.dirname}
                        </div>
                        {rel.ext_info?.title && (
                          <div className="text-sm text-muted-foreground truncate">
                            Title: {rel.ext_info.title}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(rel.time)}
                        </span>
                        {rel.sizeMb != null && (
                          <span className="text-sm text-muted-foreground">
                            {formatSize(rel.sizeMb, rel.sizeUnit)}
                          </span>
                        )}
                        {rel.libraryStatus ? (
                          <Badge
                            variant={rel.libraryStatus === "wanted" ? "default" : "secondary"}
                            className={`text-xs ${rel.libraryStatus === "wanted" ? "bg-primary text-primary-foreground" : ""}`}
                          >
                            {rel.libraryStatus.charAt(0).toUpperCase() + rel.libraryStatus.slice(1)}
                          </Badge>
                        ) : rel.matchCandidate ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs gap-1"
                            onClick={() => {
                              // We use matchCandidate data which is already formatted via IGDB
                              // But our API expects just the fields to add.
                              // Actually, reusing the same POST endpoint /api/games/match-and-add might be weird
                              // if we already have the ID.
                              // Let's call /api/games directly or use match-and-add with title (but that re-searches).
                              // Better to call match-and-add which we updated? No we didn't update it to take ID.
                              // Let's just use match-and-add with the *candidate* title, which is the official IGDB title.
                              if (rel.matchCandidate) {
                                addGameMutation.mutate(rel.matchCandidate.title);
                              }
                            }}
                            disabled={
                              addGameMutation.isPending &&
                              addGameMutation.variables === rel.matchCandidate.title
                            }
                            title={`Add "${rel.matchCandidate.title}" to wanted list`}
                          >
                            {addGameMutation.isPending &&
                            addGameMutation.variables === rel.matchCandidate.title ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                            Add
                          </Button>
                        ) : null}
                        <Badge variant="secondary" className="text-xs">
                          {rel.source}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {rel.group_name || "—"}
                        </Badge>
                        <a
                          href={safeUrl(rel.link_href)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-0.5 text-sm"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 mt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {pagination?.current_page ?? page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
