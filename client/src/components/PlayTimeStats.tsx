import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, Flame, Hourglass, Timer } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatMinutes } from "@/lib/play-time";
import StatsCard from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import type { PlayTimeStats as PlayTimeStatsData } from "@shared/play-stats";

type Range = "week" | "month";

/** A short axis label for a bucket that starts on `iso` (`YYYY-MM-DD`). */
function bucketLabel(iso: string, range: Range): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return range === "week"
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
    : date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function TagList({
  title,
  items,
}: Readonly<{ title: string; items: { name: string; minutes: number }[] }>) {
  if (items.length === 0) return null;
  const max = items[0]?.minutes ?? 1;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.name} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{item.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatMinutes(item.minutes)}
              </span>
            </div>
            <Progress value={(item.minutes / max) * 100} className="mt-1 h-1.5" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The "Play time" part of the Statistics page, fed by `/api/stats/play-time`. */
export default function PlayTimeStats() {
  const [range, setRange] = useState<Range>("week");
  // Days follow the browser's clock, so the server needs its offset from UTC.
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);

  const { data } = useQuery<PlayTimeStatsData>({
    queryKey: ["/api/stats/play-time", tz],
    queryFn: async () => (await apiRequest("GET", `/api/stats/play-time?tz=${tz}`)).json(),
  });

  const chartData = useMemo(() => {
    const buckets = range === "week" ? data?.perWeek : data?.perMonth;
    return (buckets ?? []).map((b) => ({
      label: bucketLabel(b.start, range),
      // Two decimals so a bucket of a few minutes still draws a bar (not 0 h).
      hours: Math.round((b.minutes / 60) * 100) / 100,
      minutes: b.minutes,
    }));
  }, [data, range]);

  if (!data) return null;

  return (
    <section
      aria-labelledby="play-time-heading"
      className="space-y-4"
      data-testid="play-time-stats"
    >
      <h2 id="play-time-heading" className="flex items-center gap-2 text-xl font-semibold">
        <Timer className="h-5 w-5 text-primary" />
        Play time
      </h2>

      {data.sessionCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          No play sessions yet. Start a timer on a game you are playing, or add the time on its
          page, and your hours show up here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <StatsCard
              title="Time Played"
              value={formatMinutes(data.totalMinutes)}
              subtitle="all sessions"
              icon={Clock}
            />
            <StatsCard
              title="Sessions"
              value={data.sessionCount}
              subtitle={`avg ${formatMinutes(data.totalMinutes / data.sessionCount)}`}
              icon={Hourglass}
            />
            <StatsCard
              title="Longest Session"
              value={data.longestSession ? formatMinutes(data.longestSession.minutes) : "—"}
              subtitle={data.longestSession?.title ?? ""}
              icon={Timer}
            />
            <StatsCard
              title="Play Streak"
              value={`${data.currentStreakDays} day${data.currentStreakDays === 1 ? "" : "s"}`}
              subtitle={`best ${data.longestStreakDays}`}
              icon={Flame}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg font-medium">Hours played</CardTitle>
                <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
                  <TabsList className="h-9">
                    <TabsTrigger value="week">Weeks</TabsTrigger>
                    <TabsTrigger value="month">Months</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: -16, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      formatter={(_value, _name, item) => [
                        formatMinutes((item.payload as { minutes: number }).minutes),
                        "Played",
                      ]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Bar dataKey="hours" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-lg font-medium">Most played</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {data.topGames.map((game) => {
                    const expected = game.timeToBeatHours ? game.timeToBeatHours * 60 : null;
                    return (
                      <li key={game.gameId} className="text-sm">
                        <div className="flex justify-between gap-2">
                          <Link
                            href={`/games/${game.gameId}`}
                            className="truncate font-medium hover:underline"
                          >
                            {game.title}
                          </Link>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatMinutes(game.minutes)}
                            {game.timeToBeatHours ? ` / ~${game.timeToBeatHours}h` : ""}
                          </span>
                        </div>
                        {expected ? (
                          <Progress
                            value={Math.min(100, (game.minutes / expected) * 100)}
                            className="mt-1 h-1.5"
                            aria-label={`${game.title}: ${formatMinutes(game.minutes)} played of about ${game.timeToBeatHours} hours to beat`}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          </div>

          {(data.topGenres.length > 0 || data.topPlatforms.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardContent className="pt-6">
                  <TagList title="By genre" items={data.topGenres} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <TagList title="By platform" items={data.topPlatforms} />
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </section>
  );
}
