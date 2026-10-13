import { useEffect, useMemo, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Clock, Loader2, Play, Timer } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getSocket } from "@/lib/socket";

interface SystemTask {
  name: string;
  title: string;
  description: string;
  intervalMs: number;
  running: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastResult: "success" | "error" | null;
  lastError: string | null;
  nextRunAt: number | null;
}

function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
}

function formatRelative(ts: number | null, now: number): string {
  if (ts === null) return "—";
  const diffSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(diffSec);
  let text: string;
  if (abs < 60) text = `${abs} s`;
  else if (abs < 3600) text = `${Math.round(abs / 60)} min`;
  else if (abs < 86_400) text = `${Math.round(abs / 3600)} h`;
  else text = `${Math.round(abs / 86_400)} d`;
  return diffSec >= 0 ? `in ${text}` : `${text} ago`;
}

function ResultBadge({ task }: Readonly<{ task: SystemTask }>) {
  if (task.running) {
    return (
      <Badge className="gap-1 border-blue-700/50 bg-blue-900/40 text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Running
      </Badge>
    );
  }
  if (task.lastResult === "success") {
    return (
      <Badge className="gap-1 border-emerald-700/50 bg-emerald-900/40 text-emerald-400">
        <CheckCircle className="h-3 w-3" aria-hidden="true" />
        Success
      </Badge>
    );
  }
  if (task.lastResult === "error") {
    return (
      <Badge className="gap-1 border-red-700/50 bg-red-900/40 text-red-400">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Not run yet
    </Badge>
  );
}

export default function SystemTasksPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [now, setNow] = useState(() => Date.now());

  const { data } = useQuery<{ tasks: SystemTask[] }>({
    queryKey: ["/api/system/tasks"],
    refetchInterval: (query) => (query.state.data?.tasks.some((t) => t.running) ? 3000 : false),
  });
  const tasks = useMemo(() => data?.tasks ?? [], [data]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/system/tasks"] });
    socket.on("task:started", refresh);
    socket.on("task:finished", refresh);
    return () => {
      socket.off("task:started", refresh);
      socket.off("task:finished", refresh);
    };
  }, [queryClient]);

  const runTask = useMutation({
    mutationKey: ["system-task-run"],
    mutationFn: async (name: string) => {
      await apiRequest("POST", `/api/system/tasks/${encodeURIComponent(name)}/run`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/system/tasks"] }),
    onError: (error: Error) =>
      toast({ title: "Could not start task", description: error.message, variant: "destructive" }),
  });

  const pendingTaskNames = useMutationState({
    filters: { mutationKey: ["system-task-run"], status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="System Tasks"
        description="Background jobs that keep Questarr up to date. Run any of them now."
      />

      {tasks.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-slate-500">
          <Timer className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="text-sm">No scheduled tasks</p>
        </div>
      ) : (
        <>
          {/* Phones: one card per task */}
          <ul className="flex flex-col gap-3 md:hidden" aria-label="Scheduled tasks">
            {tasks.map((task) => (
              <li
                key={task.name}
                className="rounded-lg border border-[#374151]/40 bg-card p-4"
                data-testid={`task-card-${task.name}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                  </div>
                  <ResultBadge task={task} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Every</dt>
                  <dd>{formatInterval(task.intervalMs)}</dd>
                  <dt className="text-muted-foreground">Last run</dt>
                  <dd>{formatRelative(task.lastFinishedAt, now)}</dd>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd>{formatDuration(task.lastDurationMs)}</dd>
                  <dt className="text-muted-foreground">Next run</dt>
                  <dd>{task.running ? "—" : formatRelative(task.nextRunAt, now)}</dd>
                </dl>
                {task.lastError && (
                  <p className="mt-2 break-words text-xs text-red-400">{task.lastError}</p>
                )}
                <Button
                  className="mt-3 h-11 w-full"
                  variant="secondary"
                  disabled={task.running || pendingTaskNames.includes(task.name)}
                  onClick={() => runTask.mutate(task.name)}
                  aria-label={`Run ${task.title} now`}
                >
                  <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                  Run now
                </Button>
              </li>
            ))}
          </ul>

          {/* Tablet and desktop: table */}
          <div className="hidden overflow-hidden rounded-lg border border-[#374151]/40 md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#374151]/40 bg-[#111827] text-left text-slate-400">
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Interval</th>
                  <th className="px-4 py-3 font-medium">Last run</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium">Next run</th>
                  <th className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr
                    key={task.name}
                    className="border-b border-[#374151]/30 last:border-0"
                    data-testid={`task-row-${task.name}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{task.description}</p>
                      {task.lastError && (
                        <p className="mt-1 break-words text-xs text-red-400">{task.lastError}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatInterval(task.intervalMs)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {formatRelative(task.lastFinishedAt, now)}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {formatDuration(task.lastDurationMs)}
                    </td>
                    <td className="px-4 py-3">
                      <ResultBadge task={task} />
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {task.running ? "—" : formatRelative(task.nextRunAt, now)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={task.running || pendingTaskNames.includes(task.name)}
                        onClick={() => runTask.mutate(task.name)}
                        aria-label={`Run ${task.title} now`}
                      >
                        <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Run now
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
