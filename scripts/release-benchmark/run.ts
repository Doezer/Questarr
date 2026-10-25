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
const format = (values.format ?? (datasetPath.endsWith(".jsonl") ? "jsonl" : "csv")) as
  "csv" | "jsonl";
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

const seed = Number(values.seed);
const threshold = Number(values.threshold);
const maxCalls = Number(values["max-calls"]);
const ratios = values.ratios.split(",").map(Number);
if (ratios.length !== 3 || ratios.some((r) => !Number.isFinite(r) || r < 0)) {
  fail("--ratios needs three non-negative numbers, e.g. 0.6,0.2,0.2");
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
  concurrency: Number(values.concurrency),
});
fs.mkdirSync(values.out, { recursive: true });
fs.writeFileSync(path.join(values.out, "results.json"), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(values.out, "report.md"), renderReport(result));
console.log(
  `Wrote ${path.join(values.out, "results.json")} and ${path.join(values.out, "report.md")}`
);
