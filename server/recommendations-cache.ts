import { createHash } from "node:crypto";
import type { Game } from "../shared/schema.js";

/** How many ranked recommendations are kept per user (the route slices the requested limit). */
export const MAX_RECOMMENDATIONS = 50;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_USERS = 200;

/**
 * Fingerprint of everything the recommendations depend on in the library. When a game is added,
 * removed, hidden, rated or changes status, the signature changes and the cached list is dropped.
 */
export function recommendationLibrarySignature(
  games: Array<
    Pick<
      Game,
      | "id"
      | "igdbId"
      | "status"
      | "userRating"
      | "hidden"
      | "genres"
      | "themes"
      | "developers"
      | "gameModes"
    >
  >
): string {
  const hash = createHash("sha256");
  const rows = games
    .map((g) =>
      [
        g.id,
        g.igdbId ?? "",
        g.status,
        g.userRating ?? "",
        g.hidden ? 1 : 0,
        (g.genres ?? []).join("+"),
        (g.themes ?? []).join("+"),
        (g.developers ?? []).join("+"),
        (g.gameModes ?? []).join("+"),
      ].join("|")
    )
    .sort((a, b) => a.localeCompare(b));
  for (const row of rows) hash.update(row).update("\n");
  return hash.digest("hex");
}

interface CacheEntry {
  signature: string;
  expiresAt: number;
  value: Array<Record<string, unknown>>;
}

const cache = new Map<string, CacheEntry>();

export function clearRecommendationsCache(): void {
  cache.clear();
}

export async function getCachedRecommendations(
  userId: string,
  signature: string,
  compute: () => Promise<Array<Record<string, unknown>>>
): Promise<Array<Record<string, unknown>>> {
  const hit = cache.get(userId);
  if (hit?.signature === signature && hit.expiresAt > Date.now()) return hit.value;

  const value = await compute();
  // An empty list usually means IGDB was unreachable: do not pin it for an hour.
  if (value.length > 0) {
    cache.delete(userId);
    cache.set(userId, { signature, expiresAt: Date.now() + CACHE_TTL_MS, value });
    if (cache.size > MAX_CACHED_USERS) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return value;
}
