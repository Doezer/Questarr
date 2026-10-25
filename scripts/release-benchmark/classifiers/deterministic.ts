import { classifyReleaseByRules } from "../../../shared/release-classification.js";
import type { BenchClassifier } from "../types.js";

/** The production rule classifier (ADR-001 task 2), given the game title as context. */
export function deterministicClassifier(): BenchClassifier {
  return {
    id: "deterministic",
    trainable: false,
    remote: false,
    async classify(row) {
      const started = performance.now();
      const result = classifyReleaseByRules({ title: row.releaseName, gameTitle: row.gameTitle });
      return {
        label: result.class,
        confidence: result.confidence,
        latencyMs: performance.now() - started,
      };
    },
  };
}
