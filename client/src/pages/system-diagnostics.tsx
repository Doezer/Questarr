import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle,
  Clipboard,
  Loader2,
  MinusCircle,
  Play,
  Stethoscope,
  XCircle,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  GROUP_LABELS,
  buildRedactedReport,
  type CheckStatus,
  type SetupCheck,
  type SetupCheckReport,
} from "@/lib/setup-report";

const STATUS_META: Record<
  CheckStatus,
  { label: string; className: string; Icon: typeof CheckCircle }
> = {
  pass: {
    label: "Passed",
    className:
      "border-emerald-300 bg-emerald-100 text-emerald-800 in-[.dark]:border-emerald-700/50 in-[.dark]:bg-emerald-900/40 in-[.dark]:text-emerald-400",
    Icon: CheckCircle,
  },
  warn: {
    label: "Warning",
    className:
      "border-amber-300 bg-amber-100 text-amber-800 in-[.dark]:border-amber-700/50 in-[.dark]:bg-amber-900/40 in-[.dark]:text-amber-400",
    Icon: AlertTriangle,
  },
  fail: {
    label: "Failed",
    className:
      "border-red-300 bg-red-100 text-red-800 in-[.dark]:border-red-700/50 in-[.dark]:bg-red-900/40 in-[.dark]:text-red-400",
    Icon: XCircle,
  },
  skip: {
    label: "Info",
    className:
      "border-slate-300 bg-slate-100 text-slate-700 in-[.dark]:border-slate-600/50 in-[.dark]:bg-slate-800/40 in-[.dark]:text-slate-300",
    Icon: MinusCircle,
  },
};

function StatusBadge({ status }: Readonly<{ status: CheckStatus }>) {
  const { label, className, Icon } = STATUS_META[status];
  return (
    <Badge className={`shrink-0 gap-1 ${className}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

function CheckRow({ check }: Readonly<{ check: SetupCheck }>) {
  return (
    <li
      className="rounded-lg border border-[#374151]/40 bg-card p-4"
      data-testid={`setup-check-${check.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words font-medium">{check.title}</p>
        <StatusBadge status={check.status} />
      </div>
      <p className="mt-1 break-words text-sm text-muted-foreground">{check.message}</p>
      {check.fix && (
        <p className="mt-2 break-words text-sm">
          <span className="font-medium">How to fix: </span>
          {check.fix}
        </p>
      )}
    </li>
  );
}

export default function SystemDiagnosticsPage() {
  const { toast } = useToast();

  const run = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/system/setup-checks");
      return (await response.json()) as SetupCheckReport;
    },
    onError: (error: Error) =>
      toast({
        title: "Could not run the checks",
        description: error.message,
        variant: "destructive",
      }),
  });
  const report = run.data;

  const groups = useMemo(() => {
    if (!report) return [];
    return (Object.keys(GROUP_LABELS) as SetupCheck["group"][])
      .map((group) => ({ group, checks: report.checks.filter((c) => c.group === group) }))
      .filter((entry) => entry.checks.length > 0);
  }, [report]);

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildRedactedReport(report));
      toast({
        title: "Report copied",
        description: "Hosts, keys and personal paths are redacted.",
      });
    } catch {
      toast({ title: "Could not copy the report", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Diagnostics"
        description="Checks your setup (paths, hardlinks, indexers, download clients, tools) and explains how to fix what is wrong. Nothing is changed."
        actions={
          <>
            {report && (
              <Button variant="outline" className="h-11 justify-center sm:h-9" onClick={copyReport}>
                <Clipboard className="mr-2 h-4 w-4" aria-hidden="true" />
                Copy report
              </Button>
            )}
            <Button
              className="h-11 justify-center sm:h-9"
              onClick={() => run.mutate()}
              disabled={run.isPending}
            >
              {run.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {report ? "Run again" : "Run checks"}
            </Button>
          </>
        }
      />

      {!report && !run.isPending && (
        <div className="flex h-48 flex-col items-center justify-center text-center text-muted-foreground">
          <Stethoscope className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="text-sm">Run the checks to see what needs attention.</p>
        </div>
      )}
      {run.isPending && !report && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking indexers and download clients…
        </p>
      )}

      {report && (
        <div aria-live="polite">
          <p className="mb-4 text-sm text-muted-foreground" data-testid="setup-check-summary">
            {report.summary.fail} failed · {report.summary.warn} warnings · {report.summary.pass}{" "}
            passed
          </p>
          <div className="flex flex-col gap-6">
            {groups.map(({ group, checks }) => (
              <section key={group} aria-labelledby={`setup-group-${group}`}>
                <h2 id={`setup-group-${group}`} className="mb-2 text-lg font-semibold">
                  {GROUP_LABELS[group]}
                </h2>
                <ul className="flex flex-col gap-2">
                  {checks.map((check) => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
