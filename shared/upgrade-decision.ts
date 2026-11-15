import type { DownloadCategory } from "./download-categorizer.js";
import { compareVersions, extractVersionFromReleaseName, parseVersion } from "./version-utils.js";

/**
 * Decides whether one of the releases found for an owned game is worth grabbing on its own
 * (the "auto" upgrade policy). Pure: no I/O, usable by the server and by the client to explain
 * a decision.
 *
 * A notification can afford to be optimistic ("this might be newer", isReleasePossiblyNewer);
 * a download that replaces a working install cannot. So everything here needs proof: a release
 * is only taken when its name carries a version that compares as newer than the installed one,
 * or, at the same version, when it scores better and the installed release is below the cutoff.
 * Anything unreadable or not comparable is skipped with a reason and left to the user.
 */

export interface UpgradeCandidate<T> {
  item: T;
  /** Release name. */
  title: string;
  /** Category the scorer gave the release. */
  category: DownloadCategory;
  /** Release score from evaluateRelease. */
  score: number;
}

export interface UpgradeOptions {
  /** Version of the game on disk, as stored on the game ("v1.2.3", "Build 1234"). */
  installedVersion: string | null | undefined;
  /**
   * Score of the release that is installed, when it is known (the grabbed release re-scored
   * with the current profile). Without it only version upgrades are possible.
   */
  installedScore?: number | null;
  /**
   * Once the installed release scores this much or more, it is no longer swapped for a
   * better-scored release of the same version. null turns same-version upgrades off. Newer
   * versions are not affected: the cutoff for those is "nothing newer is known".
   */
  cutoffScore?: number | null;
  /** How much better a same-version release must score to be worth the swap. Minimum 1. */
  minScoreGain?: number;
  /**
   * Take an update patch over a full release of the same version when the patch starts from
   * the installed version. Off by default: a full release needs nothing already on disk.
   */
  preferPatches?: boolean;
}

export type UpgradeSkipCode =
  /** DLC, extras and packs are content, not a newer version of the game. */
  | "not_a_game_version"
  /** The release name carries no readable version (or a qualified one: beta, hotfix...). */
  | "version_unreadable"
  /** A build number against a dotted version, or other numbering schemes that don't compare. */
  | "version_not_comparable"
  | "older_version"
  /** Same version, and no better-scored swap applies (see UpgradeNoneCode for the reason). */
  | "same_version"
  /** An update patch that doesn't say which version it starts from. */
  | "patch_base_unknown"
  /** An update patch that starts from another version than the installed one. */
  | "patch_base_mismatch";

export type UpgradeNoneCode =
  | "no_candidates"
  /** The game's installed version is missing or unreadable: nothing can be proven newer. */
  | "installed_version_unknown"
  /** Every candidate was skipped; `skipped` says why. */
  | "nothing_newer"
  /** Same-version releases exist, but the installed release already meets the cutoff. */
  | "cutoff_reached";

export interface SkippedUpgrade<T> {
  candidate: UpgradeCandidate<T>;
  code: UpgradeSkipCode;
}

export type UpgradeDecision<T> =
  | {
      action: "grab";
      /** "version": a newer version. "quality": the same version, better-scored release. */
      kind: "version" | "quality";
      candidate: UpgradeCandidate<T>;
      fromVersion: string;
      toVersion: string;
      /** True when the pick is an update patch applied over the installed version. */
      patch: boolean;
      skipped: SkippedUpgrade<T>[];
    }
  | { action: "none"; code: UpgradeNoneCode; skipped: SkippedUpgrade<T>[] };

const VERSION_TOKEN = String.raw`v?\s?(\d+(?:\.\d+)+|(?<=v\s?)\d+)`;
// "v1.0.to.v1.1", "1.0 to 1.1", "v1.0-v1.1" is not accepted (a dash also joins unrelated tags).
const VERSION_RANGE = new RegExp(
  String.raw`(?<![a-z0-9])${VERSION_TOKEN}[\s._-]+to[\s._-]+v?\s?\d`,
  "i"
);
const BUILD_RANGE = /(?<![a-z0-9])build[\s._-]?(\d+)[\s._-]+to[\s._-]+(?:build[\s._-]?)?\d/i;

/**
 * The version an update patch starts from ("Game.Update.v1.0.to.v1.1" -> "v1.0",
 * "Update.Build.1000.to.1200" -> "Build 1000"), or null when the name gives no range.
 */
