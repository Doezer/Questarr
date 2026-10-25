import type { ClassificationFlag, ReleaseClass } from "../../shared/release-classification.js";

export const CLASSES: readonly ReleaseClass[] = [
  "full_game",
  "expansion",
  "patch",
  "dlc",
  "unknown",
] as const;

export interface LabeledRelease {
  releaseName: string;
  /** The game being searched for; also the leakage group for the splits. */
  gameTitle: string;
  label: ReleaseClass;
  flags: ClassificationFlag[];
  /** The label as written in the dataset, before normalization. */
  rawLabel: string;
  notes?: string;
}

export interface Prediction {
  label: ReleaseClass;
  /** Calibrated or raw probability when the classifier has one; null for rules. */
  confidence: number | null;
  latencyMs: number;
  /** Provider credits charged for this call, when the provider reports it. */
  costCredits?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  /** Set when the classifier failed; the prediction then abstains with `unknown`. */
  error?: string;
}

export interface BenchClassifier {
  id: string;
  /** Needs `train` before `classify`. Never evaluated on its own training rows. */
  trainable: boolean;
  /** True when each classify call is a paid or networked request. */
  remote: boolean;
  train?(rows: readonly LabeledRelease[]): void;
  classify(row: LabeledRelease): Promise<Prediction>;
}
