import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, ExternalLink, Loader2, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { buildGitHubIssueUrl } from "@/lib/send-logs";

interface SendErrorReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** id from a notification link of the form `error-report:<reportId>` */
  reportId: string | null;
}

interface PendingReportMeta {
  lineCount: number;
  appVersion: string;
  platform: string;
  timestamp: string;
}

interface SendSuccess {
  code: string;
  issueNumber: number;
}

type Step = "consent" | "sending" | "success" | "error";

/**
 * Consent + send flow for a server-detected error, opened from the
 * "An error occurred" notification (see NotificationCenter.tsx).
 *
 * Mirrors SendLogsDialog's UX, but the log bundle is built and scrubbed
 * server-side (server/error-telemetry.ts) — this dialog only fetches
 * metadata for the consent screen and confirms the send.
 */
export default function SendErrorReportDialog({
  open,
  onOpenChange,
  reportId,
}: Readonly<SendErrorReportDialogProps>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("consent");
  const [result, setResult] = useState<SendSuccess | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    data: meta,
    isLoading,
    isError,
    error: metaError,
    refetch: refetchMeta,
  } = useQuery<PendingReportMeta>({
    queryKey: ["/api/telemetry/pending", reportId],
    enabled: open && !!reportId,
    retry: false,
  });

  // Only a 404 means the report actually expired/was already sent. Any other
  // failure (network error, timeout, 5xx, auth) is a transient request error
  // the user should be able to retry rather than being told the report is gone.
  const metaExpired = isError && metaError instanceof ApiError && metaError.status === 404;
  const metaLoadFailed = isError && !metaExpired;

  const reset = useCallback(() => {
    setStep("consent");
    setResult(null);
    setErrorMessage(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const handleSend = useCallback(async () => {
    if (!reportId) return;
    setStep("sending");
    try {
      const res = await apiRequest("POST", `/api/telemetry/pending/${reportId}/send`);
      const data = (await res.json()) as SendSuccess;
      setResult(data);
      setStep("success");
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : "Failed to send diagnostic report.");
      setStep("error");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["/api/telemetry/pending", reportId] });
    }
  }, [reportId, queryClient]);

  const handleCopyCode = useCallback(() => {
    if (!result) return;
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      toast({
        title: "Copy failed",
        description: "Clipboard API not supported in this browser",
        variant: "destructive",
      });
      return;
    }
    clipboard
      .writeText(result.code)
      .then(() => {
        toast({ title: "Copied", description: `Code ${result.code} copied to clipboard` });
      })
      .catch(() => {
        toast({
          title: "Copy failed",
          description: "Clipboard access denied",
          variant: "destructive",
        });
      });
  }, [result, toast]);

  const issueUrl =
    result && meta ? buildGitHubIssueUrl(result.code, meta.appVersion, result.issueNumber) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {/* ── Expired / not found ─────────────────────────────────────────── */}
        {/* All metadata-query-derived states are scoped to step === "consent": after a
            successful send, the finally block below invalidates this query, which
            refetches the now-deleted report and 404s — without this guard that would
            replace the "success" screen with "Report no longer available". */}
        {step === "consent" && metaExpired && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Report no longer available
              </DialogTitle>
              <DialogDescription>
                This diagnostic report has expired or was already sent. You can still send fresh
                logs from the Logs page at any time.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Metadata request failed (not expired — network/server error) ──── */}
        {step === "consent" && metaLoadFailed && (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">Couldn't load report</DialogTitle>
              <DialogDescription>
                {metaError instanceof ApiError
                  ? metaError.message
                  : "Something went wrong loading this report."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => refetchMeta()}>
                Try again
              </Button>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Loading metadata ─────────────────────────────────────────────── */}
        {step === "consent" && !metaExpired && !metaLoadFailed && isLoading && (
          <>
            <DialogHeader>
              <DialogTitle>Loading report…</DialogTitle>
              <DialogDescription className="sr-only">Fetching report details</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          </>
        )}

        {/* ── Consent ─────────────────────────────────────────────────────── */}
        {!metaExpired && !metaLoadFailed && !isLoading && meta && step === "consent" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                An error occurred
              </DialogTitle>
              <DialogDescription className="sr-only">
                Review what will be shared before confirming
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1 text-sm">
              <p className="text-muted-foreground">
                Questarr detected an unexpected error. Sending a diagnostic report helps the
                maintainer fix it. Please review what will be shared:
              </p>

              <ul className="space-y-2 text-zinc-300">
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>Log content</strong> — the {meta.lineCount} most recent server log lines
                    around the error, with emails, IP addresses, and UUIDs replaced by placeholders.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>App version</strong> — {meta.appVersion}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>Timestamp</strong> — {meta.timestamp}
                  </span>
                </li>
              </ul>

              <div className="flex items-start gap-2 rounded-lg border border-yellow-800/40 bg-yellow-950/30 p-3 text-yellow-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="text-xs leading-relaxed">
                  Reports are stored as an issue in a <strong>private</strong> GitHub repository
                  visible only to the Questarr maintainer, marked as an automated telemetry report
                  so it's clearly distinguished from a manually submitted one. You will receive an
                  issue number as your support code.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Dismiss
              </Button>
              <Button onClick={handleSend}>
                <Send className="mr-2 h-4 w-4" />
                Send report
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Sending ──────────────────────────────────────────────────────── */}
        {step === "sending" && (
          <>
            <DialogHeader>
              <DialogTitle>Sending report…</DialogTitle>
              <DialogDescription className="sr-only">Upload in progress</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Uploading diagnostic report…</p>
            </div>
          </>
        )}

        {/* ── Success ──────────────────────────────────────────────────────── */}
        {step === "success" && result && (
          <>
            <DialogHeader>
              <DialogTitle>Report sent</DialogTitle>
              <DialogDescription className="sr-only">Support code ready</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">Give this code to support:</p>

              <div className="flex items-center gap-3 rounded-xl border border-border bg-zinc-900 px-4 py-3">
                <span
                  className="flex-1 text-center font-mono text-3xl font-bold tracking-[0.3em] text-primary"
                  aria-label={`Support code: ${result.code}`}
                >
                  {result.code}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCode}
                  aria-label="Copy support code"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="sm:mr-auto"
              >
                Close
              </Button>
              {issueUrl && (
                <Button asChild>
                  <a href={issueUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Create GitHub issue
                  </a>
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* ── Error ────────────────────────────────────────────────────────── */}
        {step === "error" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">Send failed</DialogTitle>
              <DialogDescription className="sr-only">Error details</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Try again
              </Button>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