export function extractPatchBaseVersion(releaseName: string): string | null {
  const range = VERSION_RANGE.exec(releaseName);
  if (range?.[1]) return `v${range[1]}`;
  const build = BUILD_RANGE.exec(releaseName);
  if (build?.[1]) return `Build ${build[1]}`;
  return null;
}

interface Ranked<T> {
  candidate: UpgradeCandidate<T>;
  version: string;
  patch: boolean;
  /** Position in the input, which the caller sorted best first. */
  order: number;
}

/** Why a candidate can't be an upgrade over `installed`, or null when it is newer or the same. */
function classify<T>(candidate: UpgradeCandidate<T>, installed: string): UpgradeSkipCode | null {
  if (candidate.category !== "main" && candidate.category !== "update") {
    return "not_a_game_version";
  }
  const version = extractVersionFromReleaseName(candidate.title);
  if (!version) return "version_unreadable";
  const cmp = compareVersions(version, installed);
  if (cmp === null) return "version_not_comparable";
  if (cmp < 0) return "older_version";
  if (candidate.category === "update") {
    // A patch over the wrong base breaks the install, so the name has to prove its base.
    const base = extractPatchBaseVersion(candidate.title);
    if (!base) return "patch_base_unknown";
    if (compareVersions(base, installed) !== 0) return "patch_base_mismatch";
    // A patch leading to the installed version brings nothing.
    if (cmp === 0) return "same_version";
  }
  return null;
}

/**
 * Picks the release to grab for an owned game, or says why none is taken.
 *
 * `candidates` are releases auto-search may take (accepted, clear title match), best first as
 * sorted by compareEvaluatedReleases. The newest provable version wins; among releases of that
 * version the first in the given order does, full releases before patches unless preferPatches.
 */
export function decideUpgrade<T>(
  candidates: readonly UpgradeCandidate<T>[],
  options: UpgradeOptions
): UpgradeDecision<T> {
  const skipped: SkippedUpgrade<T>[] = [];
  if (candidates.length === 0) return { action: "none", code: "no_candidates", skipped };

  const installed = options.installedVersion?.trim();
  if (!installed || !parseVersion(installed)) {
    return { action: "none", code: "installed_version_unknown", skipped };
  }

  const newer: Ranked<T>[] = [];
  const same: Ranked<T>[] = [];

  for (const [order, candidate] of candidates.entries()) {
    const skipCode = classify(candidate, installed);
    if (skipCode) {
      skipped.push({ candidate, code: skipCode });
      continue;
    }
    // classify() returned no skip code, so the version is readable and comparable.
    const version = extractVersionFromReleaseName(candidate.title) ?? installed;
    const entry = { candidate, version, patch: candidate.category === "update", order };
    if (compareVersions(version, installed) === 0) same.push(entry);
    else newer.push(entry);
  }

  if (newer.length > 0) {
    const preferPatches = options.preferPatches ?? false;
    const best = newer.reduce((a, b) => {
      const cmp = compareVersions(b.version, a.version) ?? 0;
      if (cmp !== 0) return cmp > 0 ? b : a;
      if (a.patch !== b.patch) return a.patch === preferPatches ? a : b;
      return a.order <= b.order ? a : b;
    });
    for (const other of same) skipped.push({ candidate: other.candidate, code: "same_version" });
    return {
      action: "grab",
      kind: "version",
      candidate: best.candidate,
      fromVersion: installed,
      toVersion: best.version,
      patch: best.patch,
      skipped,
    };
  }

  const skipSame = () => {
    for (const other of same) skipped.push({ candidate: other.candidate, code: "same_version" });
  };

  const { installedScore, cutoffScore } = options;
  if (same.length > 0 && typeof installedScore === "number" && typeof cutoffScore === "number") {
    if (installedScore >= cutoffScore) {
      skipSame();
      return { action: "none", code: "cutoff_reached", skipped };
    }
    const gain = Math.max(1, options.minScoreGain ?? 1);
    // Input order is best first, so the first one that clears the bar is the pick.
    const better = same.find((entry) => entry.candidate.score >= installedScore + gain);
    if (better) {
      for (const other of same) {
        if (other !== better) skipped.push({ candidate: other.candidate, code: "same_version" });
      }
      return {
        action: "grab",
        kind: "quality",
        candidate: better.candidate,
        fromVersion: installed,
        toVersion: better.version,
        patch: false,
        skipped,
      };
    }
  }

  skipSame();
  return { action: "none", code: "nothing_newer", skipped };
}
