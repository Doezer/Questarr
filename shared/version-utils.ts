import { categorizeDownload, type DownloadCategory } from "./download-categorizer.js";
import type { ReleaseType } from "./typesafe-types.js";

/**
 * Game version helpers: detect a version in a release name, and compare two versions.
 *
 * Versions are free text on the game (users can type anything), so every function here is
 * conservative: when two versions can't be meaningfully compared, the answer is "unknown"
 * (null) rather than a guess, and callers treat unknown as "might be newer".
 */

export type ParsedVersionKind = "version" | "build";

export interface ParsedVersion {
  kind: ParsedVersionKind;
  parts: number[];
}

// A version token must not be glued to a preceding letter/digit ("dev1.2", "x64v2"), but `_`,
// `.`, `-`, `(`, `[` and spaces are all used as separators in release names.
const NOT_PRECEDED_BY_ALNUM = "(?<![a-z0-9])";
const NOT_FOLLOWED_BY_ALNUM = "(?![a-z0-9])";

// "v1.2.3", "v123456", "v1.0.2.34567", "v 1.05"
const V_VERSION = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}v\s?(\d+(?:\.\d+)*)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);
const V_VERSION_ALL = new RegExp(V_VERSION.source, "gi");
// "Build 12345", "Build.12345", "build_12345"
const BUILD_VERSION = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}build[\s._-]?(\d+)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);
// "Update.v2", "Update.1.05", "Patch 2.1.3" -- a version right after "Update" or "Patch". Without a "v" it
// needs a dot, so "Update 2" (the second update pack) isn't read as version 2.
const UPDATE_VERSION = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}(?:update|patch)[\s._-](?:v\s?(\d+(?:\.\d+)*)|(\d+(?:\.\d+)+))${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);
// "Update.Build.5000" -- an update whose target is a build number.
const UPDATE_BUILD_VERSION = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}(?:update|patch)[\s._-]build[\s._-]?(\d+)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);

// "v1.2-beta", "1.2.RC1", "v2.0 Preview", "v1.2.Early.Access", "v1.2.Hotfix": a qualifier whose
// ordering against the bare number ("v1.2") isn't captured by it -- a later stable release or a
// hotfix of the same number differs. Names carrying one are treated as having no readable version.
// The qualifier can also come first ("Game.Hotfix.v1.2", "Game.Early.Access.v1.2").
const QUALIFIER = String.raw`(?:alpha|beta|rc|pre|preview|dev|early[\s._-]?access|hot[\s._-]?fix|fix)`;
const QUALIFIED_VERSION = new RegExp(
  String.raw`\d[\s._-]?${QUALIFIER}(?![a-z])|(?<![a-z])${QUALIFIER}[\s._-]?v?\s?\d`,
  "i"
);
const BUILD_VERSION_ALL = new RegExp(BUILD_VERSION.source, "gi");
const UPDATE_MARKER = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}(?:update|patch)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);

/**
 * Finds a version in a release name and returns it in display form ("v1.2.3" or
 * "Build 12345"), or null when the name carries none.
 */
