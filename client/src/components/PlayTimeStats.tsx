import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, Download, Flame, Hourglass, Target, Timer } from "lucide-react";
import { Link } from "wouter";
import { apiFetch, apiRequest, throwIfResNotOk } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PLAY_RANGE_LABELS, presetBounds, type PlayRangePreset } from "@/lib/play-range";
import { PlayTimeHeatmap, PlaySessionLengths } from "@/components/PlayTimeInsights";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDaysLeft, formatMinutes, GOAL_STATUS_STYLE } from "@/lib/play-time";
import StatsCard from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  // The IANA zone makes the server apply daylight saving time per session; the offset is the fallback.
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);
  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }, []);

  const { toast } = useToast();
  const [preset, setPreset] = useState<PlayRangePreset>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const bounds = useMemo(
    () => presetBounds(preset, new Date(), custom),
    // The window moves with the day, not with every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, custom.from, custom.to]
  );
  const customInvalid =
    preset === "custom" && !!custom.from && !!custom.to && custom.from > custom.to;

  const search = useMemo(() => {
    const params = new URLSearchParams({ tz: String(tz) });
    if (timeZone) params.set("timeZone", timeZone);
    if (bounds.from) params.set("from", bounds.from);
    if (bounds.to) params.set("to", bounds.to);
    return params.toString();
  }, [tz, timeZone, bounds]);

  const { data } = useQuery<PlayTimeStatsData>({
    queryKey: ["/api/stats/play-time", tz, timeZone, bounds.from ?? null, bounds.to ?? null],
    queryFn: async () => (await apiRequest("GET", `/api/stats/play-time?${search}`)).json(),
    enabled: !customInvalid,
    placeholderData: (previous) => previous,
  });

  const exportSessions = async (format: "csv" | "json") => {
    try {
      const res = await apiFetch(`/api/stats/play-time/export?${search}&format=${format}`);
      await throwIfResNotOk(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `questarr-play-sessions.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Some browsers start the download asynchronously, so keep the blob URL alive a moment.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({
        title: "Could not export play sessions",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

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

  const filtered = preset !== "all";
  const rangeBar = (
    <div className="flex flex-wrap items-end gap-3" data-testid="play-range">
      <div className="space-y-1">
        <Label htmlFor="play-range-select" className="text-xs text-muted-foreground">
          Range
        </Label>
        <Select value={preset} onValueChange={(v) => setPreset(v as PlayRangePreset)}>
          <SelectTrigger id="play-range-select" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PLAY_RANGE_LABELS) as PlayRangePreset[]).map((key) => (
              <SelectItem key={key} value={key}>
                {PLAY_RANGE_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {preset === "custom" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="play-range-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="play-range-from"
              type="date"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="play-range-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="play-range-to"
              type="date"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="w-40"
            />
          </div>
        </>
      )}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={() => exportSessions("csv")}>
          <Download className="mr-1 h-4 w-4" aria-hidden="true" />
          Export CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportSessions("json")}>
          <Download className="mr-1 h-4 w-4" aria-hidden="true" />
          Export JSON
        </Button>
      </div>
      {customInvalid && (
        <p role="alert" className="w-full text-sm text-destructive">
          The start day must not be after the end day.
        </p>
      )}
    </div>
  );

  const goalsCard =
    data.goals.length > 0 ? (
      <Card data-testid="play-goals">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-medium">
            <Target className="h-5 w-5 text-primary" aria-hidden="true" />
            Finish-by goals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {data.goals.map((goal) => {
              const style = GOAL_STATUS_STYLE[goal.status];
              return (
                <li
                  key={goal.gameId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                >
                  <Link
                    href={`/games/${goal.gameId}`}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  >
                    {goal.title}
                  </Link>
                  <Badge variant="outline" className={style.className}>
                    {style.label}
                  </Badge>
                  <span className="w-full text-xs text-muted-foreground sm:w-auto sm:text-sm">
                    {formatDaysLeft(goal.daysLeft)}
                    {goal.remainingMinutes !== null
                      ? ` · ${formatMinutes(goal.remainingMinutes)} to beat`
                      : ""}
                    {goal.neededMinutesPerDay !== null
                      ? ` · ${formatMinutes(goal.neededMinutesPerDay)}/day needed`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    ) : null;

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

      {rangeBar}

      {data.sessionCount === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            {filtered
              ? "No play sessions in this range."
              : "No play sessions yet. Start a timer on a game you are playing, or add the time on its page, and your hours show up here."}
          </p>
          {goalsCard}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <StatsCard
              title="Time Played"
              value={formatMinutes(data.totalMinutes)}
              subtitle={filtered ? "in this range" : "all sessions"}
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

          <div className="grid gap-4 lg:grid-cols-7">
            <div className="min-w-0 lg:col-span-4">
              <PlayTimeHeatmap heatmap={data.heatmap} />
            </div>
            <div className="min-w-0 lg:col-span-3">
              <PlaySessionLengths stats={data.sessionStats} />
            </div>
          </div>

          {goalsCard}

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
