import { igdbLogger } from "./logger.js";
import { safeFetch } from "./ssrf.js";

/**
 * Response shape from the official IWishlistService/GetWishlist/v1 endpoint.
 * Each item contains the Steam App ID, priority, and the unix timestamp when
 * the user added it to their wishlist.
 */
interface SteamWishlistApiItem {
  appid: number;
  priority: number;
  date_added: number;
}

interface SteamWishlistApiResponse {
  response: {
    items: SteamWishlistApiItem[];
  };
}

export interface SteamWishlistGame {
  steamAppId: number;
  title: string;
  addedAt: number;
  priority: number;
}

/**
 * Official Steam Web API endpoint for wishlists.
 *
 * This endpoint does NOT require an API key for public profiles.
 */
const STEAM_WISHLIST_API_URL = (steamId: string) =>
  `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`;

function getSteamApiErrorMessage(status: number): string {
  switch (status) {
    case 403:
      return (
        "Steam API error: 403 Forbidden - your Steam profile or wishlist is private. " +
        "Please set your Steam profile and wishlist visibility to public and try again."
      );
    case 404:
      return (
        "Steam API error: 404 Not Found - the specified Steam ID does not exist or the " +
        "wishlist could not be found."
      );
    case 429:
      return (
        "Steam API error: 429 Too Many Requests - Steam is rate limiting requests. " +
        "Please wait a few minutes and try again."
      );
    default:
      return `Steam API error: ${status}`;
  }
}

/** A single achievement's static definition from GetSchemaForGame. */
interface SteamAchievementSchemaEntry {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: 0 | 1;
}

interface SteamSchemaResponse {
  game?: {
    gameName?: string;
    availableGameStats?: {
      achievements?: SteamAchievementSchemaEntry[];
    };
  };
}

interface SteamPlayerAchievementEntry {
  apiname: string;
  achieved: 0 | 1;
  unlocktime: number;
}

interface SteamPlayerAchievementsResponse {
  playerstats?: {
    success: boolean;
    error?: string;
    achievements?: SteamPlayerAchievementEntry[];
  };
}

interface SteamGlobalPercentagesResponse {
  achievementpercentages?: {
    achievements?: { name: string; percent: number }[];
  };
}

export interface SteamAchievement {
  apiName: string;
  displayName: string;
  description: string | null;
  icon: string;
  iconGray: string;
  hidden: boolean;
  achieved: boolean;
  unlockedAt: number | null;
  /** Percentage of players who have unlocked this, when available (public, no key needed). */
  globalPercent: number | null;
}

// Global achievement percentages change slowly; cache per app to avoid
// re-fetching them on every Playing-page load.
const GLOBAL_PERCENT_TTL_MS = 60 * 60 * 1000; // 1 hour
const globalPercentCache = new Map<number, { data: Map<string, number>; expiry: number }>();

