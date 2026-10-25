import type { ReleaseClass } from "../../shared/release-classification.js";
import { CLASSES, type Prediction } from "./types.js";

export interface ClassMetrics {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
}

export interface Metrics {
  n: number;
  accuracy: number | null;
  /** Mean F1 over the classes that occur in the truth; classes with no support are excluded. */
  macroF1: number | null;
  perClass: Record<ReleaseClass, ClassMetrics>;
  /** Rows are the true class, columns the predicted one, in CLASSES order. */
  confusion: number[][];
  /** Share of predictions that were `unknown`. */
  abstentionRate: number | null;
  /** Precision over the predictions that were not `unknown`, i.e. the ones that would be acted on. */
  autoAcceptPrecision: number | null;
  autoAcceptCount: number;
  /** Classes with no true example: their precision/recall are not measurable here. */
  unmeasuredClasses: ReleaseClass[];
  failures: number;
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function computeMetrics(
  truth: readonly ReleaseClass[],
  predictions: readonly Pick<Prediction, "label" | "error">[]
): Metrics {
  if (truth.length !== predictions.length) {
    throw new Error("truth and predictions must have the same length");
  }
  const index = new Map(CLASSES.map((c, i) => [c, i] as const));
  const size = CLASSES.length;
  const confusion = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  let correct = 0;
  let abstained = 0;
  let accepted = 0;
  let acceptedCorrect = 0;
  let failures = 0;

  truth.forEach((actual, i) => {
    const pred = predictions[i];
    if (!pred) return;
    const row = confusion[index.get(actual) ?? 0];
    if (row) row[index.get(pred.label) ?? 0] = (row[index.get(pred.label) ?? 0] ?? 0) + 1;
    if (pred.error) failures++;
    if (pred.label === actual) correct++;
    if (pred.label === "unknown") {
      abstained++;
    } else {
      accepted++;
      if (pred.label === actual) acceptedCorrect++;
    }
  });

  const perClass = {} as Record<ReleaseClass, ClassMetrics>;
  const f1s: number[] = [];
  const unmeasured: ReleaseClass[] = [];
  CLASSES.forEach((cls, c) => {
    const tp = confusion[c]?.[c] ?? 0;
    const support = (confusion[c] ?? []).reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((acc, r) => acc + (r[c] ?? 0), 0);
    const precision = ratio(tp, predicted);
    const recall = ratio(tp, support);
    const f1 =
      precision === null || recall === null
        ? support > 0
          ? 0
          : null
        : precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall);
    perClass[cls] = { precision, recall, f1, support };
    if (support > 0 && f1 !== null) f1s.push(f1);
    if (support === 0) unmeasured.push(cls);
  });

  return {
    n: truth.length,
    accuracy: ratio(correct, truth.length),
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    perClass,
    confusion,
    abstentionRate: ratio(abstained, truth.length),
    autoAcceptPrecision: ratio(acceptedCorrect, accepted),
    autoAcceptCount: accepted,
    unmeasuredClasses: unmeasured,
    failures,
  };
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] ?? null;
}
