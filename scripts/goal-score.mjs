import console from "node:console";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");

const validationChecks = [
  { name: "Lint", command: "npm run lint", points: 10 },
  { name: "Typecheck", command: "npm run check", points: 10 },
  { name: "Tests + coverage gate", command: "npm run test:coverage", points: 10 },
];

const pageChecks = [
  { name: "Dashboard", patterns: [/^client\/__tests__\/Dashboard(?:Stats|Config)\.test\.tsx$/] },
  { name: "Library", patterns: [/^client\/__tests__\/Library\.mobile\.test\.tsx$/] },
  { name: "Wishlist", patterns: [/^client\/__tests__\/WishlistPage\.mobile\.test\.tsx$/] },
  { name: "Calendar", patterns: [/^client\/__tests__\/CalendarPage\.test\.tsx$/] },
  { name: "Downloads", patterns: [/^client\/__tests__\/DownloadsPage\.test\.tsx$/] },
  { name: "Logs", patterns: [/^client\/__tests__\/LogsPage(?:\.remaining)?\.test\.tsx$/] },
  { name: "Discover", patterns: [/^client\/__tests__\/DiscoverPage\.test\.tsx$/] },
  { name: "Search", patterns: [/^client\/__tests__\/SearchPage\.test\.tsx$/] },
  { name: "Settings", patterns: [/^client\/__tests__\/SettingsPage\.test\.tsx$/] },
  { name: "Stats", patterns: [/^client\/__tests__\/StatsPage\.test\.tsx$/] },
];

const e2eChecks = [
  { name: "Setup flow", patterns: [/^tests\/e2e\/setup\.spec\.ts$/] },
  { name: "Auth flow", patterns: [/^tests\/e2e\/auth\.spec\.ts$/] },
  { name: "Navigation smoke", patterns: [/^tests\/e2e\/navigation\.spec\.ts$/] },
  { name: "Game details flow", patterns: [/^tests\/e2e\/game-details\.spec\.ts$/] },
  { name: "Discover journey", patterns: [/^tests\/e2e\/discover\.spec\.ts$/] },
  { name: "Search journey", patterns: [/^tests\/e2e\/search\.spec\.ts$/] },
  { name: "Library journey", patterns: [/^tests\/e2e\/library\.spec\.ts$/] },
  { name: "Downloads journey", patterns: [/^tests\/e2e\/downloads\.spec\.ts$/] },
];
const e2eValidationCommand = "npm run test:e2e -- --list";

// Floors match the enforced vitest.config.ts coverage.thresholds (CI gate).
// Targets are the aspirational goal this loop is pushing toward.
const coverageThresholds = [
  { name: "Statements", metric: "statements", floor: 81, target: 85 },
  { name: "Branches", metric: "branches", floor: 74, target: 78 },
  { name: "Functions", metric: "functions", floor: 77, target: 81 },
  { name: "Lines", metric: "lines", floor: 82, target: 86 },
];
const coverageMaxPoints = 30;
const coverageSummaryPath = path.join(repoRoot, "coverage", "coverage-summary.json");

function runCommand(command) {
  try {
    execSync(command, {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, CI: "1" },
    });
    return { passed: true };
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : "";
    const stderr = error?.stderr ? String(error.stderr) : "";
    return {
      passed: false,
      output: `${stdout}${stderr}`.trim(),
    };
  }
}

function collectFiles(startDir) {
  if (!fs.existsSync(startDir)) {
    return [];
  }

  return fs.readdirSync(startDir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(absolutePath);
    }
    return [path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/")];
  });
}

function summarizeChecklist(checks, files, maxPoints) {
  const satisfied = [];
  const missing = [];

  for (const check of checks) {
    const matched = files.some((file) => check.patterns.some((pattern) => pattern.test(file)));
    if (matched) {
      satisfied.push(check.name);
    } else {
      missing.push(check.name);
    }
  }

  const score = Number(((satisfied.length / checks.length) * maxPoints).toFixed(1));
  return { score, satisfied, missing };
}

function scoreCoverageDepth() {
  if (!fs.existsSync(coverageSummaryPath)) {
    return {
      score: 0,
      metrics: coverageThresholds.map((t) => ({
        name: t.name,
        pct: 0,
        floor: t.floor,
        target: t.target,
        points: 0,
      })),
      missing: coverageThresholds.map((t) => t.name),
      error: "coverage/coverage-summary.json not found — run npm run test:coverage first",
    };
  }

  const summary = JSON.parse(fs.readFileSync(coverageSummaryPath, "utf-8"));
  const perMetricMax = coverageMaxPoints / coverageThresholds.length;
  const metrics = coverageThresholds.map((t) => {
    const pct = summary.total?.[t.metric]?.pct ?? 0;
    const ratio = Math.min(Math.max((pct - t.floor) / (t.target - t.floor), 0), 1);
    const points = Number((ratio * perMetricMax).toFixed(2));
    return { name: t.name, pct, floor: t.floor, target: t.target, points };
  });

  const score = Number(metrics.reduce((sum, m) => sum + m.points, 0).toFixed(1));
  const missing = metrics
    .filter((m) => m.pct < m.target)
    .map((m) => `${m.name} (${m.pct}% < ${m.target}%)`);
  return { score, metrics, missing };
}

