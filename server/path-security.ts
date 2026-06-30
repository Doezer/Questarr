import path from "node:path";

const SENSITIVE_PATH_PREFIXES = ["/proc", "/sys", "/dev", "/run/secrets", "/etc", "/root"];

/**
 * Returns true if the given path resolves to a sensitive system directory.
 * Resolves the path before comparing so traversal tricks like /data/../etc are caught.
 */
export function isSensitivePath(rawPath: string): boolean {
  const resolved = path.resolve(rawPath).replaceAll("\\", "/");
  return SENSITIVE_PATH_PREFIXES.some(
    (prefix) => resolved === prefix || resolved.startsWith(prefix + "/")
  );
}
