/**
 * Release trust
 *
 * Pure derivation of one verdict ("can I grab this release safely?") from the signals Questarr
 * already has for a search result: the scoring evaluation (title match, risky file, xREL), the
 * user's preferred release groups, the blacklist and, when known, an antivirus result.
 *
 * - risky: a signal says the release is dangerous or unwanted (nuked, executable payload,
 *   blacklisted, antivirus hit). Nothing else can outweigh it.
 * - trusted: accepted, a clear title match, and positive evidence that is hard to fake.
 * - unverified: everything else, including whenever a check could not run.
 *
 * The verdict is computed from rejection codes and facts, not from the score, so a user
 * overriding a built-in rule weight cannot turn a nuked release into a trusted one.
 */

import type { ReleaseEvaluation } from "./release-scoring.js";

export type TrustLevel = "trusted" | "unverified" | "risky";
export type TrustTone = "good" | "neutral" | "bad";

export type AvResult = "clean" | "blocked" | "incomplete" | "unknown";

export interface TrustReason {
  code:
    | "xrel_verified"
    | "xrel_size_mismatch"
    | "xrel_nuked"
    | "xrel_not_found"
    | "xrel_unavailable"
    | "preferred_group"
    | "blacklisted"
    | "risky_file"
    | "non_game_media"
    | "av_clean"
    | "av_blocked"
    | "av_incomplete"
    | "title_unclear"
    | "rejected";
  tone: TrustTone;
  label: string;
  detail?: string;
}

export interface ReleaseTrust {
  level: TrustLevel;
  reasons: TrustReason[];
}

export interface TrustSignals {
  /** Size of the search result in bytes, to compare with the size xREL lists. */
  size?: number | undefined;
  /** The release group is one the user prefers (the preferred-groups format matched). */
  preferredGroup?: boolean;
  /** The release matches the user's global or per-game blacklist. */
  blacklisted?: boolean;
  /** Antivirus result, only known for something already downloaded. */
  av?: AvResult;
}

/** A listed release this far from the xREL size is not the same payload under the same name. */
export const XREL_SIZE_TOLERANCE = 0.25;

function sizeAgrees(size: number | undefined, xrelSize: number | undefined): boolean | undefined {
  if (!size || !xrelSize) return undefined;
  return Math.abs(size - xrelSize) / xrelSize <= XREL_SIZE_TOLERANCE;
}

export function deriveReleaseTrust(
  evaluation: ReleaseEvaluation,
  signals: TrustSignals = {}
): ReleaseTrust {
  const reasons: TrustReason[] = [];
  const codes = new Set(evaluation.rejections.map((rejection) => rejection.code));
  let risky = false;

  if (evaluation.xrel === "nuked") {
    risky = true;
    reasons.push({
      code: "xrel_nuked",
      tone: "bad",
      label: "Nuked on xREL",
      ...(evaluation.xrelNukeReason ? { detail: evaluation.xrelNukeReason } : {}),
    });
  }
  if (codes.has("risky_file")) {
    risky = true;
    reasons.push({ code: "risky_file", tone: "bad", label: "Executable or script payload" });
  }
  if (codes.has("non_game_media")) {
    risky = true;
    reasons.push({
      code: "non_game_media",
      tone: "bad",
      label: "Looks like video, music or a book",
    });
  }
  if (signals.blacklisted) {
    risky = true;
    reasons.push({ code: "blacklisted", tone: "bad", label: "Blacklisted" });
  }
  if (signals.av === "blocked") {
    risky = true;
    reasons.push({ code: "av_blocked", tone: "bad", label: "Antivirus flagged the download" });
  }

  const agrees = sizeAgrees(signals.size, evaluation.xrelSizeBytes);
  let xrelEvidence = false;
  if (evaluation.xrel === "verified") {
    if (agrees === false) {
      reasons.push({
        code: "xrel_size_mismatch",
        tone: "bad",
        label: "Name is on xREL but the size does not match",
      });
    } else if (agrees === true) {
      xrelEvidence = true;
      reasons.push({
        code: "xrel_verified",
        tone: "good",
        label: "Verified on xREL (size matches)",
      });
    } else {
      // a name alone proves nothing: anyone can upload a fake under a scene name
      reasons.push({
        code: "xrel_verified",
        tone: "neutral",
        label: "Name is on xREL (size not comparable)",
      });
    }
  } else if (evaluation.xrel === "not_found") {
    reasons.push({ code: "xrel_not_found", tone: "neutral", label: "Not listed on xREL" });
  } else if (evaluation.xrel === "unavailable") {
    reasons.push({
      code: "xrel_unavailable",
      tone: "neutral",
      label: "xREL could not be checked",
    });
  }

  if (signals.preferredGroup) {
    reasons.push({ code: "preferred_group", tone: "good", label: "Preferred release group" });
  }
  if (signals.av === "clean") {
    reasons.push({ code: "av_clean", tone: "good", label: "Antivirus scan clean" });
  } else if (signals.av === "incomplete") {
    reasons.push({ code: "av_incomplete", tone: "neutral", label: "Antivirus scan incomplete" });
  }

  const clearTitle = evaluation.titleMatch === "exact" || evaluation.titleMatch === "contains";
  if (!clearTitle) {
    reasons.push({ code: "title_unclear", tone: "neutral", label: "Title match is not clear" });
  }
  if (!evaluation.accepted && !risky) {
    reasons.push({ code: "rejected", tone: "bad", label: "Rejected by the scoring profile" });
  }

  let level: TrustLevel = "unverified";
  if (risky) {
    level = "risky";
  } else if (
    evaluation.accepted &&
    clearTitle &&
    signals.av !== "incomplete" &&
    (xrelEvidence ||
      (signals.preferredGroup && evaluation.xrel !== "unavailable") ||
      signals.av === "clean")
  ) {
    level = "trusted";
  }
  return { level, reasons };
}
