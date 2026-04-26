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
