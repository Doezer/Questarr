import { Badge } from "@/components/ui/badge";

export type GameStatus = "wanted" | "owned" | "completed" | "downloading";

interface StatusBadgeProps {
  status: GameStatus;
}

const statusConfig = {
  wanted: { label: "Wanted", variant: "destructive" as const },
  owned: { label: "Owned", variant: "secondary" as const },
  completed: { label: "Completed", variant: "default" as const },
  downloading: { label: "Downloading", variant: "outline" as const },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} data-testid={`badge-status-${status}`} className="text-xs">
      {config.label}
    </Badge>
  );
}
