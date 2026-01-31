import { titleMatches } from "../shared/title-utils.js";

/**
 * xREL.to API client (no official Node SDK).
 * API docs: https://www.xrel.to/wiki/1681/API.html
 * Rate limits: 900 calls/hour; search methods: 2 calls per 5 seconds.
 * Base URL is passed per call (from app settings or env); default https://api.xrel.to
 */

export const DEFAULT_XREL_BASE = "https://xrel-api.nfos.to";
const GAME_TYPE = "master_game";

export const ALLOWED_XREL_DOMAINS = ["api.xrel.to", "xrel-api.nfos.to"];

function resolveBaseUrl(baseUrl?: string | null): string {
  const v = (baseUrl ?? process.env.XREL_API_BASE ?? "").trim();
  const url = v || DEFAULT_XREL_BASE;

  try {
    const parsed = new URL(url);
    if (!ALLOWED_XREL_DOMAINS.includes(parsed.hostname)) {
      // If the domain isn't in the allowed list, fallback to default for safety
      return DEFAULT_XREL_BASE;
    }
    return url;
  } catch {
    return DEFAULT_XREL_BASE;
  }
}

// Rate limiting: 900/hour; search: 2 per 5 seconds
let lastSearchTime = 0;
const SEARCH_MIN_INTERVAL_MS = 2500; // 2.5s between search calls to stay under 2/5s
const HOURLY_LIMIT = 900;
let hourlyCount = 0;
let hourStart = Date.now();

function waitSearchInterval(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastSearchTime;
  if (elapsed >= SEARCH_MIN_INTERVAL_MS || lastSearchTime === 0) {
    lastSearchTime = now;
    return Promise.resolve();
  }
  const wait = SEARCH_MIN_INTERVAL_MS - elapsed;
  return new Promise((r) => setTimeout(r, wait));
}

function checkHourlyLimit(): void {
  const now = Date.now();
  if (now - hourStart >= 60 * 60 * 1000) {
    hourStart = now;
    hourlyCount = 0;
  }
  if (hourlyCount >= HOURLY_LIMIT) {
    throw new Error("xREL API hourly rate limit exceeded (900/hour)");
  }
  hourlyCount++;
}

export interface XrelExtInfo {
  type: string;
  id: string;
  title: string;
  link_href: string;
  rating?: number;
  num_ratings?: number;
}

export interface XrelSceneRelease {
  id: string;
  dirname: string;
  link_href: string;
  time: number;
  group_name: string;
  size?: { number: number; unit: string };
  num_ratings?: number;
  ext_info?: XrelExtInfo;
  comments?: number;
  flags?: Record<string, boolean>;
  video_type?: string;
  audio_type?: string;
  tv_season?: number;
  tv_episode?: number;
}

export interface XrelP2pRelease {
  id: string;
  dirname: string;
  link_href: string;
  pub_time: number;
  size_mb?: number;
  group?: { id: string; name: string };
  num_ratings?: number;
  ext_info?: XrelExtInfo;
  comments?: number;
  main_lang?: string;
}

export interface XrelReleaseListItem {
  id: string;
  dirname: string;
  link_href: string;
  time: number;
  group_name: string;
  sizeMb?: number;
  sizeUnit?: string;
  ext_info?: XrelExtInfo;
  source: "scene" | "p2p";
}

export interface XrelSearchResponse {
  total?: number;
  results?: XrelSceneRelease[];
  p2p_results?: XrelP2pRelease[];
}

export interface XrelLatestResponse {
  total_count: number;
  pagination: { current_page: number; per_page: number; total_pages: number };
  list: XrelSceneRelease[];
}

function isGameRelease(extInfo: XrelExtInfo | undefined): boolean {
  return extInfo?.type === GAME_TYPE;
}

/**
 * Normalize and merge scene + p2p results into a single list of game releases.
 */
