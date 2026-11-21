import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";

export type ImportOperationPhase =
  "queued" | "hashing" | "scanning" | "extracting" | "transferring" | "complete" | "failed";

export interface ImportOperation {
  id: string;
  downloadId: string;
  status: "running" | "completed" | "failed";
  phase: ImportOperationPhase;
  bytesProcessed: number | null;
  bytesTotal: number | null;
  error: string | null;
  passwordRequired: boolean;
  incompleteScan: boolean;
}

const PHASE_LABELS: Record<ImportOperationPhase, string> = {
  queued: "Starting import…",
  hashing: "Computing file hash for the security scan…",
  scanning: "Running security scan…",
  extracting: "Extracting archive…",
  transferring: "Transferring files…",
  complete: "Import complete",
  failed: "Import failed",
};

/** Percentage of the current phase done, or null when the size isn't known. */
export function operationPercent(op: ImportOperation): number | null {
  if (op.bytesProcessed === null || !op.bytesTotal) return null;
  return Math.min(100, Math.round((op.bytesProcessed / op.bytesTotal) * 100));
}

export default function ImportProgressPanel({
  operation,
}: Readonly<{ operation: ImportOperation }>) {
  const percent = operationPercent(operation);

  if (operation.status === "failed") {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-md border border-destructive/50 p-3"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">{PHASE_LABELS.failed}</p>
          <p className="break-words text-muted-foreground">{operation.error}</p>
        </div>
      </div>
    );
  }

  if (operation.status === "completed") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md border p-3 text-sm">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
        <p className="font-medium">{PHASE_LABELS.complete}</p>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-3 text-sm">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <p className="font-medium">{PHASE_LABELS[operation.phase]}</p>
      </div>
      {percent !== null && operation.bytesProcessed !== null && operation.bytesTotal ? (
        <div className="space-y-1">
          <Progress
            value={percent}
            className="h-2"
            aria-label={`${PHASE_LABELS[operation.phase]} ${percent}%`}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatBytes(operation.bytesProcessed)} of {formatBytes(operation.bytesTotal)} (
            {percent}
            %)
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Large files on slow storage can take several minutes. You can close this window; progress
          is restored when you reopen it.
        </p>
      )}
    </div>
  );
}
