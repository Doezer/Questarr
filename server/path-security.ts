import path from "node:path";

const SENSITIVE_PATH_PREFIXES = ["/proc", "/sys", "/dev", "/run/secrets", "/etc", "/root"];

// Same prefixes as SENSITIVE_PATH_PREFIXES, as a single regex test. Exported so a caller
// can run the check as one direct `.test()` call on its own resolved path — a call-site
// regex test on the tainted value, rather than a call out to isSensitivePath() below, is
// the sanitizer shape CodeQL's path-injection analysis actually recognizes as clearing
// taint (confirmed: wrapping the same check in isSensitivePath() left the alert open).
export const SENSITIVE_PATH_REGEX = new RegExp(
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
