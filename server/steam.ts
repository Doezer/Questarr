import { igdbLogger } from "./logger.js";

interface SteamWishlistItem {
  name: string;
  capsule: string;
  review_score: number;
  review_desc: string;
  reviews_total: string;
  reviews_percent: number;
  release_date: number | string;
  release_string: string;
  platform_icons: string;
  subs: {
    id: number;
    discount_block: string;
    discount_pct: number;
    price: string;
  }[];
  type: string;
  screenshots: string[];
  review_css: string;
  priority: number;
  added: number;
  background: string;
  rank: number;
  tags: string[];
  is_free_game: boolean;
  win: number;
  mac: number;
  linux: number;
}

export interface SteamWishlistGame {
  steamAppId: number;
  title: string;
  addedAt: number;
  priority: number;
}

const STEAM_WISHLIST_URL = (steamId: string, page: number) =>
  `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${page}`;

export const steamService = {
  validateSteamId(id: string): boolean {
    return /^7656\d{13}$/.test(id);
  },

  async getWishlist(steamId: string): Promise<SteamWishlistGame[]> {
    if (!this.validateSteamId(steamId)) {
      throw new Error("Invalid Steam ID format");
    }

    const allGames: SteamWishlistGame[] = [];
    let page = 0;
    let hasMore = true;

    // Safety limit to prevent infinite loops (e.g. 50 pages * ~100 items = ~5000 games)
    const MAX_PAGES = 50;

    while (hasMore && page < MAX_PAGES) {
      const url = STEAM_WISHLIST_URL(steamId, page);
      igdbLogger.debug({ steamId, page }, "Fetching Steam wishlist page");

      try {
        const response = await fetch(url);
        
        if (response.status === 403 || response.status === 500) {
            // 403 usually means private profile
             throw new Error("Steam profile is private or inaccessible");
        }
        
        if (!response.ok) {
           throw new Error(`Steam API error: ${response.status}`);
        }

        const data = await response.json();

        // Steam returns an object with appids as keys if it has data, or empty array/object if empty
        // Or sometimes it returns an array? format is slightly weird:
        // Key is string (appid), value is object.
        
        if (!data || (Array.isArray(data) && data.length === 0)) {
            hasMore = false;
            break;
        }
        
        const keys = Object.keys(data);
        if (keys.length === 0) {
            hasMore = false;
            break;
        }

        const pageGames: SteamWishlistGame[] = keys.map(key => {
            const item = data[key] as SteamWishlistItem;
            return {
                steamAppId: parseInt(key, 10),
                title: item.name,
                addedAt: item.added,
                priority: item.priority
            };
        });

        allGames.push(...pageGames);
        
        // Steam wishlistdata endpoint returns ~100 items per page? 
        // Logic: if we got NO items, stop. If we got items, try next page.
        // Actually, if we get a JSON object, it might be the whole list if not using ?p= ? 
        // Documentation says it is paginated.
        // If the object returned is empty, we stop.
        
        page++;
        
        // Basic throttle
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        igdbLogger.error({ steamId, error }, "Failed to fetch Steam wishlist page");
        throw error;
      }
    }

    igdbLogger.info({ steamId, count: allGames.length }, "Fetched Steam wishlist");
    return allGames;
  }
};