function mergeAndFilterGameReleases(
  scene: XrelSceneRelease[] = [],
  p2p: XrelP2pRelease[] = []
): XrelReleaseListItem[] {
  const out: XrelReleaseListItem[] = [];
  for (const r of scene) {
    if (!isGameRelease(r.ext_info)) continue;
    out.push({
      id: r.id,
      dirname: r.dirname,
      link_href: r.link_href,
      time: r.time,
      group_name: r.group_name,
      sizeMb: r.size?.number,
      sizeUnit: r.size?.unit,
      ext_info: r.ext_info,
      source: "scene",
    });
  }
  for (const r of p2p) {
    if (!isGameRelease(r.ext_info)) continue;
    out.push({
      id: r.id,
      dirname: r.dirname,
      link_href: r.link_href,
      time: r.pub_time,
      group_name: r.group?.name ?? "",
      sizeMb: r.size_mb,
      sizeUnit: "MB",
      ext_info: r.ext_info,
      source: "p2p",
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

/**
 * Search releases. Obeys search rate limit (2 per 5 seconds).
 * Returns only game-type releases (master_game).
 */
export async function searchReleases(
  query: string,
  options: { scene?: boolean; p2p?: boolean; limit?: number; baseUrl?: string | null } = {}
): Promise<XrelReleaseListItem[]> {
  const scene = options.scene !== false;
  const p2p = options.p2p === true;
  const limit = Math.min(Math.max(1, options.limit ?? 25), 100);
  const base = resolveBaseUrl(options.baseUrl);

  await waitSearchInterval();
  checkHourlyLimit();

  const params = new URLSearchParams({
    q: query.trim(),
    scene: scene ? "1" : "0",
    p2p: p2p ? "1" : "0",
    limit: String(limit),
  });
  const url = `${base}/v2/search/releases.json?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Questarr/1.1.0",
    },
  });

  if (res.status === 429) {
    throw new Error("xREL API rate limit exceeded (Too Many Requests)");
  }
  if (!res.ok) {
    throw new Error(`xREL API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as XrelSearchResponse;
  const results = data.results ?? [];
  const p2pResults = data.p2p_results ?? [];
  return mergeAndFilterGameReleases(results, p2pResults);
}

/**
 * Fetch latest releases (all types). Filter client-side for games if needed.
 * Rate limit: general 900/hour only.
 */
export async function getLatestReleases(
  options: {
    page?: number;
    perPage?: number;
    baseUrl?: string | null;
    extInfoType?: string;
  } = {}
): Promise<{
  list: XrelReleaseListItem[];
  pagination: XrelLatestResponse["pagination"];
  total_count: number;
}> {
  checkHourlyLimit();

  const base = resolveBaseUrl(options.baseUrl);
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 50));
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (options.extInfoType) {
    params.append("ext_info_type", options.extInfoType);
  }
  const url = `${base}/v2/release/latest.json?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Questarr/1.1.0",
    },
  });

  if (res.status === 429) {
    throw new Error("xREL API rate limit exceeded (Too Many Requests)");
  }
  if (!res.ok) {
    throw new Error(`xREL API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as XrelLatestResponse;
  const gameOnly = (data.list ?? []).filter((r) => isGameRelease(r.ext_info));
  const list: XrelReleaseListItem[] = gameOnly.map((r) => ({
    id: r.id,
    dirname: r.dirname,
    link_href: r.link_href,
    time: r.time,
    group_name: r.group_name,
    sizeMb: r.size?.number,
    sizeUnit: r.size?.unit,
    ext_info: r.ext_info,
    source: "scene",
  }));

  return {
    list,
    pagination: data.pagination,
    total_count: data.total_count ?? 0,
  };
}

/**
 * Fetch exactly (if possible) N game releases by scanning multiple API pages.
 */
export async function getLatestGames(
  options: {
    page?: number;
    perPage?: number;
    baseUrl?: string | null;
  } = {}
): Promise<{
  list: XrelReleaseListItem[];
  pagination: { current_page: number; per_page: number; total_pages: number };
  total_count: number;
}> {
  const targetPage = Math.max(1, options.page ?? 1);
  const perPage = Math.max(1, options.perPage ?? 20);
  const targetOffset = (targetPage - 1) * perPage;
  const targetLimit = targetOffset + perPage;

  const allGames: XrelReleaseListItem[] = [];
  let apiPage = 1;
  let totalApiPages = 1;

  // Fetch up to 5 pages of 100 items to find enough games
  // This helps populate the requested page of games regardless of release density
  while (allGames.length < targetLimit && apiPage <= 10 && apiPage <= totalApiPages) {
    const result = await getLatestReleases({
      page: apiPage,
      perPage: 100,
      baseUrl: options.baseUrl,
    });

    allGames.push(...result.list);
    totalApiPages = result.pagination.total_pages;
    // totalCountEstimate = result.total_count; // This is total releases, not total games
    apiPage++;

    // If we're finding very few games, don't loop forever
    if (apiPage > 5 && allGames.length === 0) break;
  }

  const list = allGames.slice(targetOffset, targetLimit);

  return {
    list,
    pagination: {
      current_page: targetPage,
      per_page: perPage,
      total_pages: Math.ceil(allGames.length / perPage) + (apiPage <= totalApiPages ? 1 : 0),
    },
    total_count: allGames.length,
  };
}

export const xrelClient = {
  searchReleases,
  getLatestReleases,
  getLatestGames,
  titleMatches,
};
