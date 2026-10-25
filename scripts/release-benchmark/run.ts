import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runBenchmark } from "./benchmark.js";
import { deterministicClassifier } from "./classifiers/deterministic.js";
import { jevClassifier, openRouterClassifier } from "./classifiers/remote.js";
import { TfidfClassifier } from "./classifiers/tfidf.js";
import { importDataset } from "./dataset.js";
import { renderReport } from "./report.js";
import type { BenchClassifier } from "./types.js";

/**
 * Release classification benchmark CLI (ADR-001 task 3).
 *
 *   npx tsx scripts/release-benchmark/run.ts --dataset releases-labeled.csv --validate-only
 *   npx tsx scripts/release-benchmark/run.ts --dataset releases-labeled.csv --classifiers deterministic,tfidf,tfidf-title
 *   TYPESAFE_API_KEY=... npx tsx scripts/release-benchmark/run.ts --dataset ... --classifiers deterministic,jev
 *
 * Cloud classifiers (`jev`, `openrouter:<model>`) only run when named in --classifiers and
 * when their credentials are in the environment; each is capped by --max-calls.
 */
const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    format: { type: "string" },
    classifiers: { type: "string", default: "deterministic,tfidf,tfidf-title" },
    seed: { type: "string", default: "42" },
    ratios: { type: "string", default: "0.6,0.2,0.2" },
    threshold: { type: "string", default: "0.5" },
    out: { type: "string", default: "benchmark-results" },
    "max-calls": { type: "string", default: "200" },
    concurrency: { type: "string", default: "4" },
    "validate-only": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

if (!values.dataset) fail("Missing --dataset <file.csv|file.jsonl>");
const datasetPath = values.dataset;
const formatArg = values.format ?? (datasetPath.endsWith(".jsonl") ? "jsonl" : "csv");
if (formatArg !== "csv" && formatArg !== "jsonl") {
  fail(`--format must be "csv" or "jsonl", got "${formatArg}"`);
}
const format = formatArg;
const { records, issues } = importDataset(fs.readFileSync(datasetPath, "utf8"), format);

console.log(`${records.length} usable records.`);
console.log(
  `${issues.unlabeled.length} unlabeled or invalid, ${issues.duplicates.length} duplicates merged, ${issues.conflicts.length} conflicting, ${issues.malformed} malformed.`
);
for (const conflict of issues.conflicts) {
  console.warn(
    `Conflict: "${conflict.releaseName}" (${conflict.gameTitle}) labeled ${conflict.labels.join(" and ")}`
  );
}
for (const row of issues.unlabeled.slice(0, 20)) {
  console.warn(`Skipped "${row.releaseName}": ${row.reason}`);
}
if (values["validate-only"]) process.exit(issues.conflicts.length ? 1 : 0);

function numberArg(name: string, raw: string, check: (n: number) => boolean, hint: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || !check(value)) {
    fail(`--${name} must be ${hint}, got "${raw}"`);
  }
  return value;
}

const seed = numberArg("seed", values.seed, Number.isInteger, "an integer");
const threshold = numberArg(
  "threshold",
  values.threshold,
  (n) => n >= 0 && n <= 1,
  "between 0 and 1"
);
// A malformed cap must fail here: NaN or Infinity would silently remove the spending limit.
const maxCalls = numberArg(
  "max-calls",
  values["max-calls"],
  (n) => Number.isInteger(n) && n >= 0,
  "a non-negative integer"
);
const concurrency = numberArg(
  "concurrency",
  values.concurrency,
  (n) => Number.isInteger(n) && n >= 1,
  "an integer of at least 1"
);
const ratios = values.ratios
  .split(",")
  .map((r) =>
    numberArg("ratios", r, (n) => n >= 0, "three non-negative numbers, e.g. 0.6,0.2,0.2")
  );
if (ratios.length !== 3 || ratios.every((r) => r === 0)) {
  fail("--ratios needs three non-negative numbers, e.g. 0.6,0.2,0.2");
}
const usesTfidf = values.classifiers
  .split(",")
  .map((s) => s.trim())
  .some((id) => id === "tfidf" || id === "tfidf-title");
if (usesTfidf && ratios[0] === 0) {
  fail(
    "--ratios needs a positive training share (first value) when a tfidf classifier is selected"
  );
}

const classifiers: BenchClassifier[] = [];
for (const id of values.classifiers
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)) {
  if (id === "deterministic") classifiers.push(deterministicClassifier());
  else if (id === "tfidf" || id === "tfidf-title") {
    classifiers.push(new TfidfClassifier({ titleAware: id === "tfidf-title", seed, threshold }));
  } else if (id === "jev") {
    const url = process.env.TYPESAFE_API_URL ?? "https://api.typesafe.ai/v1/systemone";
    // The OpenRouter key goes only to openrouter.ai, never to another host.
    const apiKey =
      process.env.TYPESAFE_API_KEY ??
      (new URL(url).hostname === "openrouter.ai" ? process.env.OPENROUTER_API_KEY : undefined);
    if (!apiKey) {
      fail(
        "jev needs TYPESAFE_API_KEY, or OPENROUTER_API_KEY together with an openrouter.ai TYPESAFE_API_URL"
      );
    }
    classifiers.push(
      jevClassifier({ url, model: process.env.TYPESAFE_MODEL ?? "jev-latest", apiKey, maxCalls })
    );
  } else if (id.startsWith("openrouter:")) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) fail("openrouter:<model> needs OPENROUTER_API_KEY");
    classifiers.push(
      openRouterClassifier({ model: id.slice("openrouter:".length), apiKey, maxCalls })
    );
  } else fail(`Unknown classifier "${id}"`);
}

const result = await runBenchmark(records, classifiers, {
  seed,
  ratios: [ratios[0] ?? 0.6, ratios[1] ?? 0.2, ratios[2] ?? 0.2],
  concurrency,
});
fs.mkdirSync(values.out, { recursive: true });
fs.writeFileSync(path.join(values.out, "results.json"), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(values.out, "report.md"), renderReport(result));
console.log(
  `Wrote ${path.join(values.out, "results.json")} and ${path.join(values.out, "report.md")}`
);
