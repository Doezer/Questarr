/**
 * Configuration endpoints that also accept an integration API key with the
 * `admin` scope, so deployment automation (Wranglarr, Ansible, ...) can set
 * Questarr up without the interactive login flow.
 *
 * This is an explicit allowlist: a route that is not listed here stays
 * JWT-only. Key management (/api-keys) is intentionally absent so a leaked key
 * can never mint or revoke another key. Paths are relative to the "/api" mount.
 */
const ID = "[^/]+";

const ADMIN_API_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ["GET", /^\/downloaders$/],
  ["POST", /^\/downloaders$/],
  ["PATCH", new RegExp(`^/downloaders/${ID}$`)],
  ["DELETE", new RegExp(`^/downloaders/${ID}$`)],
  ["POST", new RegExp(`^/downloaders/${ID}/test$`)],
  ["GET", /^\/indexers$/],
  ["GET", /^\/indexers\/prowlarr\/settings$/],
  ["POST", /^\/indexers\/prowlarr\/sync$/],
  ["POST", new RegExp(`^/indexers/${ID}/test$`)],
  ["GET", /^\/settings$/],
  ["PATCH", /^\/settings$/],
  ["GET", /^\/settings\/apprise$/],
  ["POST", /^\/settings\/apprise$/],
  ["POST", /^\/settings\/apprise\/test$/],
  ["GET", /^\/imports\/config$/],
  ["PATCH", /^\/imports\/config$/],
  ["GET", /^\/imports\/mappings\/paths$/],
  ["POST", /^\/imports\/mappings\/paths$/],
  ["PATCH", new RegExp(`^/imports/mappings/paths/${ID}$`)],
  ["DELETE", new RegExp(`^/imports/mappings/paths/${ID}$`)],
  ["GET", /^\/imports\/hardlink\/check$/],
];

/** True when `method path` (path relative to /api) may be called with an `admin` key. */
export function isAdminApiRoute(method: string, path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const upper = method.toUpperCase();
  return ADMIN_API_ROUTES.some(([m, re]) => m === upper && re.test(normalized));
}
