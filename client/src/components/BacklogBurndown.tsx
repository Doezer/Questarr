import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarCheck, Hourglass, Library, TrendingDown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import StatsCard from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BacklogBurndown as BacklogData } from "@shared/backlog-burndown";

type Grain = "week" | "month";
type Metric = "games" | "hours";

function bucketLabel(iso: string, grain: Grain): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return grain === "week"
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
    : date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function describeProjection(
  remainingHours: number,
  projection: { clearedOn?: string | null; hoursPerDay: number }
): string {
  if (remainingHours <= 0) return "Nothing left to play with a Time to Beat estimate.";
  if (projection.clearedOn) {
    return `At your pace of ${projection.hoursPerDay} h per day over the last 28 days, the estimated time to beat runs out around ${formatDay(projection.clearedOn)}. New games you add are not counted.`;
  }
  return "No projection yet: it needs some play in the last 28 days, and a backlog you could clear within ten years at that pace.";
}

/** How the backlog (owned and playing games) shrinks over time, on the Statistics page. */
export default function BacklogBurndown() {
  const [grain, setGrain] = useState<Grain>("week");
  const [metric, setMetric] = useState<Metric>("games");
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);
  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }, []);
  const search = useMemo(() => {
    const params = new URLSearchParams({ tz: String(tz) });
    if (timeZone) params.set("timeZone", timeZone);
    return params.toString();
  }, [tz, timeZone]);

  const { data } = useQuery<BacklogData>({
    queryKey: ["/api/stats/backlog", tz, timeZone],
    queryFn: async () => (await apiRequest("GET", `/api/stats/backlog?${search}`)).json(),
  });

  const chartData = useMemo(
    () =>
      ((grain === "week" ? data?.perWeek : data?.perMonth) ?? []).map((b) => ({
        label: bucketLabel(b.start, grain),
        backlog: b.backlog,
        completed: b.completed,
        added: b.added,
        hours: b.remainingHours,
      })),
    [data, grain]
  );

  if (!data) return null;
  const { current, projection } = data;
  // Nothing to burn down: no game now and none in either series, whichever grain is shown.
  const empty =
    current.backlog === 0 && [...data.perWeek, ...data.perMonth].every((b) => b.backlog === 0);

  const projectionText = describeProjection(current.remainingHours, projection);

  return (
    <section aria-labelledby="backlog-heading" className="space-y-4" data-testid="backlog-burndown">
      <h2 id="backlog-heading" className="flex items-center gap-2 text-xl font-semibold">
        <TrendingDown className="h-5 w-5 text-primary" />
        Backlog burn-down
      </h2>

      {empty ? (
        <p className="text-sm text-muted-foreground">
          Your backlog is empty. Owned and playing games show up here as soon as you have some.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <StatsCard
              title="In Backlog"
              value={current.backlog}
              subtitle="owned or playing"
              icon={Library}
            />
            <StatsCard
              title="Time Left"
              value={`${current.remainingHours} h`}
              subtitle={
                current.withoutEstimate > 0
                  ? `${current.withoutEstimate} game${current.withoutEstimate === 1 ? "" : "s"} without estimate`
                  : "to beat the backlog"
              }
              icon={Hourglass}
            />
            <StatsCard
              title="Pace"
              value={`${projection.hoursPerDay} h/day`}
              subtitle="last 28 days"
              icon={CalendarCheck}
            />
            <StatsCard
              title="Cleared By"
              value={projection.clearedOn ? formatDay(projection.clearedOn) : "—"}
              subtitle="at this pace"
              icon={TrendingDown}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg font-medium">
                {metric === "games" ? "Games in the backlog" : "Hours still to play"}
              </CardTitle>
              <div className="flex gap-2">
                <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
                  <TabsList className="h-9">
                    <TabsTrigger value="games">Games</TabsTrigger>
                    <TabsTrigger value="hours">Hours</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Tabs value={grain} onValueChange={(v) => setGrain(v as Grain)}>
                  <TabsList className="h-9">
                    <TabsTrigger value="week">Weeks</TabsTrigger>
                    <TabsTrigger value="month">Months</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  {metric === "games" ? (
                    <>
                      <Bar
                        dataKey="completed"
                        name="Completed"
                        fill="#10b981"
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        type="monotone"
                        dataKey="backlog"
                        name="In backlog"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="hours"
                      name="Hours left"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground" data-testid="backlog-projection">
            {projectionText}
          </p>
          <p className="text-xs text-muted-foreground">
            The backlog is every game that is owned or being played. History before this feature is
            estimated from the day each game was added.
          </p>
        </>
      )}
    </section>
  );
}
