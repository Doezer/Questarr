import { CLASSES } from "./types.js";
import type { BenchmarkResult } from "./benchmark.js";
import type { Metrics } from "./metrics.js";

const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const ms = (v: number | null): string =>
  v === null ? "n/a" : v < 10 ? v.toFixed(2) : v.toFixed(0);

function confusionTable(metrics: Metrics): string {
  const header = `| true \\ predicted | ${CLASSES.join(" | ")} |`;
  const sep = `|---|${CLASSES.map(() => "---:").join("|")}|`;
  const rows = CLASSES.map((c, i) => `| ${c} | ${(metrics.confusion[i] ?? []).join(" | ")} |`);
  return [header, sep, ...rows].join("\n");
}

/** Human-readable comparison. Values that a provider did not report print as n/a, not 0. */
export function renderReport(result: BenchmarkResult): string {
  const { dataset } = result;
  const lines: string[] = [
    "# Release classification benchmark",
    "",
    `Dataset: ${dataset.total} labeled releases from ${dataset.games} games (seed ${dataset.seed}).`,
    `Split by game, no game appears in two parts: train ${dataset.split.train}, validation ${dataset.split.validation}, test ${dataset.split.test}.`,
    `Labels: ${CLASSES.map((c) => `${c} ${dataset.byLabel[c]}`).join(", ")}.`,
    "",
    "Trained classifiers fit on the train part only. Every classifier is scored on the same validation and test parts.",
    "",
    "## Test split",
    "",
    "| Classifier | Accuracy | Macro F1 | Abstention | Auto-accept precision | Accepted | Failures | p50 ms | p95 ms |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const c of result.classifiers) {
    const m = c.metrics.test;
    lines.push(
      `| ${c.id} | ${pct(m.accuracy)} | ${pct(m.macroF1)} | ${pct(m.abstentionRate)} | ${pct(m.autoAcceptPrecision)} | ${m.autoAcceptCount} | ${m.failures} | ${ms(c.latencyMs.p50)} | ${ms(c.latencyMs.p95)} |`
    );
  }
  lines.push(
    "",
    "## Validation split",
    "",
    "| Classifier | Accuracy | Macro F1 | Abstention | Auto-accept precision |",
    "|---|---:|---:|---:|---:|"
  );
  for (const c of result.classifiers) {
    const m = c.metrics.validation;
    lines.push(
      `| ${c.id} | ${pct(m.accuracy)} | ${pct(m.macroF1)} | ${pct(m.abstentionRate)} | ${pct(m.autoAcceptPrecision)} |`
    );
  }

  const remote = result.classifiers.filter((c) => c.remote);
  if (remote.length) {
    lines.push(
      "",
      "## Cloud usage",
      "",
      "| Classifier | Calls | Calls with cost | Cost (provider credits) | Prompt tokens | Completion tokens |",
      "|---|---:|---:|---:|---:|---:|"
    );
    for (const c of remote) {
      lines.push(
        `| ${c.id} | ${c.usage.calls} | ${c.usage.callsWithCost} | ${c.usage.costCredits ?? "n/a"} | ${c.usage.promptTokens ?? "n/a"} | ${c.usage.completionTokens ?? "n/a"} |`
      );
    }
    lines.push(
      "",
      "n/a means the provider did not report the value, which is not the same as zero."
    );
  }

  for (const c of result.classifiers) {
    const m = c.metrics.test;
    lines.push(
      "",
      `## ${c.id}: test detail`,
      "",
      "| Class | Precision | Recall | F1 | Support |",
      "|---|---:|---:|---:|---:|"
    );
    for (const cls of CLASSES) {
      const pc = m.perClass[cls];
      lines.push(
        `| ${cls} | ${pct(pc.precision)} | ${pct(pc.recall)} | ${pct(pc.f1)} | ${pc.support} |`
      );
    }
    if (m.unmeasuredClasses.length) {
      lines.push(
        "",
        `Not measurable on this split (no true example): ${m.unmeasuredClasses.join(", ")}.`
      );
    }
    lines.push("", confusionTable(m));
  }
  lines.push(
    "",
    "Notes: `unknown` is both the label for non-game items and the abstention answer, so a classifier is rewarded for staying silent on a movie and penalised for a confident guess. Macro F1 averages only the classes that occur in the true labels. Confidence of the TF-IDF baseline is a raw softmax probability and is not calibrated."
  );
  return lines.join("\n") + "\n";
}