function icon(score, maxScore) {
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  if (ratio >= 1) return "✓";
  if (ratio >= 0.6) return "◐";
  return "✗";
}

const validationResults = validationChecks.map((check) => {
  const result = runCommand(check.command);
  return {
    ...check,
    passed: result.passed,
    score: result.passed ? check.points : 0,
    output: result.output ?? "",
  };
});

const validationScore = validationResults.reduce((sum, check) => sum + check.score, 0);
const validationFailures = validationResults
  .filter((check) => !check.passed)
  .map((check) => check.name);

const uiFiles = [
  ...collectFiles(path.join(repoRoot, "client", "__tests__")),
  ...collectFiles(path.join(repoRoot, "client", "src", "__tests__")),
];
const e2eFiles = collectFiles(path.join(repoRoot, "tests", "e2e"));

const pageCoverage = summarizeChecklist(pageChecks, uiFiles, 20);
const e2eValidation = runCommand(e2eValidationCommand);
const e2eCoverageChecklist = summarizeChecklist(e2eChecks, e2eFiles, 20);
const e2eCoverage = {
  ...e2eCoverageChecklist,
  score: e2eValidation.passed ? e2eCoverageChecklist.score : 0,
  validation: {
    command: e2eValidationCommand,
    passed: e2eValidation.passed,
  },
};

// Reuses the coverage report generated by the "Tests + coverage gate" validation
// check above rather than re-running the whole suite a second time.
const coverageDepth = scoreCoverageDepth();

const totalScore = Number(
  (validationScore + pageCoverage.score + e2eCoverage.score + coverageDepth.score).toFixed(1)
);

const output = {
  goal: "Questarr release confidence",
  score: totalScore,
  maxScore: 100,
  components: {
    validation: {
      score: validationScore,
      maxScore: 30,
      checks: validationResults.map(({ name, command, passed, score }) => ({
        name,
        command,
        passed,
        score,
      })),
      missing: validationFailures,
    },
    pageCoverage: {
      score: pageCoverage.score,
      maxScore: 20,
      satisfied: pageCoverage.satisfied,
      missing: pageCoverage.missing,
    },
    e2eJourneys: {
      score: e2eCoverage.score,
      maxScore: 20,
      satisfied: e2eCoverage.satisfied,
      missing: e2eCoverage.missing,
      validation: e2eCoverage.validation,
    },
    coverageDepth: {
      score: coverageDepth.score,
      maxScore: 30,
      metrics: coverageDepth.metrics,
      missing: coverageDepth.missing,
      ...(coverageDepth.error ? { error: coverageDepth.error } : {}),
    },
  },
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

console.log("══════════════════════════════════════════════");
console.log(`  ${output.goal}: ${output.score} / ${output.maxScore}`);
console.log("══════════════════════════════════════════════");
console.log("");
console.log(
  `  validation      ${icon(validationScore, 30)} ${validationScore.toFixed(1).padStart(4)} / 30`
);
console.log(
  `  page coverage   ${icon(pageCoverage.score, 20)} ${pageCoverage.score.toFixed(1).padStart(4)} / 20`
);
console.log(
  `  e2e journeys    ${icon(e2eCoverage.score, 20)} ${e2eCoverage.score.toFixed(1).padStart(4)} / 20`
);
console.log(
  `  coverage depth  ${icon(coverageDepth.score, 30)} ${coverageDepth.score.toFixed(1).padStart(4)} / 30`
);
console.log("");

for (const check of validationResults) {
  const status = check.passed ? "PASS" : "FAIL";
  console.log(`  - ${status} ${check.name}: ${check.command}`);
}

if (pageCoverage.missing.length > 0) {
  console.log("");
  console.log(`  Missing page tests: ${pageCoverage.missing.join(", ")}`);
}

if (e2eCoverage.missing.length > 0) {
  console.log(`  Missing e2e journeys: ${e2eCoverage.missing.join(", ")}`);
}

if (!e2eCoverage.validation.passed) {
  console.log(`  E2E journey points withheld: ${e2eCoverage.validation.command}`);
}

if (coverageDepth.missing.length > 0) {
  console.log(`  Coverage depth gaps: ${coverageDepth.missing.join(", ")}`);
}
