import { logger } from "./logger.js";
import { safeFetch } from "./ssrf.js";

const nexusLogger = logger.child({ module: "nexusmods" });

const NEXUSMODS_API_BASE = "https://api.nexusmods.com/v1";
const GAMES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TRENDING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface NexusGame {
  id: number;
  name: string;
  domain_name: string;
}

export interface NexusMod {
  mod_id: number;
  name: string;
  summary: string;
  picture_url: string | null;
  mod_downloads: number;
  mod_unique_downloads: number;
  endorsement_count: number;
  version: string;
  updated_timestamp: number;
  domain_name: string;
  user: { name: string };
}

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

/** Normalize a game title for fuzzy matching. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class NexusModsClient {
  private apiKey: string | null = null;
  private gamesCache: CacheEntry<NexusGame[]> | null = null;
  private trendingCache = new Map<string, CacheEntry<NexusMod[]>>();
  private hourlyRemaining = 500;
  private dailyRemaining = 20000;

  configure(apiKey: string | null): void {
    this.apiKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
    // Bust games cache on key change so the new key is used
    this.gamesCache = null;
    this.trendingCache.clear();
  }

  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  private buildHeaders(): Record<string, string> {
    return {
      apikey: this.apiKey ?? "",
      Accept: "application/json",
    };
  }

  private trackRateLimitHeaders(headers: Headers): void {
    const hourly = headers.get("X-RL-Hourly-Remaining");
    const daily = headers.get("X-RL-Daily-Remaining");
    if (hourly !== null) this.hourlyRemaining = parseInt(hourly, 10);
    if (daily !== null) this.dailyRemaining = parseInt(daily, 10);

    if (this.hourlyRemaining < 50) {
      nexusLogger.warn(
        { hourlyRemaining: this.hourlyRemaining, dailyRemaining: this.dailyRemaining },
        "NexusMods API rate limit approaching hourly cap"
      );
    }
  }

  /** Fetch the complete list of games on NexusMods, with a 24-hour in-memory cache. */
  async getGames(): Promise<NexusGame[]> {
    const now = Date.now();
    if (this.gamesCache && now < this.gamesCache.expiry) {
      return this.gamesCache.data;
    }

    if (!this.isConfigured()) return [];

    const response = await safeFetch(`${NEXUSMODS_API_BASE}/games.json`, {
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      nexusLogger.error({ status: response.status }, "Failed to fetch NexusMods games list");
      return [];
    }

    this.trackRateLimitHeaders(response.headers);

    const games = (await response.json()) as NexusGame[];
    this.gamesCache = { data: games, expiry: now + GAMES_CACHE_TTL_MS };
    nexusLogger.info({ count: games.length }, "NexusMods games list cached");
    return games;
  }

  /**
   * Find the NexusMods domain_name for a given game title.
   * Returns null if not found or if the client is not configured.
   */
  async findGameDomain(title: string): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const games = await this.getGames();
    if (games.length === 0) return null;

    const needle = normalizeTitle(title);

    // 1. Exact normalized match
    const exact = games.find((g) => normalizeTitle(g.name) === needle);
    if (exact) return exact.domain_name;

    // 2. One contains the other (handles "Game: Subtitle" cases)
    const partial = games.find((g) => {
      const hay = normalizeTitle(g.name);
      return hay.includes(needle) || needle.includes(hay);
    });
    return partial?.domain_name ?? null;
  }

  /**
   * Fetch the top trending mods for a game domain, with a 1-hour per-domain cache.
   */
  async getTrendingMods(domain: string, limit = 10): Promise<NexusMod[]> {
    if (!this.isConfigured()) return [];

    const now = Date.now();
    const cached = this.trendingCache.get(domain);
    if (cached && now < cached.expiry) {
      return cached.data.slice(0, limit);
    }

    const response = await safeFetch(
      `${NEXUSMODS_API_BASE}/games/${encodeURIComponent(domain)}/mods/trending.json`,
      { headers: this.buildHeaders() }
    );

    if (!response.ok) {
      nexusLogger.error(
        { status: response.status, domain },
        "Failed to fetch NexusMods trending mods"
      );
      return [];
    }

    this.trackRateLimitHeaders(response.headers);

    const mods = (await response.json()) as NexusMod[];
    this.trendingCache.set(domain, { data: mods, expiry: now + TRENDING_CACHE_TTL_MS });
    return mods.slice(0, limit);
  }
}

export const nexusmodsClient = new NexusModsClient();

// Initialize from environment variable if present
const envApiKey = process.env.NEXUSMODS_API_KEY;
if (envApiKey) {
  nexusmodsClient.configure(envApiKey);
  nexusLogger.info("NexusMods API key loaded from environment variable");
}
