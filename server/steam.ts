import { igdbLogger } from "./logger.js";

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

export const steamService = {
  validateSteamId(id: string): boolean {
    return /^7656\d{13}$/.test(id);
  },

  async getWishlist(steamId: string): Promise<SteamWishlistGame[]> {
    if (!this.validateSteamId(steamId)) {
      throw new Error("Invalid Steam ID format");
    }

    const url = STEAM_WISHLIST_API_URL(steamId);

    igdbLogger.debug({ steamId }, "Fetching Steam wishlist via IWishlistService");

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Steam API error: ${response.status}`);
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
