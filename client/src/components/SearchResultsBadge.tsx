import React, { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResultsBadgeProps {
  visible: boolean;
  variant?: "overlay" | "inline";
}

const SearchResultsBadge = memo(({ visible, variant = "overlay" }: SearchResultsBadgeProps) => {
  if (!visible) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded-full bg-violet-500 text-white shrink-0",
            variant === "overlay" ? "absolute bottom-2 left-9" : "inline-flex"
          )}
          aria-label="Downloads available on indexers"
          role="status"
        >
          <Search className="w-3 h-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Downloads available on indexers</TooltipContent>
    </Tooltip>
  );
});

SearchResultsBadge.displayName = "SearchResultsBadge";
export default SearchResultsBadge;
