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

// Resolves symlinks via realpath so a symlink sitting inside a configured root
// can't point somewhere outside it and slip past a pathname-only check. realpath
// requires the whole path (including the final component) to already exist, so a
// path that doesn't exist yet — e.g. a download still in flight, being polled for
// existence — falls back to a plain resolve(); there's nothing to canonicalize until
// it exists, and callers checking existence need that check to run regardless.
async function canonicalize(rawPath: string): Promise<string> {
  try {
    return await fs.realpath(rawPath);
  } catch {
    return path.resolve(rawPath);
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
  const resolvedCandidate = await canonicalize(candidatePath);
  const resolvedRoots = await Promise.all(roots.map(canonicalize));
  const withinAnyRoot = resolvedRoots.some((root) => {
    const relative = path.relative(root, resolvedCandidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!withinAnyRoot) {
    throw new Error(errorMessage);
  }
}
