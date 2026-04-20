import React, { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DownloadSummary } from "@shared/schema";

interface DownloadIndicatorProps {
  summary: DownloadSummary | undefined;
  variant?: "overlay" | "inline";
}

const STATUS_COLOR: Record<DownloadSummary["topStatus"], string> = {
  downloading: "bg-blue-500",
  completed: "bg-emerald-500",
  paused: "bg-amber-500",
  failed: "bg-red-500",
};

const STATUS_LABEL: Record<DownloadSummary["topStatus"], string> = {
  downloading: "Downloading",
  completed: "Downloaded",
  paused: "Paused",
  failed: "Failed",
};

const DownloadIndicator = memo(({ summary, variant = "overlay" }: DownloadIndicatorProps) => {
  if (!summary) return null;

  const colorClass = STATUS_COLOR[summary.topStatus];
  const label = STATUS_LABEL[summary.topStatus];
  const types = summary.downloadTypes.join(", ");
  const tooltipText = `${label} · ${summary.count} download${summary.count !== 1 ? "s" : ""} (${types})`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "w-2.5 h-2.5 rounded-full shrink-0",
            colorClass,
            summary.topStatus === "downloading" && "animate-pulse",
            variant === "overlay" ? "absolute bottom-2 left-2" : "inline-flex"
          )}
          aria-label={tooltipText}
          role="status"
        />
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
});

DownloadIndicator.displayName = "DownloadIndicator";
export default DownloadIndicator;
