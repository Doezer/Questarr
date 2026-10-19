import { storage } from "./storage.js";
import { xrelClient } from "./xrel.js";
import { logger } from "./logger.js";
import { normalizeTitle } from "../shared/title-utils.js";
import type { XrelPredbEntry } from "../shared/release-scoring.js";

/**
 * xREL PreDB lookup for release scoring (Questarr-mgmt #17 and #2). Based on the xREL boost in
 * the Jessomadic/Questarr fork (commits f90f6ff7 and 7a61aaff).
 *
 * The lookup is cached in memory per game title for 10 minutes. The promise itself is cached,
 * so parallel searches for the same title share one xREL call. A failed lookup resolves to
 * undefined (scoring then runs without xREL) and is not cached.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const LOOKUP_LIMIT = 100;
// manual searches key the cache by whatever the user typed, so it is bounded
const MAX_CACHE_ENTRIES = 200;
// Last completed results, kept much longer than the cache so a slow lookup in a later scheduled
// cycle can still fall back on them (auto-search runs hours apart, the cache lives 10 minutes).
const STALE_RETENTION_MS = 24 * 60 * 60 * 1000;

// how long an interactive caller waits for xREL; the lookup keeps running and fills the cache
export const INTERACTIVE_LOOKUP_TIMEOUT_MS = 3000;

export interface XrelPredbTypes {
  scene: boolean;
  p2p: boolean;
}

const cache = new Map<string, { at: number; lookup: Promise<XrelPredbEntry[] | undefined> }>();
const staleResults = new Map<string, { at: number; value: XrelPredbEntry[] }>();

async function fetchPredb(
  gameTitle: string,
  types: XrelPredbTypes
): Promise<XrelPredbEntry[] | undefined> {
  const baseUrl = (await storage.getSystemConfig("xrel_api_base"))?.trim() || null;
  const releases = await xrelClient.searchReleases(gameTitle, {
    scene: types.scene,
    p2p: types.p2p,
    limit: LOOKUP_LIMIT,
    baseUrl,
  });
  return releases.map((release) => ({
    dirname: release.dirname,
    ...(release.nukeReason !== undefined ? { nukeReason: release.nukeReason } : {}),
  }));
}

/**
 * Looks up the PreDB entries for a title, limited to the release types the user enabled.
 * With `timeoutMs`, a slow lookup resolves to undefined for this caller only: it keeps running
 * and its result is cached for the next one.
 */
export async function getXrelPredb(
  gameTitle: string,
  types: XrelPredbTypes = { scene: true, p2p: true },
  options: { timeoutMs?: number; onUnavailable?: () => void; staleFallback?: boolean } = {}
): Promise<XrelPredbEntry[] | undefined> {
  if (!types.scene && !types.p2p) return undefined;
  const title = normalizeTitle(gameTitle);
  if (!title) return undefined;
  const key = `${types.scene ? "s" : ""}${types.p2p ? "p" : ""}:${title}`;
  const lookup = cachedLookup(gameTitle, key, types);
  const { timeoutMs } = options;
  if (timeoutMs === undefined) return lookup;

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      logger.warn({ gameTitle, timeoutMs }, "xREL PreDB lookup is slow, scoring without it");
      resolve(undefined);
    }, timeoutMs);
  });
  let result: XrelPredbEntry[] | undefined;
  try {
    result = await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (result !== undefined) return result;

  // slow or failed: callers that cannot proceed blind get the last completed result, or are
  // told the lookup is unavailable
  const stale = options.staleFallback ? staleResults.get(key) : undefined;
  if (stale && Date.now() - stale.at < STALE_RETENTION_MS) return stale.value;
  options.onUnavailable?.();
  return undefined;
}

function rememberResult(key: string, value: XrelPredbEntry[]): void {
  const now = Date.now();
  staleResults.delete(key);
  for (const [entryKey, entry] of staleResults) {
    if (now - entry.at >= STALE_RETENTION_MS) staleResults.delete(entryKey);
  }
  while (staleResults.size >= MAX_CACHE_ENTRIES) {
    const oldest = staleResults.keys().next().value;
    if (oldest === undefined) break;
    staleResults.delete(oldest);
  }
  staleResults.set(key, { at: now, value });
}

function cachedLookup(
  gameTitle: string,
  key: string,
  types: XrelPredbTypes
): Promise<XrelPredbEntry[] | undefined> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.lookup;

  const lookup = fetchPredb(gameTitle, types)
    .then((value) => {
      if (value) rememberResult(key, value);
      return value;
    })
    .catch((error: unknown) => {
      cache.delete(key);
      logger.warn({ error, gameTitle }, "xREL PreDB lookup failed, scoring without it");
      return undefined;
    });
  const now = Date.now();
  for (const [entryKey, entry] of cache) {
    if (now - entry.at >= CACHE_TTL_MS) cache.delete(entryKey);
  }
  // Map keeps insertion order, so the oldest entries go first
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { at: now, lookup });
  return lookup;
}

/** The release types the user follows on xREL, which also limit the PreDB check. */
export function xrelTypesFor(
  settings: { xrelSceneReleases?: boolean | null; xrelP2pReleases?: boolean | null } | undefined
): XrelPredbTypes {
  return { scene: settings?.xrelSceneReleases === true, p2p: settings?.xrelP2pReleases === true };
}

/** True when the user has any xREL feature on, which also allows the PreDB check. */
export function xrelEnabledFor(
  settings: { xrelSceneReleases?: boolean | null; xrelP2pReleases?: boolean | null } | undefined
): boolean {
  return settings?.xrelSceneReleases === true || settings?.xrelP2pReleases === true;
}

export function clearXrelPredbCache(): void {
  cache.clear();
  staleResults.clear();
}
