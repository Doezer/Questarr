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
  { name: "Unit/integration tests", command: "npm run test:run", points: 20 },
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

const pageCoverage = summarizeChecklist(pageChecks, uiFiles, 30);
const e2eCoverage = summarizeChecklist(e2eChecks, e2eFiles, 30);
const totalScore = Number((validationScore + pageCoverage.score + e2eCoverage.score).toFixed(1));

const output = {
  goal: "Questarr release confidence",
  score: totalScore,
  maxScore: 100,
  components: {
    validation: {
      score: validationScore,
      maxScore: 40,
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
      maxScore: 30,
      satisfied: pageCoverage.satisfied,
      missing: pageCoverage.missing,
    },
    e2eJourneys: {
      score: e2eCoverage.score,
      maxScore: 30,
      satisfied: e2eCoverage.satisfied,
      missing: e2eCoverage.missing,
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
  `  validation      ${icon(validationScore, 40)} ${validationScore.toFixed(1).padStart(4)} / 40`
);
console.log(
  `  page coverage   ${icon(pageCoverage.score, 30)} ${pageCoverage.score.toFixed(1).padStart(4)} / 30`
);
console.log(
  `  e2e journeys    ${icon(e2eCoverage.score, 30)} ${e2eCoverage.score.toFixed(1).padStart(4)} / 30`
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
