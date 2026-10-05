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
  `${NOT_PRECEDED_BY_ALNUM}v\\s?(\\d+(?:\\.\\d+)*)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);
// "Build 12345", "Build.12345", "build_12345"
const BUILD_VERSION = new RegExp(
  `${NOT_PRECEDED_BY_ALNUM}build[\\s._-]?(\\d+)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);
// "Update.1.05", "Update 2.1.3" -- a dotted number right after "Update" (one dot minimum, so
// "Update 2" -- the second update pack -- isn't read as version 2).
const UPDATE_VERSION = new RegExp(
  `${NOT_PRECEDED_BY_ALNUM}update[\\s._-]v?(\\d+(?:\\.\\d+)+)${NOT_FOLLOWED_BY_ALNUM}`,
  "i"
);

/**
 * Finds a version in a release name and returns it in display form ("v1.2.3" or
 * "Build 12345"), or null when the name carries none.
 */
export function extractVersionFromReleaseName(releaseName: string): string | null {
  const v = releaseName.match(V_VERSION) ?? releaseName.match(UPDATE_VERSION);
  if (v?.[1]) return `v${v[1]}`;
  const build = releaseName.match(BUILD_VERSION);
  if (build?.[1]) return `Build ${build[1]}`;
  return null;
}

/**
 * Parses a version as typed by a user or produced by extractVersionFromReleaseName:
 * "1.2.3", "v1.2.3", "V 1.05", "Build 12345". Anything else returns null.
 */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const build = trimmed.match(/^build[\s._-]?(\d+)$/i);
  if (build?.[1]) return { kind: "build", parts: [Number(build[1])] };
  const version = trimmed.match(/^v?\s?(\d+(?:\.\d+)*)$/i);
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
