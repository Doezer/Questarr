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
// "Update.v2", "Update.1.05", "Update 2.1.3" -- a version right after "Update". Without a "v" it
// needs a dot, so "Update 2" (the second update pack) isn't read as version 2.
const UPDATE_VERSION = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}update[\s._-](?:v\s?(\d+(?:\.\d+)*)|(\d+(?:\.\d+)+))${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);
// "Update.Build.5000" -- an update whose target is a build number.
const UPDATE_BUILD_VERSION = new RegExp(
  String.raw`${NOT_PRECEDED_BY_ALNUM}update[\s._-]build[\s._-]?(\d+)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);

// "v1.2-beta", "1.2.RC1", "v2.0 Preview", "v1.2.Early.Access", "v1.2.Hotfix": a qualifier whose
// ordering against the bare number ("v1.2") isn't captured by it -- a later stable release or a
// hotfix of the same number differs. Names carrying one are treated as having no readable version.
const QUALIFIED_VERSION =
  /\d[\s._-]?(?:alpha|beta|rc|pre|preview|dev|early[\s._-]?access|hot[\s._-]?fix|fix)(?![a-z])/i;
const BUILD_VERSION_ALL = new RegExp(BUILD_VERSION.source, "gi");

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
  // Otherwise the highest of the versions named ("Game.v1.0.to.v1.1" brings the game to v1.1).
  const best = highestVVersion(releaseName, null);
  if (best) return best;
  // A build range ("Patch.Build.1000.to.Build.1200") brings the game to its highest build.
  return highestBuild(releaseName);
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
