#!/usr/bin/env node
/**
 * VEX-aware SCA gate.
 *
 * Runs `npm audit --omit=dev --json` against the committed dependency tree and
 * fails on any Critical or High finding in production dependencies that is not
 * covered by a statement in the project's OpenVEX feed
 * (`security/vex/questarr.openvex.json`). Findings whose advisory ID (GHSA-… /
 * CVE-…) appears in a `not_affected` or `fixed` statement are reported as
 * suppressed instead of failing; the raw audit report is still printed (and
 * optionally written to disk) so the suppression stays visible in CI logs.
 *
 * Policy: `docs/VULNERABILITY_MANAGEMENT.md` §1.2–1.3. A finding may only be
 * excluded through the VEX feed — this script deliberately has no per-package
 * special-casing, and it fails closed: a Critical/High finding that carries no
 * advisory ID (so it cannot be matched to a VEX statement) blocks the build.
 *
 * Usage:
 *   node scripts/audit-gate.mjs [--write-report <path>]
 *
 *   --write-report <path>  also write the raw `npm audit --json` output to
 *                          <path> (used by the vulnerability-scan workflow's
 *                          npm-audit-report artifact).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VEX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "security",
  "vex",
  "questarr.openvex.json"
);

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
// Statement statuses whose statements satisfy the SCA gate for the stated
// finding. `affected`/`under_investigation` do not suppress anything.
const SUPPRESSING_STATUSES = new Set(["not_affected", "fixed"]);

/**
 * Normalize a vulnerability identifier for comparison: trim, uppercase, and
 * accept both "GHSA-xxxx-xxxx-xxxx" and "CVE-yyyy-nnnn" shapes (the VEX feed
 * and the audit report do not agree on casing in all cases).
 */
export function normalizeAdvisoryId(id) {
  if (typeof id !== "string") return null;
  const trimmed = id.trim().toUpperCase();
  if (!trimmed) return null;
  if (/^GHSA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(trimmed)) return trimmed;
  if (/^CVE-\d{4}-\d{4,}$/.test(trimmed)) return trimmed;
  return trimmed;
}

/**
 * Collect the advisory IDs the VEX feed clears for the SCA gate: the `@id`
 * and every `aliases[]` entry of each `not_affected`/`fixed` statement.
 * Throws if the feed is missing or unparseable — a broken feed must never
 * silently pass the gate.
 */
export function collectVexAllowlist(vexJson) {
  if (!vexJson || typeof vexJson !== "object") {
    throw new Error("VEX feed is not a JSON object");
  }
  if (!Array.isArray(vexJson.statements)) {
    throw new Error("VEX feed has no statements array");
  }
  const allowlist = new Set();
  for (const statement of vexJson.statements) {
    if (!statement || !SUPPRESSING_STATUSES.has(statement.status)) continue;
    const vuln = statement.vulnerability || {};
    const ids = [vuln["@id"], ...(Array.isArray(vuln.aliases) ? vuln.aliases : [])];
    for (const id of ids) {
      const normalized = normalizeAdvisoryId(id);
      if (normalized) allowlist.add(normalized);
    }
  }
  return allowlist;
}

/**
 * Extract the advisory identifiers (GHSA-/CVE-) referenced by a single audit
 * vulnerability. `via` entries are either plain strings (the dependent
 * package names, no advisory) or objects carrying an advisory `url`.
 */
export function extractAdvisoryIds(vulnerability) {
  const ids = new Set();
  for (const via of vulnerability.via ?? []) {
    if (typeof via !== "object" || via === null || typeof via.url !== "string") {
      continue;
    }
    // https://github.com/advisories/GHSA-86w9-cpqp-85rv (case-insensitive)
    const ghsa = via.url.match(/advisories\/(GHSA-[0-9a-zA-Z-]+)/i);
    if (ghsa) {
      const normalized = normalizeAdvisoryId(ghsa[1]);
      if (normalized) ids.add(normalized);
    }
    // https://nvd.nist.gov/vuln/detail/CVE-2026-33894 (or any CVE-shaped URL)
    const cve = via.url.match(/(CVE-\d{4}-\d{4,})/i);
    if (cve) {
      const normalized = normalizeAdvisoryId(cve[1]);
      if (normalized) ids.add(normalized);
    }
  }
  return ids;
}

/**
 * Evaluate an `npm audit --json` report against the VEX allowlist.
 *
 * Returns:
 *   blocking    – Critical/High findings with at least one advisory ID not in
 *                 the allowlist (or none at all: fail closed).
 *   suppressed  – Critical/High findings fully covered by the allowlist.
 *   nonBlocking – Moderate/Low/info findings (reported, never gating).
 * Each entry is `{ name, severity, ids: string[], reason? }`, where `reason`
 * carries the VEX statement's justification for suppressed findings.
 */
