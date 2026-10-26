import React, { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle } from "lucide-react";

interface UpdateAvailableBadgeProps {
  visible: boolean;
  variant?: "overlay" | "inline";
}

const LABEL = "Update available on indexers";

const UpdateAvailableBadge = memo(({ visible, variant = "overlay" }: UpdateAvailableBadgeProps) => {
  if (!visible) return null;

  if (variant === "overlay") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="absolute bottom-2 left-2 bg-sky-700 hover:bg-sky-700 text-white border-sky-800 gap-1 text-[10px] py-0 px-1.5 cursor-default no-default-hover-elevate no-default-active-elevate"
            aria-label={LABEL}
            role="status"
          >
            <ArrowUpCircle className="w-2.5 h-2.5" />
            Update
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{LABEL}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-700 text-white shrink-0 inline-flex"
          aria-label={LABEL}
          role="status"
        >
          <ArrowUpCircle className="w-3 h-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{LABEL}</TooltipContent>
    </Tooltip>
  );
});

UpdateAvailableBadge.displayName = "UpdateAvailableBadge";
export default UpdateAvailableBadge;
