import { scrubPii } from "@shared/log-scrub";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface SetupCheck {
  id: string;
  group: "paths" | "indexers" | "downloaders" | "tools";
  title: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface SetupCheckReport {
  generatedAt: string;
  summary: Record<CheckStatus, number>;
  checks: SetupCheck[];
}

export const GROUP_LABELS: Record<SetupCheck["group"], string> = {
  paths: "Paths and storage",
  indexers: "Indexers",
  downloaders: "Download clients",
  tools: "Tools and services",
};

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
};

/**
 * Plain-text report to paste into a support issue. Names of indexers and
 * download clients are replaced by their position (hosts and keys are never in
 * a check, but a name can identify a private tracker), and everything else goes
 * through the same PII scrubber as the "Send Logs" flow.
 */
export function buildRedactedReport(report: SetupCheckReport): string {
  const lines = [
    "Questarr setup diagnostics",
    `Generated: ${report.generatedAt}`,
    `Summary: ${report.summary.fail} failed, ${report.summary.warn} warnings, ${report.summary.pass} passed`,
    "",
  ];
  for (const group of Object.keys(GROUP_LABELS) as SetupCheck["group"][]) {
    const checks = report.checks.filter((c) => c.group === group);
    if (checks.length === 0) continue;
    lines.push(`## ${GROUP_LABELS[group]}`);
    checks.forEach((check, index) => {
      const title =
        group === "indexers" || group === "downloaders"
          ? `${group === "indexers" ? "Indexer" : "Download client"} #${index + 1}`
          : check.title;
      lines.push(`[${STATUS_LABELS[check.status]}] ${title}: ${check.message}`);
      if (check.fix) lines.push(`    Fix: ${check.fix}`);
    });
    lines.push("");
  }
  return scrubPii(lines.join("\n").trimEnd());
}
