import React from "react";
import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: string;
}

const statusConfig = {
  wanted: { label: "Wanted", variant: "destructive" as const, className: "" },
  owned: { label: "Owned", variant: "secondary" as const, className: "" },
  shelved: {
    label: "Shelved",
    variant: "secondary" as const,
    className: "bg-amber-700/80 hover:bg-amber-700 text-amber-100 border-amber-600",
  },
  completed: { label: "Completed", variant: "default" as const, className: "" },
  downloading: {
    label: "Downloading",
    variant: "secondary" as const,
    className: "bg-purple-600 hover:bg-purple-700 text-white",
  },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status as keyof typeof statusConfig] || {
    label: status,
    variant: "secondary" as const,
    className: "",
  };

  return (
    <Badge
      variant={config.variant}
      data-testid={`badge-status-${status}`}
      className={`text-xs ${config.className || ""}`}
    >
      {config.label}
    </Badge>
  );
}
