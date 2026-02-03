import React, { memo } from "react";
import { ExternalLink, Calendar, Link } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { RssFeedItem } from "@shared/schema";
import { Button } from "@/components/ui/button";

interface CompactRssFeedItemProps {
  item: RssFeedItem;
}

const CompactRssFeedItem = ({ item }: CompactRssFeedItemProps) => {
  return (
    <div
      className="group flex items-center gap-4 p-3 rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:bg-accent/50"
      data-testid={`rss-item-compact-${item.id}`}
    >
      {/* Cover Image */}
      <div className="flex-shrink-0 relative w-16 h-24 rounded overflow-hidden bg-muted">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt={item.igdbGameName || item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
            <Link className="h-6 w-6 opacity-20" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-grow min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-base truncate" title={item.title}>
            {item.title}
          </h3>
          <Badge variant="secondary" className="text-xs">
            {item.sourceName}
          </Badge>
        </div>

        {item.igdbGameName && (
          <div className="text-xs text-muted-foreground truncate">
            Matched: <span className="font-medium text-foreground">{item.igdbGameName}</span>
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-auto">
          {/* Pub Date */}
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>
              {item.pubDate
                ? formatDistanceToNow(new Date(item.pubDate), { addSuffix: true })
                : "Unknown date"}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 self-center">
        <Button variant="outline" size="sm" className="h-8 gap-2" asChild>
          <a href={item.link} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4" />
            <span className="hidden sm:inline">View</span>
          </a>
        </Button>
      </div>
    </div>
  );
};

export default memo(CompactRssFeedItem);