export function evaluate(auditJson, vexAllowlist) {
  if (!auditJson || typeof auditJson !== "object") {
    throw new Error("audit report is not a JSON object");
  }
  const blocking = [];
  const suppressed = [];
  const nonBlocking = [];

  for (const vuln of Object.values(auditJson.vulnerabilities ?? {})) {
    const ids = [...extractAdvisoryIds(vuln)].sort();
    const entry = {
      name: vuln.name,
      severity: vuln.severity,
      ids,
      range: vuln.range,
      fixAvailable: vuln.fixAvailable,
    };

    if (!BLOCKING_SEVERITIES.has(vuln.severity)) {
      nonBlocking.push(entry);
      continue;
    }

    if (ids.length === 0) {
      // No advisory ID to match a VEX statement against — fail closed.
      entry.reason = "no advisory ID in the audit report; cannot match a VEX statement";
      blocking.push(entry);
      continue;
    }

    const uncovered = ids.filter((id) => !vexAllowlist.has(id));
    if (uncovered.length > 0) {
      entry.reason = `advisory ${uncovered.join(", ")} has no not_affected/fixed VEX statement`;
      blocking.push(entry);
    } else {
      entry.reason = "covered by the VEX feed";
      suppressed.push(entry);
    }
  }

  return { blocking, suppressed, nonBlocking };
}

/** Load and validate the OpenVEX feed file. */
export function loadVexFeed(vexPath = VEX_PATH) {
  let raw;
  try {
    raw = readFileSync(vexPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read VEX feed at ${vexPath}: ${err.message}`, { cause: err });
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`VEX feed at ${vexPath} is not valid JSON: ${err.message}`, { cause: err });
  }
  return collectVexAllowlist(json);
}

/** Run `npm audit --omit=dev --json` and return the parsed report. */
export function runNpmAudit(cwd = process.cwd()) {
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // npm audit exits 1 when it finds vulnerabilities (expected); any other
    // non-zero exit (network failure, bad lockfile, …) is a real error that
    // must fail the gate rather than pass it.
    if (err.status === 1 && err.stdout) {
      raw = err.stdout;
    } else {
      const detail = (err.stdout || "") + (err.stderr || "");
      throw new Error(
        `npm audit failed with exit code ${err.status ?? "unknown"}:\n${detail.slice(-4000)}`,
        { cause: err }
      );
    }
  }
  return JSON.parse(raw);
}

function printSummary(result, meta) {
  const out = (msg) => process.stdout.write(`${msg}\n`);
  out("SCA gate: npm audit --omit=dev, VEX-aware");
  const counts = meta?.vulnerabilities ?? {};
  out(
    `  vulnerabilities: total=${counts.total ?? "?"} critical=${counts.critical ?? "?"} ` +
      `high=${counts.high ?? "?"} moderate=${counts.moderate ?? "?"} low=${counts.low ?? "?"}`
  );
  for (const entry of result.suppressed) {
    out(
      `  ✓ suppressed (VEX): ${entry.name} [${entry.severity}] ${entry.ids.join(", ")} — ${entry.reason}`
    );
  }
  for (const entry of result.nonBlocking) {
    out(
      `  - ${entry.name} [${entry.severity}] ${entry.ids.join(", ") || "(no advisory ID)"} — below gate threshold`
    );
  }
  for (const entry of result.blocking) {
    out(
      `  ✗ blocking: ${entry.name} [${entry.severity}] ${entry.ids.join(", ") || "(no advisory ID)"} — ${entry.reason}`
    );
  }
  if (result.blocking.length > 0) {
    out(`  RESULT: FAIL — ${result.blocking.length} unaddressed Critical/High finding(s).`);
    out(
      "  Fix, or record a not_affected/fixed statement in security/vex/questarr.openvex.json per docs/VULNERABILITY_MANAGEMENT.md §1.2."
    );
  } else {
    out("  RESULT: PASS — no unaddressed Critical/High findings.");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const writeIdx = argv.indexOf("--write-report");
  const writeReportTo = writeIdx !== -1 ? argv[writeIdx + 1] : null;

  let report;
  let allowlist;
  let result;
  try {
    report = runNpmAudit();
    if (writeReportTo) {
      writeFileSync(writeReportTo, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    allowlist = loadVexFeed();
    result = evaluate(report, allowlist);
  } catch (err) {
    process.stderr.write(`SCA gate error: ${err.message}\n`);
    process.exit(1);
  }

  printSummary(result, report.metadata?.vulnerabilities ? report.metadata : undefined);
  process.exit(result.blocking.length > 0 ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
