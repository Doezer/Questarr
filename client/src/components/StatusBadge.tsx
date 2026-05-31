import React from "react";
import { Badge } from "@/components/ui/badge";
import { Star, HardDrive, CheckCircle2, Loader2 } from "lucide-react";

interface StatusBadgeProps {
  status: string;
}

type StatusEntry = {
  label: string;
  variant: "destructive" | "secondary" | "default";
  className: string;
  Icon: React.ComponentType<{ className?: string }> | null;
};

const statusConfig: Record<string, StatusEntry> = {
  wanted: { label: "Wanted", variant: "destructive", className: "", Icon: Star },
  owned: { label: "Owned", variant: "secondary", className: "", Icon: HardDrive },
  shelved: {
    label: "Shelved",
    variant: "secondary",
    className: "bg-amber-700/80 hover:bg-amber-700 text-amber-100 border-amber-600",
    Icon: null,
  },
  completed: { label: "Completed", variant: "default", className: "", Icon: CheckCircle2 },
  downloading: {
    label: "Downloading",
    variant: "secondary",
    className: "bg-purple-600 hover:bg-purple-700 text-white",
    Icon: Loader2,
  },
};

export type GameStatus = keyof typeof statusConfig;

export function getStatusLabel(status: string): string {
  return statusConfig[status]?.label ?? status;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: status,
    variant: "secondary" as const,
    className: "",
    Icon: null,
  };

  const Icon = config.Icon;

  return (
    <Badge
      variant={config.variant}
      data-testid={`badge-status-${status}`}
      className={`text-xs gap-1 ${config.className}`}
    >
      {Icon && <Icon className={`w-3 h-3 ${status === "downloading" ? "animate-spin" : ""}`} />}
      <span className="hidden sm:inline">{config.label}</span>
    </Badge>
  );
}
