import { useState, useCallback } from "react";
import { Copy, ExternalLink, Loader2, Send, ShieldAlert } from "lucide-react";
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
import {
  buildGitHubIssueUrl,
  detectPlatform,
  scrubLogLines,
  sendLogs,
  type SendLogsResult,
} from "@/lib/send-logs";

interface SendLogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raw NDJSON lines currently visible in the log viewer */
  logLines: string[];
}

type Step = "consent" | "sending" | "success" | "error";

declare const __APP_VERSION__: string;

const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";

export default function SendLogsDialog({ open, onOpenChange, logLines }: SendLogsDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("consent");
  const [result, setResult] = useState<SendLogsResult | null>(null);

  const reset = useCallback(() => {
    setStep("consent");
    setResult(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const handleSend = useCallback(async () => {
    setStep("sending");

    const scrubbedLogs = scrubLogLines(logLines);
    const outcome = await sendLogs({
      logs: scrubbedLogs,
      appVersion: APP_VERSION,
      platform: detectPlatform(),
      timestamp: new Date().toISOString(),
    });

    setResult(outcome);
    setStep(outcome.ok ? "success" : "error");
  }, [logLines]);

  const handleCopyCode = useCallback(() => {
    if (!result?.ok) return;
    navigator.clipboard
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

  const issueUrl = result?.ok ? buildGitHubIssueUrl(result.code, APP_VERSION) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {/* ── Consent ─────────────────────────────────────────────────────── */}
        {step === "consent" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Send logs to support
              </DialogTitle>
              <DialogDescription className="sr-only">
                Review what will be shared before confirming
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1 text-sm">
              <p className="text-muted-foreground">
                This will upload your current server logs so the Questarr maintainer can diagnose
                your issue. Please review what will be shared:
              </p>

              <ul className="space-y-2 text-zinc-300">
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>Log content</strong> — the {logLines.length} lines currently displayed
                    in the log viewer, with emails, IP addresses, and UUIDs replaced by
                    placeholders.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>App version</strong> — {APP_VERSION}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>Platform</strong> — {detectPlatform()}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 text-blue-400">•</span>
                  <span>
                    <strong>Timestamp</strong> — current date/time (UTC)
                  </span>
                </li>
              </ul>

              <div className="flex items-start gap-2 rounded-lg border border-yellow-800/40 bg-yellow-950/30 p-3 text-yellow-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="text-xs leading-relaxed">
                  Logs are stored as an issue in a <strong>private</strong> GitHub repository
                  visible only to the Questarr maintainer. You will receive an issue number as your
                  support code — share only that number with support.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSend()} disabled={logLines.length === 0}>
                <Send className="mr-2 h-4 w-4" />
                Send logs
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Sending ──────────────────────────────────────────────────────── */}
        {step === "sending" && (
          <>
            <DialogHeader>
              <DialogTitle>Uploading logs…</DialogTitle>
              <DialogDescription className="sr-only">Upload in progress</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Scrubbing PII and uploading…</p>
            </div>
          </>
        )}

        {/* ── Success ──────────────────────────────────────────────────────── */}
        {step === "success" && result?.ok && (
          <>
            <DialogHeader>
              <DialogTitle>Logs uploaded</DialogTitle>
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

              <p className="text-sm text-muted-foreground">
                Or open a public GitHub issue with this number pre-filled so the maintainer can look
                it up:
              </p>
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
        {step === "error" && result && !result.ok && (
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">Upload failed</DialogTitle>
              <DialogDescription className="sr-only">Error details</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">{result.message}</p>
              {result.status === 429 && (
                <p className="text-xs text-zinc-500">
                  You can submit up to 5 log bundles per hour per IP address.
                </p>
              )}
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
