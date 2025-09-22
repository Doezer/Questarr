import { Badge } from "@/components/ui/badge";

export type Platform = "PC" | "PlayStation" | "Xbox" | "Switch" | "Mobile" | "VR";

interface PlatformBadgeProps {
  platform: Platform;
  className?: string;
}

const platformConfig = {
  PC: { color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" },
  PlayStation: { color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  Xbox: { color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" },
  Switch: { color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  Mobile: { color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  VR: { color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" }
};

export default function PlatformBadge({ platform, className = "" }: PlatformBadgeProps) {
  const config = platformConfig[platform] || platformConfig.PC; // Fallback to PC config

  return (
    <Badge 
      variant="outline"
      className={`${config.color} ${className} text-xs`}
      data-testid={`badge-platform-${platform.toLowerCase()}`}
    >
      {platform}
    </Badge>
  );
}