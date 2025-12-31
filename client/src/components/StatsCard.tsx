import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
}

export default function StatsCard({ title, value, subtitle, icon: Icon, trend }: StatsCardProps) {
  return (
    <Card data-testid={`card-stats-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div
          className="text-2xl font-bold"
          data-testid={`text-stats-value-${title.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </div>
        {subtitle && (
          <p
            className="text-xs text-muted-foreground"
            data-testid={`text-stats-subtitle-${title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {subtitle}
          </p>
        )}
        {trend && (
          <p className="text-xs text-muted-foreground mt-1">
            <span className={trend.value >= 0 ? "text-secondary" : "text-destructive"}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}
            </span>{" "}
            {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
