import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Gamepad2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
              Latest game releases listed on xREL.to (scene/P2P). No download links — for reference only.
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
                        {rel.isWanted && (
                          <Badge variant="default" className="text-xs bg-primary text-primary-foreground">
                            Wanted
                          </Badge>
                        )}
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
