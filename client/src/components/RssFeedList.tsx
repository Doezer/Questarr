import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RssFeedItem } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, RefreshCw, AlertTriangle, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import CompactRssFeedItem from "./CompactRssFeedItem";
import { cn, safeUrl } from "@/lib/utils";

export default function RssFeedList() {
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("rssFeedViewMode") as "grid" | "list") || "grid";
  });

  useEffect(() => {
    localStorage.setItem("rssFeedViewMode", viewMode);
  }, [viewMode]);

  const {
    data: items,
    isLoading,
    refetch,
  } = useQuery<RssFeedItem[]>({
    queryKey: ["/api/rss/items"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/rss/items");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes to check for matched items appearing
  });

  const { mutate: refreshFeeds, isPending: isRefreshing } = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/rss/refresh");
    },
    onSuccess: () => {
      refetch();
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-64 text-muted-foreground space-y-4">
        <AlertTriangle className="h-12 w-12 opacity-50" />
        <p>No RSS items found. Make sure you have enabled feeds and refreshed.</p>
        <Button onClick={() => refreshFeeds()} disabled={isRefreshing} variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Feeds
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2 border rounded-md p-1 bg-muted/50">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode("grid")}
            title="Grid View"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode("list")}
            title="List View"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <Button onClick={() => refreshFeeds()} disabled={isRefreshing} size="sm" variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Feeds
        </Button>
      </div>

      <div
        className={cn(
          "grid gap-4",
          viewMode === "grid" ? "md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
        )}
      >
        {items.map((item) =>
          viewMode === "list" ? (
            <CompactRssFeedItem key={item.id} item={item} />
          ) : (
            <Card
              key={item.id}
              className="overflow-hidden flex flex-col h-full hover:shadow-md transition-shadow"
            >
              {item.coverUrl && (
                <div className="aspect-video w-full overflow-hidden bg-muted relative">
                  <img
                    src={item.coverUrl}
                    alt={item.igdbGameName || item.title}
                    className="w-full h-full object-cover"
                  />
                  {item.igdbGameName && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-2 text-xs truncate">
                      Matched: {item.igdbGameName}
                    </div>
                  )}
                </div>
              )}
              <CardHeader className="p-4 pb-2 flex-grow">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <Badge variant="secondary" className="text-xs">
                    {item.sourceName}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {item.pubDate
                      ? formatDistanceToNow(new Date(item.pubDate), { addSuffix: true })
                      : ""}
                  </span>
                </div>
                <CardTitle className="text-sm font-medium leading-tight" title={item.title}>
                  {item.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 mt-auto">
                <a
                  href={safeUrl(item.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Original
                </a>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