async function fetchGlobalAchievementPercentages(appId: number): Promise<Map<string, number>> {
  const cached = globalPercentCache.get(appId);
  if (cached && Date.now() < cached.expiry) return cached.data;

  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}&format=json`;
  const response = await safeFetch(url);
  if (!response.ok) {
    // Not every app has published achievements (or any at all) — treat as empty rather than an error.
    return new Map();
  }
  const data = (await response.json()) as SteamGlobalPercentagesResponse;
  const percentages = new Map<string, number>();
  for (const entry of data.achievementpercentages?.achievements ?? []) {
    percentages.set(entry.name, entry.percent);
  }
  globalPercentCache.set(appId, { data: percentages, expiry: Date.now() + GLOBAL_PERCENT_TTL_MS });
  return percentages;
}

export const steamService = {
  validateSteamId(id: string): boolean {
    return /^7656\d{13}$/.test(id);
  },

  /**
   * Fetches a user's achievements for a game, merged with their display
   * metadata (name/description/icon) and global unlock percentages.
   * Requires a Steam Web API key; the caller is responsible for gating this
   * behind `config.steam.isConfigured`.
   */
  async getPlayerAchievements(
    apiKey: string,
    steamId: string,
    appId: number
  ): Promise<SteamAchievement[]> {
    if (!this.validateSteamId(steamId)) {
      throw new Error("Invalid Steam ID format");
    }

    const schemaUrl = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}`;
    const achievementsUrl = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${apiKey}&steamid=${steamId}`;

    const [schemaResponse, achievementsResponse, globalPercentages] = await Promise.all([
      safeFetch(schemaUrl, { requireHttps: true }),
      safeFetch(achievementsUrl, { requireHttps: true }),
      fetchGlobalAchievementPercentages(appId),
    ]);

    // Steam returns a non-2xx status (with a { playerstats: { success: false } } body)
    // for a private profile or an app with no stats -- parse the body before deciding
    // whether that's an error or just an empty result, so those common cases don't
    // get logged as a 500 on every Journal tab open.
    const achievementsData = (await achievementsResponse
      .json()
      .catch(() => ({}))) as SteamPlayerAchievementsResponse;
    if (!achievementsResponse.ok && achievementsData.playerstats?.success !== false) {
      throw new Error(`Steam API error: ${achievementsResponse.status}`);
    }
    if (!achievementsData.playerstats?.success) {
      // No achievements schema for this app, or a private profile — surface as empty
      // rather than an error so the UI can just hide the section.
      igdbLogger.info(
        { steamId, appId, error: achievementsData.playerstats?.error },
        "Steam player achievements unavailable"
      );
      return [];
    }

    const schemaData: SteamSchemaResponse = schemaResponse.ok
      ? ((await schemaResponse.json()) as SteamSchemaResponse)
      : {};
    const schemaByName = new Map(
      (schemaData.game?.availableGameStats?.achievements ?? []).map((entry) => [entry.name, entry])
    );

    return (achievementsData.playerstats.achievements ?? []).map((entry) => {
      const schema = schemaByName.get(entry.apiname);
      return {
        apiName: entry.apiname,
        displayName: schema?.displayName ?? entry.apiname,
        description: schema?.description ?? null,
        icon: schema?.icon ?? "",
        iconGray: schema?.icongray ?? "",
        hidden: schema?.hidden === 1,
        achieved: entry.achieved === 1,
        unlockedAt: entry.achieved === 1 && entry.unlocktime > 0 ? entry.unlocktime * 1000 : null,
        globalPercent: globalPercentages.get(entry.apiname) ?? null,
      };
    });
  },

  async getWishlist(steamId: string): Promise<SteamWishlistGame[]> {
    if (!this.validateSteamId(steamId)) {
      throw new Error("Invalid Steam ID format");
    }

    const url = STEAM_WISHLIST_API_URL(steamId);

    igdbLogger.debug({ steamId }, "Fetching Steam wishlist via IWishlistService");

    try {
      const response = await safeFetch(url);

      if (!response.ok) {
        throw new Error(getSteamApiErrorMessage(response.status));
      }

      const data = (await response.json()) as SteamWishlistApiResponse;

      if (!data.response || !data.response.items) {
        // Empty wishlist or inaccessible profile (Steam returns empty response object)
        igdbLogger.info({ steamId }, "Steam wishlist is empty or inaccessible");
        return [];
      }

      const games: SteamWishlistGame[] = data.response.items.map((item) => ({
        steamAppId: item.appid,
        // The new API does not return game names — IGDB lookup handles that downstream
        title: `Steam App ${item.appid}`,
        addedAt: item.date_added,
        priority: item.priority,
      }));

      igdbLogger.info({ steamId, count: games.length }, "Fetched Steam wishlist");
      return games;
    } catch (error) {
      igdbLogger.error({ steamId, error }, "Failed to fetch Steam wishlist");
      throw error;
    }
  },
};
