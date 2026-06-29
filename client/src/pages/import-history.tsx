import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, CheckCircle, AlertTriangle, XCircle, Clock, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { getSocket } from "@/lib/socket";
import type { ImportTask, ImportTaskItem } from "@shared/schema";

const TASK_TYPE_LABELS: Record<string, string> = {
  steam_wishlist: "Steam Wishlist",
  file_import: "File Import",
  bulk_add: "Scan Unlinked",
};

const RESULT_LABELS: Record<string, string> = {
  added: "Added",
  skipped: "Skipped",
  failed: "Failed",
  fuzzy_match: "Fuzzy Match",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <Badge className="bg-emerald-900/40 text-emerald-400 border-emerald-700/50 gap-1">
        <CheckCircle className="w-3 h-3" aria-hidden="true" />
        Completed
      </Badge>
    );
  }
  if (status === "completed_with_errors") {
    return (
      <Badge className="bg-amber-900/40 text-amber-400 border-amber-700/50 gap-1">
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        With errors
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="bg-red-900/40 text-red-400 border-red-700/50 gap-1">
        <XCircle className="w-3 h-3" aria-hidden="true" />
        Failed
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge className="bg-blue-900/40 text-blue-400 border-blue-700/50 gap-1">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        In progress
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-800 text-slate-400 border-slate-700 gap-1">
      <Clock className="w-3 h-3" aria-hidden="true" />
      Pending
    </Badge>
  );
}

function ResultBadge({ result }: { result: string }) {
  const colors: Record<string, string> = {
    added: "bg-emerald-900/40 text-emerald-400 border-emerald-700/50",
    skipped: "bg-slate-800 text-slate-400 border-slate-700",
    failed: "bg-red-900/40 text-red-400 border-red-700/50",
    fuzzy_match: "bg-amber-900/40 text-amber-400 border-amber-700/50",
  };
  return (
    <Badge className={colors[result] ?? "bg-slate-800 text-slate-400"}>
      {RESULT_LABELS[result] ?? result}
    </Badge>
  );
}

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) return "—";
  const end = completedAt ?? Date.now();
  const secs = Math.round((end - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

type TaskWithItems = ImportTask & { items: ImportTaskItem[] };

export default function ImportHistoryPage() {
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: tasks = [] } = useQuery<ImportTask[]>({
    queryKey: ["/api/import-tasks"],
    refetchInterval: (query) => {
      const data = query.state.data as ImportTask[] | undefined;
      return data?.some((t) => t.status === "in_progress" || t.status === "pending") ? 3000 : false;
    },
  });

  const { data: selectedTask } = useQuery<TaskWithItems>({
    queryKey: ["/api/import-tasks", selectedTaskId],
    enabled: !!selectedTaskId,
    refetchInterval: (query) => {
      const data = query.state.data as TaskWithItems | undefined;
      return data?.status === "in_progress" || data?.status === "pending" ? 3000 : false;
    },
  });

  useEffect(() => {
    const socket = getSocket();
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import-tasks"] });
      if (selectedTaskId) {
        queryClient.invalidateQueries({ queryKey: ["/api/import-tasks", selectedTaskId] });
      }
    };
    socket.on("importTaskUpdate", handler);
    return () => {
      socket.off("importTaskUpdate", handler);
    };
  }, [queryClient, selectedTaskId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-[#374151]/40">
        <ClipboardList className="w-5 h-5 text-blue-400" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-white">Import History</h1>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <ClipboardList className="w-10 h-10 mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm">No import tasks yet</p>
          </div>
        ) : (
          <div className="rounded-lg border border-[#374151]/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#374151]/40 bg-[#111827]">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Triggered by</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Started</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Created</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Duration</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Added</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Skipped</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    className="border-b border-[#374151]/30 last:border-0 hover:bg-[#1F2937]/60 cursor-pointer transition-colors"
                    onClick={() => setSelectedTaskId(task.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelectedTaskId(task.id);
                    }}
                  >
                    <td className="px-4 py-3 text-white font-medium">
                      {TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
                    </td>
                    <td className="px-4 py-3 text-slate-400 capitalize">{task.triggeredBy}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {formatDate(task.startedAt ? Number(task.startedAt) : null)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {formatDate(task.createdAt ? Number(task.createdAt) : null)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {formatDuration(
                        task.startedAt ? Number(task.startedAt) : null,
                        task.completedAt ? Number(task.completedAt) : null
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">{task.addedItems}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{task.skippedItems}</td>
                    <td className="px-4 py-3 text-right text-red-400">{task.failedItems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Sheet open={!!selectedTaskId} onOpenChange={(open) => !open && setSelectedTaskId(null)}>
        <SheetContent className="w-full sm:max-w-xl bg-[#111827] border-l border-[#374151]/40 overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-white">
              {selectedTask
                ? (TASK_TYPE_LABELS[selectedTask.taskType] ?? selectedTask.taskType)
                : "Task detail"}
            </SheetTitle>
            <SheetDescription className="text-slate-400">
              {selectedTask && (
                <span>
                  {formatDate(selectedTask.createdAt ? Number(selectedTask.createdAt) : null)} ·{" "}
                  {formatDuration(
                    selectedTask.startedAt ? Number(selectedTask.startedAt) : null,
                    selectedTask.completedAt ? Number(selectedTask.completedAt) : null
                  )}
                </span>
              )}
            </SheetDescription>
          </SheetHeader>

          {selectedTask && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <StatusBadge status={selectedTask.status} />
                <span className="text-xs text-slate-500">
                  {selectedTask.totalItems} total · {selectedTask.addedItems} added ·{" "}
                  {selectedTask.skippedItems} skipped · {selectedTask.failedItems} failed
                </span>
              </div>

              {selectedTask.errorMessage && (
                <div className="rounded-md bg-red-900/20 border border-red-700/30 px-3 py-2 text-sm text-red-400">
                  {selectedTask.errorMessage}
                </div>
              )}

              {selectedTask.items.length === 0 ? (
                <p className="text-sm text-slate-500">No item-level detail available.</p>
              ) : (
                <div className="space-y-1">
                  {selectedTask.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 py-2 border-b border-[#374151]/30 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">
                          {item.gameTitle ?? item.itemName}
                        </p>
                        {item.errorMessage && (
                          <p className="text-xs text-red-400 mt-0.5">{item.errorMessage}</p>
                        )}
                      </div>
                      <ResultBadge result={item.result} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
