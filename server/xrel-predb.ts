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

const cache = new Map<string, { at: number; lookup: Promise<XrelPredbEntry[] | undefined> }>();

async function fetchPredb(gameTitle: string): Promise<XrelPredbEntry[] | undefined> {
  const baseUrl = (await storage.getSystemConfig("xrel_api_base"))?.trim() || null;
  const releases = await xrelClient.searchReleases(gameTitle, {
    scene: true,
    p2p: true,
    limit: LOOKUP_LIMIT,
    baseUrl,
  });
  return releases.map((release) => ({
    dirname: release.dirname,
    ...(release.nukeReason !== undefined ? { nukeReason: release.nukeReason } : {}),
  }));
}

export async function getXrelPredb(gameTitle: string): Promise<XrelPredbEntry[] | undefined> {
  const key = normalizeTitle(gameTitle);
  if (!key) return undefined;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.lookup;

  const lookup = fetchPredb(gameTitle).catch((error: unknown) => {
    cache.delete(key);
    logger.warn({ error, gameTitle }, "xREL PreDB lookup failed, scoring without it");
    return undefined;
  });
  cache.set(key, { at: Date.now(), lookup });
  return lookup;
}

/** True when the user has any xREL feature on, which also allows the PreDB check. */
export function xrelEnabledFor(
  settings: { xrelSceneReleases?: boolean | null; xrelP2pReleases?: boolean | null } | undefined
): boolean {
  return settings?.xrelSceneReleases === true || settings?.xrelP2pReleases === true;
}

export function clearXrelPredbCache(): void {
  cache.clear();
}
