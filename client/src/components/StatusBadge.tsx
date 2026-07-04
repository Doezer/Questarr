import React from "react";
import { Badge } from "@/components/ui/badge";
import { Star, HardDrive, CheckCircle2, Loader2, Archive } from "lucide-react";

interface StatusBadgeProps {
  status: string;
}

type StatusEntry = {
  label: string;
  variant: "destructive" | "secondary" | "default";
  className: string;
  Icon: React.ComponentType<{ className?: string }> | null;
  /** Text color for the icon when shown outside a colored badge (e.g. in StatusPicker's trigger/menu). */
  iconColorClass: string;
};

const statusConfig: Record<string, StatusEntry> = {
  wanted: {
    label: "Wanted",
    variant: "destructive",
    className: "",
    Icon: Star,
    iconColorClass: "text-red-400",
  },
  owned: {
    label: "Owned",
    variant: "secondary",
    className: "",
    Icon: HardDrive,
    iconColorClass: "text-emerald-400",
  },
  shelved: {
    label: "Shelved",
    variant: "secondary",
    className: "bg-amber-700/80 hover:bg-amber-700 text-amber-100 border-amber-600",
    Icon: Archive,
    iconColorClass: "text-amber-400",
  },
  completed: {
    label: "Completed",
    variant: "default",
    className: "",
    Icon: CheckCircle2,
    iconColorClass: "text-blue-400",
  },
  downloading: {
    label: "Downloading",
    variant: "secondary",
    className: "bg-purple-600 hover:bg-purple-700 text-white",
    Icon: Loader2,
    iconColorClass: "text-purple-400",
  },
};

export type GameStatus = keyof typeof statusConfig;

export function getStatusLabel(status: string): string {
  return statusConfig[status]?.label ?? status;
}

/** Icon + tint for a status, used where the status is shown outside its badge (e.g. StatusPicker). */
export function getStatusVisual(status: string): {
  Icon: React.ComponentType<{ className?: string }> | null;
  iconColorClass: string;
} {
  const config = statusConfig[status];
  return { Icon: config?.Icon ?? null, iconColorClass: config?.iconColorClass ?? "" };
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
