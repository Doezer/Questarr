/**
 * Shared contract for TypeSafe (Jev) AI release analysis, used by both the server's
 * TypeSafe client (server/typesafe.ts) and the search UI (client/src/pages/search.tsx)
 * so the two never drift apart.
 */
export const RELEASE_TYPES = [
  "full_game",
  "dlc",
  "update",
  "repack",
  "crack_only",
  "demo",
  "soundtrack",
  "other",
] as const;

export type ReleaseType = (typeof RELEASE_TYPES)[number];
