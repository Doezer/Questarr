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

function isWithinAnyRoot(resolvedCandidate: string, resolvedRoots: string[]): boolean {
  return resolvedRoots.some((root) => {
    const relative = path.relative(root, resolvedCandidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

// Resolves symlinks via realpath so a symlink sitting inside a configured root
// can't point somewhere outside it and slip past a pathname-only check. realpath
// requires the whole path (including the final component) to already exist, so a
// path that doesn't exist yet — e.g. a download still in flight, being polled for
// existence — falls back to the already-resolved pathname; there's nothing to
// canonicalize until it exists, and callers checking existence need that check to
// run regardless.
async function canonicalize(resolvedPath: string): Promise<string> {
  try {
    return await fs.realpath(resolvedPath);
  } catch {
    return resolvedPath;
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

  // Cheap pathname-only pass first: reject an obviously out-of-root path before ever
  // touching the filesystem to resolve symlinks for it.
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoots = roots.map((root) => path.resolve(root));
  if (!isWithinAnyRoot(resolvedCandidate, resolvedRoots)) {
    throw new Error(errorMessage);
  }

  // The pathname passed containment, but path.resolve() doesn't follow symlinks — a
  // symlink sitting inside an allowed root could still point outside it. Canonicalize
  // and check again to catch that.
  const canonicalCandidate = await canonicalize(resolvedCandidate);
  const canonicalRoots = await Promise.all(resolvedRoots.map(canonicalize));
  if (!isWithinAnyRoot(canonicalCandidate, canonicalRoots)) {
    throw new Error(errorMessage);
  }
}
