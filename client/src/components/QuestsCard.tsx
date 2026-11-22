import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, CalendarDays, CheckCircle2, ChevronDown, Target, Trophy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  FINISHER_TARGET,
  RETRO_BEFORE_YEAR,
  SLAYER_MIN_AGE_DAYS,
  SPRINT_MAX_HOURS,
  type QuestKind,
} from "@shared/quests";
import type { Quest } from "@shared/schema";

type QuestView = Quest & { gameTitle: string | null };

interface QuestsData {
  enabled: boolean;
  current: QuestView[];
  history: QuestView[];
  medals: string[];
  backlogProgress: { completed: number; total: number; percent: number } | null;
}

const QUEST_TEXT: Record<QuestKind, { title: string; describe: (q: QuestView) => string }> = {
  weekend_sprint: {
    title: "Weekend Sprint",
    describe: (q) =>
      q.gameTitle
        ? `Finish ${q.gameTitle} (under ${SPRINT_MAX_HOURS} h to beat).`
        : `Finish a game of under ${SPRINT_MAX_HOURS} h from your backlog.`,
  },
  backlog_cleanup: {
    title: "Backlog Cleanup",
    describe: () => "Finish any game from your backlog this week.",
  },
  backlog_slayer: {
    title: "Backlog Slayer",
    describe: (q) =>
      `Play or finish ${q.target} games added over ${SLAYER_MIN_AGE_DAYS / 365} year ago.`,
  },
  retro_explorer: {
    title: "Retro Explorer",
    describe: () => `Play or finish a game released before ${RETRO_BEFORE_YEAR}.`,
  },
  monthly_finisher: {
    title: "Monthly Finisher",
    describe: () => `Finish ${FINISHER_TARGET} games from your backlog this month.`,
  },
};

const MEDAL_TEXT: Record<string, { title: string; hint: string }> = {
  backlog_slayer: { title: "Backlog Slayer", hint: "Complete a Backlog Slayer quest" },
  retro_explorer: { title: "Retro Explorer", hint: "Complete a Retro Explorer quest" },
  sprinter: { title: "Sprinter", hint: "Complete a Weekend Sprint quest" },
  regular: { title: "Regular", hint: "Complete 5 quests" },
};

function questText(kind: string) {
  return QUEST_TEXT[kind as QuestKind];
}

function periodLabel(q: Quest): string {
  const date = new Date(`${q.periodStart}T12:00:00Z`);
  return q.period === "week"
    ? `Week of ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}`
    : date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function QuestRow({ quest }: { quest: QuestView }) {
  const text = questText(quest.kind);
  const percent = Math.min(100, Math.round((quest.progress / quest.target) * 100));
  const done = quest.status === "completed";
  return (
    <li className="space-y-2 rounded-md border p-3" data-testid={`quest-${quest.kind}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : (
              <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            )}
            {text?.title ?? quest.kind}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{text?.describe(quest) ?? ""}</p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {quest.period === "week" ? "Weekly" : "Monthly"}
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        <Progress
          value={percent}
          aria-label={`${text?.title ?? quest.kind} progress`}
          className="h-2 bg-muted"
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {quest.progress}/{quest.target}
        </span>
      </div>
    </li>
  );
}

/**
 * The backlog quests of the current week and month, the month's backlog progress, the medals and
 * the past quests. Hidden when the user turned quests off in Settings.
 */
export default function QuestsCard({ showHistory = false }: { showHistory?: boolean }) {
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const { data } = useQuery<QuestsData>({
    queryKey: ["/api/quests", tz, timeZone],
    queryFn: async () => (await apiRequest("GET", `/api/quests?${search}`)).json(),
  });

  if (!data?.enabled) return null;
  const { current, history, medals, backlogProgress } = data;

  return (
    <Card data-testid="card-quests">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
          Backlog quests
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {backlogProgress && (
          <div className="space-y-1.5" data-testid="quests-backlog-progress">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">Backlog cleared this month</span>
              <span className="tabular-nums text-muted-foreground">
                {backlogProgress.completed}/{backlogProgress.total} · {backlogProgress.percent}%
              </span>
            </div>
            <Progress
              value={backlogProgress.percent}
              aria-label="Share of the backlog cleared this month"
              className="h-2 bg-muted"
            />
          </div>
        )}

        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No quest this period: add games you own or are playing to your backlog and quests will
            appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {current.map((q) => (
              <QuestRow key={q.id} quest={q} />
            ))}
          </ul>
        )}

        {medals.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Medals">
            {medals.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1" title={MEDAL_TEXT[id]?.hint}>
                <Award className="h-3 w-3" aria-hidden="true" />
                {MEDAL_TEXT[id]?.title ?? id}
              </Badge>
            ))}
          </div>
        )}

        {showHistory && history.length > 0 && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 gap-1 px-2"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
              Past quests ({history.length})
            </Button>
            {historyOpen && (
              <ul className="mt-2 divide-y rounded-md border text-sm">
                {history.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-2 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{questText(q.kind)?.title ?? q.kind}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" aria-hidden="true" />
                        {periodLabel(q)}
                      </p>
                    </div>
                    <Badge variant={q.status === "completed" ? "default" : "outline"}>
                      {q.status === "completed" ? "Completed" : "Missed"} · {q.progress}/{q.target}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
