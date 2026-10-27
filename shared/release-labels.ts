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

export const CANDIDATE_REASONS = ["unresolved", "low_confidence", "disagreement"] as const;
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];

/** What each layer said when the release was collected. Shown to the reviewer, never trusted. */
export interface CandidateSignals {
  /** Deterministic rules: derived from the name, not probabilistic. */
  rules: { class: string; flags: string[]; ruleIds: string[] };
  /** The local model's best guess, even when it abstained. Null when no model is installed. */
  local: { class: string; confidence: number; modelVersion: string } | null;
  /** What the pipeline finally returned, and which layer it came from. */
  final: { class: string; confidence: number | null; source: string; flags: string[] };
}
