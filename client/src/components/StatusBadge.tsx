import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, Play, Star } from "lucide-react";

export type GameStatus = "owned" | "wishlist" | "playing" | "completed";

interface StatusBadgeProps {
  status: GameStatus;
  className?: string;
}

const statusConfig = {
  owned: {
    label: "Owned",
    icon: CheckCircle,
    className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
  },
  wishlist: {
    label: "Wishlist",
    icon: Star,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
  },
  playing: {
    label: "Playing",
    icon: Play,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
  },
  completed: {
    label: "Completed",
    icon: Clock,
    className: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
  }
};

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge 
      variant="outline" 
      className={`${config.className} ${className} gap-1`}
      data-testid={`badge-status-${status}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}