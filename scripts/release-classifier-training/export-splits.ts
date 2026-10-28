import fs from "node:fs";
import { importDataset } from "../release-benchmark/dataset.js";
import { groupedSplit } from "../release-benchmark/split.js";
import { foldClass } from "../release-benchmark/types.js";

/**
 * Writes the benchmark's train/validation/test assignment as JSON so the Python training
 * pipeline evaluates on exactly the rows the TypeScript benchmark scores.
 *
 *   npx tsx scripts/release-classifier-training/export-splits.ts <dataset.csv> <out.json> [seed]
 */
const [datasetPath, outPath, seedArg] = process.argv.slice(2);
if (!datasetPath || !outPath) {
  console.error("Usage: export-splits.ts <dataset.csv> <out.json> [seed]");
  process.exit(2);
}
const format = datasetPath.endsWith(".jsonl") ? "jsonl" : "csv";
const { records } = importDataset(fs.readFileSync(datasetPath, "utf8"), format);
const folded = records.map((record) => ({ ...record, label: foldClass(record.label) }));
const split = groupedSplit(folded, Number(seedArg ?? 42));

const rows = (["train", "validation", "test"] as const).flatMap((part) =>
  split[part].map((row) => ({
    part,
    releaseName: row.releaseName,
    gameTitle: row.gameTitle,
    label: row.label,
  }))
);
fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
console.log(
  `Wrote ${rows.length} rows (${split.train.length} train, ${split.validation.length} validation, ${split.test.length} test) to ${outPath}`
);
