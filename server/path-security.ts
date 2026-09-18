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

  // Written as plain loops with the containment check inline — not delegated to a
  // helper, and not via Array#some with an arrow callback — so the check sits
  // directly in this function's own control flow, immediately gating each
  // filesystem call below. CodeQL's path-injection sanitizer recognition is
  // intraprocedural: a guard's startsWith()/isAbsolute() checks only count as
  // sanitizing a sink when they appear in the same function scope as that sink,
  // not inside a separate callback (e.g. an arrow passed to .some()) or a
  // separate helper function, even when that helper is called immediately
  // beforehand.

  // Cheap pathname-only pass first: reject an obviously out-of-root path before ever
  // touching the filesystem to resolve symlinks for it.
  let withinResolvedRoots = false;
  for (const root of resolvedRoots) {
    const relative = path.relative(root, resolvedCandidate);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      withinResolvedRoots = true;
      break;
    }
  }
  if (!withinResolvedRoots) {
    throw new Error(errorMessage);
  }

  // The pathname passed containment, but path.resolve() doesn't follow symlinks — a
  // symlink sitting inside an allowed root could still point outside it. Canonicalize
  // and check again to catch that. realpath requires the whole path (including the
  // final component) to already exist, so a path that doesn't exist yet — e.g. a
  // download still in flight, being polled for existence — falls back to the
  // already-resolved pathname; there's nothing to canonicalize until it exists, and
  // callers checking existence need that check to run regardless.
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await fs.realpath(resolvedCandidate);
  } catch {
    canonicalCandidate = resolvedCandidate;
  }

  const canonicalRoots = await Promise.all(resolvedRoots.map(canonicalizeRoot));

  let withinCanonicalRoots = false;
  for (const root of canonicalRoots) {
    const relative = path.relative(root, canonicalCandidate);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      withinCanonicalRoots = true;
      break;
    }
  }
  if (!withinCanonicalRoots) {
    throw new Error(errorMessage);
  }
}
