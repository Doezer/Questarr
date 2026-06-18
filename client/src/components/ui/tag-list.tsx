import * as React from "react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TagListProps {
  items: string[];
  variant?: "secondary" | "outline";
  maxVisible?: number;
  getTestId?: (item: string) => string;
  emptyText?: string;
  className?: string;
}

export function TagList({
  items,
  variant = "secondary",
  maxVisible,
  getTestId,
  emptyText,
  className,
}: TagListProps) {
  const overflow =
    maxVisible !== undefined && items.length > maxVisible ? items.length - maxVisible : 0;
  const visible = overflow > 0 ? items.slice(0, maxVisible) : items;

  if (items.length === 0) {
    if (!emptyText) return null;
    return <span className="text-xs text-muted-foreground">{emptyText}</span>;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {visible.map((item) => (
        <Badge key={item} variant={variant} data-testid={getTestId?.(item)}>
          {item}
        </Badge>
      ))}
      {overflow > 0 && (
        <Popover>
          <PopoverTrigger
            onClick={(e) => e.stopPropagation()}
            className={cn(
              badgeVariants({ variant: "outline" }),
              "cursor-pointer text-muted-foreground hover:text-foreground"
            )}
            aria-label={`Show ${overflow} more items`}
          >
            +{overflow} more
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-64 p-3">
            <div className="flex flex-wrap gap-1.5">
              {items.slice(maxVisible).map((item) => (
                <Badge key={item} variant={variant} className="text-xs">
                  {item}
                </Badge>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
