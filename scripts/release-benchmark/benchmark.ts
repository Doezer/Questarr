import type { ReleaseClass } from "../../shared/release-classification.js";
import { BUDGET_EXHAUSTED } from "./classifiers/remote.js";
import { computeMetrics, percentile, type Metrics } from "./metrics.js";
import { groupedSplit } from "./split.js";
import {
  CLASSES,
  foldClass,
  type BenchClassifier,
  type LabeledRelease,
  type Prediction,
} from "./types.js";

export interface BenchmarkOptions {
  seed: number;
  ratios?: readonly [number, number, number];
  concurrency?: number;
}

export interface ClassifierResult {
  id: string;
  trainable: boolean;
  remote: boolean;
  /** Metrics per evaluated part. Trained models are never scored on their training rows. */
  metrics: { validation: Metrics; test: Metrics };
  latencyMs: {
    mean: number | null;
    p50: number | null;
    p95: number | null;
    /** Predictions the statistics are computed from (budget-stopped rows excluded). */
    samples: number;
  };
  /** Sums only what providers reported; `null` means unavailable, not zero. */
  usage: {
    calls: number;
    callsWithCost: number;
    costCredits: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
  };
  /** Test-split predictions, for diffing classifiers and reading the errors. */
  testPredictions: {
    releaseName: string;
    gameTitle: string;
    truth: ReleaseClass;
    predicted: ReleaseClass;
    confidence: number | null;
    error?: string;
  }[];
}

export interface BenchmarkResult {
  dataset: {
    total: number;
    games: number;
    byLabel: Record<ReleaseClass, number>;
    split: { train: number; validation: number; test: number };
    seed: number;
  };
  classifiers: ClassifierResult[];
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

const sumOrNull = (values: readonly (number | null | undefined)[]): number | null => {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

/**
 * Runs every classifier on the same grouped split. Trainable ones fit on `train` only; all of
 * them are scored on `validation` and `test`. A classifier that throws or reports an error
 * abstains with `unknown` for that row and the failure is counted, never hidden.
 */
export async function runBenchmark(
  records: readonly LabeledRelease[],
  classifiers: readonly BenchClassifier[],
  options: BenchmarkOptions
): Promise<BenchmarkResult> {
  const split = groupedSplit(records, options.seed, options.ratios);
  const concurrency = options.concurrency ?? 4;
  const results: ClassifierResult[] = [];

  for (const classifier of classifiers) {
    if (classifier.trainable) {
      if (!classifier.train) throw new Error(`${classifier.id} is trainable but has no train()`);
      classifier.train(split.train);
    }
    const run = async (rows: readonly LabeledRelease[]): Promise<Prediction[]> =>
      mapLimit(rows, classifier.remote ? concurrency : 1, async (row) => {
        try {
          const prediction = await classifier.classify(row);
          return { ...prediction, label: foldClass(prediction.label) };
        } catch (error) {
          return {
            label: "unknown" as const,
            confidence: null,
            latencyMs: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

    const validationPredictions = await run(split.validation);
    const testPredictions = await run(split.test);
    const all = [...validationPredictions, ...testPredictions];
    // Rows the call cap stopped never reached the provider: they say nothing about its speed.
    const sent = all.filter((p) => p.error !== BUDGET_EXHAUSTED);
    const latencies = sent.map((p) => p.latencyMs);
    const costed = all.filter((p) => typeof p.costCredits === "number");

    results.push({
      id: classifier.id,
      trainable: classifier.trainable,
      remote: classifier.remote,
      metrics: {
        validation: computeMetrics(
          split.validation.map((r) => r.label),
          validationPredictions
        ),
        test: computeMetrics(
          split.test.map((r) => r.label),
          testPredictions
        ),
      },
      latencyMs: {
        mean: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        samples: latencies.length,
      },
      usage: {
        calls: classifier.remote ? sent.length : 0,
        callsWithCost: costed.length,
        costCredits: sumOrNull(all.map((p) => p.costCredits)),
        promptTokens: sumOrNull(all.map((p) => p.promptTokens)),
        completionTokens: sumOrNull(all.map((p) => p.completionTokens)),
      },
      testPredictions: split.test.map((row, i) => {
        const pred = testPredictions[i];
        return {
          releaseName: row.releaseName,
          gameTitle: row.gameTitle,
          truth: row.label,
          predicted: pred?.label ?? "unknown",
          confidence: pred?.confidence ?? null,
          ...(pred?.error ? { error: pred.error } : {}),
        };
      }),
    });
  }

  const byLabel = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<ReleaseClass, number>;
  for (const r of records) byLabel[r.label]++;
  return {
    dataset: {
      total: records.length,
      games: new Set(records.map((r) => r.gameTitle.toLowerCase())).size,
      byLabel,
      split: {
        train: split.train.length,
        validation: split.validation.length,
        test: split.test.length,
      },
      seed: options.seed,
    },
    classifiers: results,
  };
}