export function extractVersionFromReleaseName(releaseName: string): string | null {
  if (QUALIFIED_VERSION.test(releaseName)) return null;
  // An update names the version it brings the game to, so what follows "Update" wins over the
  // base version before it ("Game.v1.0.Update.v1.1"), and its highest version wins over its
  // starting one ("Game.Update.v1.0.to.v1.1").
  const update = UPDATE_VERSION.exec(releaseName);
  const updateVersion = update?.[1] ?? update?.[2];
  if (update && updateVersion) {
    return highestVVersion(releaseName.slice(update.index), `v${updateVersion}`);
  }
  // Likewise for builds: "Update.Build.1000.to.Build.1200" brings the game to Build 1200.
  const updateBuild = UPDATE_BUILD_VERSION.exec(releaseName);
  if (updateBuild) return highestBuild(releaseName.slice(updateBuild.index));
  // An update or patch with no target named carries the base game's version at most
  // ("Game.v1.2.Update"), which says nothing about where it leads; only a range does
  // ("Game.v1.0.to.v1.1.Patch", "Patch.Build.1000.to.Build.1200").
  if (UPDATE_MARKER.test(releaseName)) {
    if (countMatches(releaseName, V_VERSION_ALL) > 1) return highestVVersion(releaseName, null);
    if (countMatches(releaseName, BUILD_VERSION_ALL) > 1) return highestBuild(releaseName);
    return null;
  }
  // Otherwise the highest of the versions named, then of the builds.
  return highestVVersion(releaseName, null) ?? highestBuild(releaseName);
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function highestVVersion(text: string, initial: string | null): string | null {
  let best = initial;
  for (const match of text.matchAll(V_VERSION_ALL)) {
    const candidate = `v${match[1]}`;
    if (best === null || (compareVersions(candidate, best) ?? 0) > 0) best = candidate;
  }
  return best;
}

function highestBuild(text: string): string | null {
  let best: number | null = null;
  for (const match of text.matchAll(BUILD_VERSION_ALL)) {
    const build = Number(match[1]);
    if (best === null || build > best) best = build;
  }
  return best === null ? null : `Build ${best}`;
}

/**
 * Parses a version as typed by a user or produced by extractVersionFromReleaseName:
 * "1.2.3", "v1.2.3", "V 1.05", "Build 12345". Anything else returns null.
 */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const build = /^build[\s._-]?(\d+)$/i.exec(trimmed);
  if (build?.[1]) return { kind: "build", parts: [Number(build[1])] };
  const version = /^v?\s?(\d+(?:\.\d+)*)$/i.exec(trimmed);
  if (version?.[1]) return { kind: "version", parts: version[1].split(".").map(Number) };
  return null;
}

/**
 * Compares two versions: positive when `a` is newer, negative when older, 0 when equal, and
 * null when they can't be compared (unparseable, a build number against a dotted version, or a
 * bare number like "v20231005" against a dotted "v1.2" -- those are different numbering schemes).
 */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined
): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb || pa.kind !== pb.kind) return null;
  if (pa.kind === "version" && (pa.parts.length === 1) !== (pb.parts.length === 1)) return null;

  const length = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Whether a release may hold something newer than the version the user has installed. True
 * unless the release name carries a version that is provably equal to or older than it.
 */
export function isReleasePossiblyNewer(
  releaseName: string,
  installedVersion: string | null | undefined
): boolean {
  if (!parseVersion(installedVersion)) return true;
  const releaseVersion = extractVersionFromReleaseName(releaseName);
  if (!releaseVersion) return true;
  const cmp = compareVersions(releaseVersion, installedVersion);
  return cmp === null || cmp > 0;
}

// The categorizer files edition names ("Deluxe", "GOTY", "Complete") under DLC because those
// releases bundle DLC, but they are full games and their version is the base game's. Only these
// words mark a release that is DLC alone, once bundle mentions ("incl.DLC", "+ all DLCs") are
// set aside.
const DLC_ONLY = /\b(?:dlc|downloadable content|expansion|season pass)\b/i;
const BUNDLED_DLC = /(?:\bincl(?:uding)?|\bwith|\+)[\s._-]*(?:all[\s._-]*)?dlcs?\b/gi;

/**
 * The category to store with a download grabbed from search results: the categorizer's (title,
 * or AI classification when more confident), except that a title filed under DLC only for its
 * edition words ("Complete.Edition", "GOTY.incl.DLC") is the full game.
 */
export function inferReleaseCategory(
  downloadTitle: string,
  aiReleaseType?: ReleaseType | null,
  aiReleaseTypeConfidence?: number | null
): DownloadCategory {
  const byTitle = categorizeDownload(downloadTitle);
  const result = categorizeDownload(downloadTitle, aiReleaseType, aiReleaseTypeConfidence);
  const titleDecided =
    result.category === byTitle.category && result.confidence === byTitle.confidence;
  if (
    titleDecided &&
    result.category === "dlc" &&
    !DLC_ONLY.test(downloadTitle.replace(BUNDLED_DLC, ""))
  ) {
    return "main";
  }
  return result.category;
}

/**
 * Whether a download's version is the base game's: true for the full game (editions included)
 * and updates, false for DLC, packs and extras. `category` is the one stored with the download
 * (picked by the user, or inferred when it was grabbed); without it, the title decides.
 */
export function carriesBaseGameVersion(
  downloadTitle: string,
  category: string | null | undefined
): boolean {
  const effective = category || inferReleaseCategory(downloadTitle);
  return effective === "main" || effective === "update";
}
