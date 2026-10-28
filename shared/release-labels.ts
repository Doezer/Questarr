/**
 * Labels a person can give a collected release. They are the labeling sheet's vocabulary (Jev's
 * own words included), so an exported file feeds the benchmark and the model export unchanged.
 * `scripts/release-benchmark/dataset.ts` folds them onto the ADR's classes and flags.
 */
export const CANDIDATE_LABELS = [
  "full_game",
  "patch",
  "dlc",
  "expansion",
  "update",
  "dlc_update",
  "repack",
  "crack_only",
  "demo",
  "soundtrack",
  "other",
  "unknown",
] as const;
export type CandidateLabel = (typeof CANDIDATE_LABELS)[number];

/** pending: waiting for a person. verified: a person gave the label. ambiguous / rejected: a person decided it is no example. */
export const CANDIDATE_STATUSES = ["pending", "verified", "ambiguous", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_REASONS = [
  "unresolved",
  "low_confidence",
  "disagreement",
  "model_disagreement",
] as const;
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];

/**
 * Classes that mean the same thing for a reviewer: an expansion is a DLC, an update is a patch and
 * a repack is a full game with a packaging flag (as `cloud.ts` and the benchmark fold them).
 */
const SAME_CLASS: Record<string, string> = {
  expansion: "dlc",
  update: "patch",
  dlc_update: "patch",
  repack: "full_game",
};

/** True when two answers name different classes. "unknown" says nothing, so it never conflicts. */
export function classesConflict(a: string, b: string): boolean {
  if (a === "unknown" || b === "unknown") return false;
  return (SAME_CLASS[a] ?? a) !== (SAME_CLASS[b] ?? b);
}

/** What each layer said when the release was collected. Shown to the reviewer, never trusted. */
export interface CandidateSignals {
  /** Deterministic rules: derived from the name, not probabilistic. */
  rules: { class: string; flags: string[]; ruleIds: string[] };
  /** The local model's best guess, even when it abstained. Null when no model is installed. */
  local: { class: string; confidence: number; modelVersion: string } | null;
  /** What the pipeline finally returned, and which layer it came from. */
  final: { class: string; confidence: number | null; source: string; flags: string[] };
}
