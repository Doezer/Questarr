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

// Hostnames and URLs show up in error messages (DNS failures, refused connections) and
// scrubPii does not touch DNS names, so mask them before the report leaves the instance.
const URL_OR_HOST_RE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/gi;
const NAMED_HOST_RE = /\b(host(?:name)?\s*[:=]?\s*)[^\s,;'")]+/gi;

// Node resolver errors name single-label hosts too: "getaddrinfo ENOTFOUND seedbox".
const RESOLVER_ERROR_RE =
  /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH)\s+[^\s,;'")]+/g;

export function redactHosts(text: string): string {
  return text
    .replace(RESOLVER_ERROR_RE, "$1 [host]")
    .replace(URL_OR_HOST_RE, "[host]")
    .replace(NAMED_HOST_RE, "$1[host]");
}

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
};

/**
 * Plain-text report to paste into a support issue. Names of indexers and
 * download clients are replaced by their position (a name can identify a private tracker, and hostnames or URLs in messages are masked), and everything else goes
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
          : redactHosts(check.title);
      lines.push(`[${STATUS_LABELS[check.status]}] ${title}: ${redactHosts(check.message)}`);
      if (check.fix) lines.push(`    Fix: ${redactHosts(check.fix)}`);
    });
    lines.push("");
  }
  return scrubPii(lines.join("\n").trimEnd());
}
