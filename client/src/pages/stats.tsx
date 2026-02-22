import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Game } from "@shared/schema";
import StatsCard from "@/components/StatsCard";
import {
  Star,
  Gamepad2,
  Tags,
  Filter,
  Calendar,
  Building2,
  Code2,
  Package,
  CheckCircle2,
  BarChart3,
  LayoutGrid,
} from "lucide-react";
import { calculateLibraryStats } from "@/lib/stats";
import { apiRequest } from "@/lib/queryClient";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function StatsPage() {
  const { data: games = [], isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games", "", true], // Empty search, include hidden
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/games?includeHidden=true");
      return response.json();
    },
  });

  const stats = useMemo(() => calculateLibraryStats(games), [games]);

  const pieData = useMemo(() => {
    return [
      { name: "Wanted", value: stats.statusBreakdown.wanted },
      { name: "Owned", value: stats.statusBreakdown.owned },
      { name: "Completed", value: stats.statusBreakdown.completed },
      { name: "Downloading", value: stats.statusBreakdown.downloading },
    ].filter((item) => item.value > 0);
  }, [stats.statusBreakdown]);

  const chartColors = {
    Wanted: "#ef4444",
    Owned: "#3b82f6",
    Completed: "#10b981",
    Downloading: "#8b5cf6",
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Library Statistics</h1>
        <p className="text-muted-foreground">
          Detailed insights into your collection of {stats.totalGames} games.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Games"
          value={stats.totalGames}
          subtitle="in library"
          icon={Package}
        />
        <StatsCard
          title="Avg. Rating"
          value={stats.avgRating}
          subtitle="average score"
          icon={Star}
        />
        <StatsCard
          title="Completion Rate"
          value={`${stats.completionRate}%`}
          subtitle="of owned games"
          icon={CheckCircle2}
        />
        <StatsCard
          title="Metadata Health"
          value={`${stats.metadataHealth}%`}
          subtitle="complete metadata"
          icon={Filter}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Status Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={chartColors[entry.name as keyof typeof chartColors]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-3 transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-primary" />
              Quick Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card/50">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Tags className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
                    Top Genre
                  </p>
                  <p className="font-medium">{stats.topGenre?.name || "N/A"}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card/50">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Gamepad2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
                    Top Platform
                  </p>
                  <p className="font-medium">{stats.topPlatform?.name || "N/A"}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card/50">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
                    Top Publisher
                  </p>
                  <p className="font-medium">{stats.topPublisher?.name || "N/A"}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card/50">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Code2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
                    Unique Developers
                  </p>
                  <p className="font-medium">{stats.uniqueDevelopers}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border bg-card/50">
                <div className="p-2 bg-primary/10 rounded-md">
                  <Calendar className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
                    Avg. Release Year
                  </p>
                  <p className="font-medium">{stats.avgReleaseYear}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
