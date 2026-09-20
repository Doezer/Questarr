import fs from "fs-extra";
import path from "node:path";

const SENSITIVE_PATH_PREFIXES = ["/proc", "/sys", "/dev", "/run/secrets", "/etc", "/root"];

// Same prefixes as SENSITIVE_PATH_PREFIXES, as a single regex test.
const SENSITIVE_PATH_REGEX = new RegExp(
  `^(?:${SENSITIVE_PATH_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:/|$)`
);

/**
 * Returns true if the given path resolves to a sensitive system directory.
 * Resolves the path before comparing so traversal tricks like /data/../etc are caught.
 */
export function isSensitivePath(rawPath: string): boolean {
  const resolved = path.resolve(rawPath).replaceAll("\\", "/");
  return SENSITIVE_PATH_REGEX.test(resolved);
}

// Roots come from configuration, not request input, so resolving symlinks in them
// carries no taint for CodeQL's path-injection analysis; a shared helper is fine here.
async function canonicalizeRoot(resolvedRoot: string): Promise<string> {
  try {
    return await fs.realpath(resolvedRoot);
  } catch {
    return resolvedRoot;
  }
}

/**
 * Throws unless candidatePath resolves inside one of the given roots. An empty
 * roots list means no restriction is configured — callers pass [] deliberately in
 * that case (rather than skipping the call) to keep this the single place the
 * containment logic lives.
 */
export async function assertWithinRoots(
  candidatePath: string,
  roots: string[],
  errorMessage: string
): Promise<void> {
  if (roots.length === 0) return;

  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoots = roots.map((root) => path.resolve(root));

  // The realpath canonicalization and final containment check are nested directly
  // inside the branch where a root's pathname check passes, rather than recording a
  // match and continuing after the loop. CodeQL's path-injection sanitizer for the
  // path.relative(root, x) + !startsWith("..") + !isAbsolute() shape only extends its
  // "x is safe here" guarantee to code it can prove is dominated by that guarded
  // branch; code reached after breaking out of a loop doesn't qualify, so fs.realpath
  // needs to sit inside the same if as the check that clears it.
  for (const root of resolvedRoots) {
    const relative = path.relative(root, resolvedCandidate);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      // path.resolve() doesn't follow symlinks, so a symlink sitting inside this root
      // could still point outside it — canonicalize and check containment again to
      // catch that.
      let canonicalCandidate: string;
      try {
        canonicalCandidate = await fs.realpath(resolvedCandidate);
      } catch {
        // realpath requires the whole path (including the final component) to
        // already exist. A path that doesn't exist yet — e.g. a download still in
        // flight, being polled for existence — can't be canonicalized itself.
        // Canonicalize just the root instead (it does exist) and re-append the
        // already-checked relative segment, rather than falling back to the fully
        // lexical resolvedCandidate: that would break containment when `root` is
        // itself a symlink, since the canonical-roots check below resolves it to
        // its real target.
        const canonicalRoot = await canonicalizeRoot(root);
        canonicalCandidate = relative === "" ? canonicalRoot : path.join(canonicalRoot, relative);
      }

      const canonicalRoots = await Promise.all(resolvedRoots.map(canonicalizeRoot));
      for (const canonicalRoot of canonicalRoots) {
        const canonicalRelative = path.relative(canonicalRoot, canonicalCandidate);
        if (!canonicalRelative.startsWith("..") && !path.isAbsolute(canonicalRelative)) {
          return;
        }
      }
      throw new Error(errorMessage);
    }
  }
  throw new Error(errorMessage);
}
