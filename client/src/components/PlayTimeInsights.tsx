import { useEffect, useMemo, useRef } from "react";
import { formatMinutes } from "@/lib/play-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlayHeatmap, PlaySessionDurationStats } from "@shared/play-stats";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEVEL_CLASS = [
  "bg-muted",
  "bg-cyan-500/25",
  "bg-cyan-500/50",
  "bg-cyan-500/75",
  "bg-cyan-500",
] as const;

/** 0 for no play, then 1-4 by share of the busiest day (quartiles). */
function level(minutes: number, max: number): number {
  if (minutes <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((minutes / max) * 4)));
}

/** Monday-first weekday index (0-6) of a `YYYY-MM-DD` day. */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function MiniBars({
  title,
  labels,
  values,
}: Readonly<{ title: string; labels: string[]; values: number[] }>) {
  const max = Math.max(...values, 0);
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <ul className="space-y-1">
        {values.map((minutes, i) => (
          <li key={labels[i]} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-muted-foreground">{labels[i]}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded bg-cyan-500"
                style={{ width: max > 0 ? `${(minutes / max) * 100}%` : "0%" }}
              />
            </span>
            <span className="w-20 shrink-0 whitespace-nowrap text-right tabular-nums text-muted-foreground">
              {minutes > 0 ? formatMinutes(minutes) : "–"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Calendar heatmap of play time per day, plus the weekday and time-of-day split. */
export function PlayTimeHeatmap({ heatmap }: Readonly<{ heatmap: PlayHeatmap }>) {
  const scroller = useRef<HTMLDivElement>(null);
  const { weeks, max, monthMarks } = useMemo(() => {
    const first = heatmap.days[0];
    const lead = first ? weekdayIndex(first.start) : 0;
    const cells: ({ start: string; minutes: number } | null)[] = [
      ...new Array<null>(lead).fill(null),
      ...heatmap.days,
    ];
    const columns: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));
    const marks = columns.map((column, i) => {
      const day = column.find((c) => c !== null);
      if (!day) return "";
      const month = day.start.slice(0, 7);
      const previous = columns[i - 1]?.find((c) => c !== null);
      if (previous && previous.start.slice(0, 7) === month) return "";
      return new Date(`${day.start}T12:00:00Z`).toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      });
    });
    return {
      weeks: columns,
      max: Math.max(...heatmap.days.map((d) => d.minutes), 0),
      monthMarks: marks,
    };
  }, [heatmap.days]);

  // Show the most recent weeks first on a narrow screen.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);

  const hours = useMemo(() => {
    const labels: string[] = [];
    const values: number[] = [];
    // Four-hour blocks keep the list short on a phone.
    for (let start = 0; start < 24; start += 4) {
      labels.push(`${String(start).padStart(2, "0")}h`);
      values.push(heatmap.perHour.slice(start, start + 4).reduce((a, b) => a + b, 0));
    }
    return { labels, values };
  }, [heatmap.perHour]);

  const hasPlay = heatmap.perWeekday.some((minutes) => minutes > 0);

  return (
    <Card data-testid="play-heatmap">
      <CardHeader>
        <CardTitle className="text-lg font-medium">Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasPlay ? null : (
          <p className="text-sm text-muted-foreground">
            No timed play in this range. Sessions estimated from Steam or imported play time are not
            placed on the calendar.
          </p>
        )}
        <div ref={scroller} className="max-w-full overflow-x-auto pb-2">
          <div className="flex gap-[3px]" role="group" aria-label="Play time per day">
            <div className="flex shrink-0 flex-col gap-[3px] pt-4 pr-1 text-[10px] text-muted-foreground">
              {WEEKDAYS.map((d, i) => (
                <span key={d} className="flex h-3 items-center">
                  {i % 2 === 0 ? d : ""}
                </span>
              ))}
            </div>
            {weeks.map((column, w) => (
              <div key={column.find((c) => c)?.start ?? w} className="flex flex-col gap-[3px]">
                <span className="h-3 text-[10px] leading-3 text-muted-foreground">
                  {monthMarks[w]}
                </span>
                {Array.from({ length: 7 }, (_, row) => {
                  const cell = column[row];
                  if (!cell) return <span key={row} className="h-3 w-3" />;
                  const lvl = level(cell.minutes, max);
                  return (
                    <span
                      key={cell.start}
                      role="img"
                      className={`h-3 w-3 rounded-[2px] ${LEVEL_CLASS[lvl]}`}
                      title={`${dayLabel(cell.start)}: ${cell.minutes > 0 ? formatMinutes(cell.minutes) : "no play"}`}
                      aria-label={`${dayLabel(cell.start)}: ${cell.minutes > 0 ? formatMinutes(cell.minutes) : "no play"}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-hidden="true">
          Less
          {LEVEL_CLASS.map((c) => (
            <span key={c} className={`h-3 w-3 rounded-[2px] ${c}`} />
          ))}
          More
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <MiniBars title="By weekday" labels={WEEKDAYS} values={heatmap.perWeekday} />
          <MiniBars title="By time of day" labels={hours.labels} values={hours.values} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Average, median and length distribution of the sessions in the range. */
export function PlaySessionLengths({ stats }: Readonly<{ stats: PlaySessionDurationStats }>) {
  const max = Math.max(...stats.buckets.map((b) => b.count), 0);
  return (
    <Card data-testid="play-session-lengths">
      <CardHeader>
        <CardTitle className="text-lg font-medium">Session length</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.sampleSize === 0 ? (
          <p className="text-sm text-muted-foreground">No timed sessions in this range.</p>
        ) : (
          <>
            <p className="text-sm">
              Average{" "}
              <strong className="tabular-nums">{formatMinutes(stats.averageMinutes)}</strong>
              {" · "}Median{" "}
              <strong className="tabular-nums">{formatMinutes(stats.medianMinutes)}</strong>
              <span className="text-muted-foreground"> over {stats.sampleSize} sessions</span>
            </p>
            <ul className="space-y-1">
              {stats.buckets.map((bucket) => (
                <li key={bucket.label} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-muted-foreground">{bucket.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-muted" aria-hidden="true">
                    <span
                      className="block h-full rounded bg-cyan-500"
                      style={{ width: max > 0 ? `${(bucket.count / max) * 100}%` : "0%" }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums">{bucket.count}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Estimated Steam and imported sessions are left out: they do not say how long one
              sitting lasted.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
