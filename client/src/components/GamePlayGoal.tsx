import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Target, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatDaysLeft, formatMinutes, GOAL_STATUS_STYLE } from "@/lib/play-time";
import { computeGoalProgress } from "@shared/play-goal";

interface GamePlayGoalProps {
  gameId: string;
  gameStatus: string;
  /** Saved target day (`YYYY-MM-DD`), if any. */
  finishBy: string | null;
  playedMinutes: number;
  /** Minutes played over the last 14 days. */
  recentMinutes: number;
  timeToBeatHours: number | null;
  /** Today as `YYYY-MM-DD` in the viewer's local time. */
  today: string;
}

/** A "finish by" target for one game, compared with its Time to Beat and the pace so far. */
export default function GamePlayGoal({
  gameId,
  gameStatus,
  finishBy,
  playedMinutes,
  recentMinutes,
  timeToBeatHours,
  today,
}: Readonly<GamePlayGoalProps>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // The value just saved, shown until the game list refetches and `finishBy` catches up.
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const current = saved === undefined ? finishBy : saved;
  // Once the game list has caught up with what was saved, let later server values through
  // (a change or a clear made from another tab).
  useEffect(() => {
    if (saved !== undefined && finishBy === saved) setSaved(undefined);
  }, [finishBy, saved]);
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: async (value: string | null) => {
      await apiRequest("PATCH", `/api/games/${gameId}/finish-by`, { finishBy: value });
      return value;
    },
    onSuccess: (value) => {
      setSaved(value);
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/stats/play-time"] });
    },
    onError: () => toast({ description: "Failed to save the goal", variant: "destructive" }),
  });

  const progress = current
    ? computeGoalProgress({
        finishBy: current,
        today,
        gameStatus,
        playedMinutes,
        recentMinutes,
        timeToBeatHours,
      })
    : null;
  const style = progress ? GOAL_STATUS_STYLE[progress.status] : null;

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="section-goal">
      <div className="flex flex-wrap items-center gap-2">
        <Target className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-medium">Finish by</h3>
        {progress && style ? (
          <Badge variant="outline" className={`ml-auto ${style.className}`}>
            {style.label}
          </Badge>
        ) : null}
      </div>

      {current && progress ? (
        <div className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium tabular-nums" data-testid="text-goal-date">
              {new Date(`${current}T12:00:00`).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}
            </span>
            <span className="text-muted-foreground">
              {progress.status === "done" ? "Completed" : formatDaysLeft(progress.daysLeft)}
            </span>
          </p>
          {progress.status !== "done" && progress.remainingMinutes !== null ? (
            <p className="text-muted-foreground" data-testid="text-goal-pace">
              {formatMinutes(progress.remainingMinutes)} left to beat
              {progress.neededMinutesPerDay !== null
                ? ` · needs ${formatMinutes(progress.neededMinutesPerDay)}/day`
                : ""}
              {` · you average ${formatMinutes(progress.recentMinutesPerDay)}/day (last 14 days)`}
            </p>
          ) : null}
          {progress.status === "no-estimate" ? (
            <p className="text-muted-foreground">
              IGDB has no Time to Beat for this game, so only the countdown is shown.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a day to finish this game and see if your pace gets you there.
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        aria-label="Set a finish-by goal"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft) save.mutate(draft);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`goal-date-${gameId}`}>{current ? "Change target" : "Target day"}</Label>
          <Input
            id={`goal-date-${gameId}`}
            type="date"
            value={draft}
            min={today}
            onChange={(e) => setDraft(e.target.value)}
            className="h-10 w-40"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          className="h-10"
          disabled={!draft || save.isPending}
        >
          Save goal
        </Button>
        {current ? (
          <Button
            type="button"
            variant="ghost"
            className="h-10 gap-1 text-muted-foreground"
            onClick={() => save.mutate(null)}
            disabled={save.isPending}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear goal
          </Button>
        ) : null}
      </form>
    </div>
  );
}
