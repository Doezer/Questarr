import { config } from "./config.js";
import { igdbLogger } from "./logger.js";
// Configuration constants for search limits
const MAX_SEARCH_ATTEMPTS = 5;

interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  cover?: {
    id: number;
    url: string;
  };
  first_release_date?: number;
  rating?: number;
  platforms?: Array<{
    id: number;
    name: string;
  }>;
  genres?: Array<{
    id: number;
    name: string;
  }>;
  screenshots?: Array<{
    id: number;
    url: string;
  }>;
}

interface IGDBAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Sanitizes user input for use in IGDB API queries.
 * 
 * IGDB uses a custom query language called Apicalypse. This function provides
 * defense-in-depth by removing characters that could be used for query injection,
 * complementing backend validation at the route level.
 * 
 * Characters removed and rationale:
 * - Quotes (' "): String delimiters that could break out of string context
 * - Semicolons (;): Statement separators that could inject additional commands
 * - Ampersands (&) and Pipes (|): Logical operators for query conditions
 * - Asterisks (*): Wildcard operators (we control their placement in queries)
 * - Parentheses (()): Grouping operators for complex conditions
 * - Angle brackets (<>): Comparison operators
 * - Backslashes (\): Escape characters
 * - Square brackets ([]): Array/collection operators
 * 
 * The 100-character limit prevents abuse through extremely long inputs that
 * could cause performance issues or circumvent other security measures.
 */
function sanitizeIgdbInput(input: string): string {
  return input
    .replace(/['"`;|&*()<>\\[\]]/g, '') // Remove special characters including square brackets
    .replace(/\s+/g, ' ')                // Normalize whitespace
    .trim()
    .slice(0, 100);                      // Limit length to prevent abuse
}

// Constants for query thresholds
const MIN_RATING_THRESHOLD = 60;
const MIN_RATING_COUNT = 3;
const HIGH_RATING_THRESHOLD = 70;
const HIGH_RATING_COUNT = 5;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;

// ⚡ Bolt: Define a cache entry interface for in-memory caching.
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class IGDBClient {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  // ⚡ Bolt: Use a Map for in-memory caching to store API responses and reduce redundant calls.
  private cache = new Map<string, CacheEntry<any>>();

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const clientId = config.igdb.clientId;
    const clientSecret = config.igdb.clientSecret;

    if (!clientId || !clientSecret) {
      throw new Error('IGDB credentials not configured');
    }

    const response = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`IGDB authentication failed: ${response.status}`);
    }

    const data: IGDBAuthResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 minute early

    return this.accessToken;
  }

  // IGDB API returns dynamic JSON structures
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async makeRequest(endpoint: string, query: string, ttl: number = 0): Promise<any> {
    // ⚡ Bolt: Generate a unique cache key based on the endpoint and a normalized query.
    // Normalizing whitespace ensures that semantically identical queries
    // with different formatting hit the same cache entry.
    const cacheKey = `${endpoint}:${query.replace(/\s+/g, " ").trim()}`;

    // ⚡ Bolt: Check for a valid, non-expired cache entry first.
    if (this.cache.has(cacheKey)) {
      const entry = this.cache.get(cacheKey)!;
      if (Date.now() < entry.expiry) {
        igdbLogger.debug({ cacheKey }, "cache hit");
        return entry.data;
      }
      igdbLogger.debug({ cacheKey }, "cache expired");
      this.cache.delete(cacheKey);
    }
    igdbLogger.debug({ cacheKey }, "cache miss");

    const token = await this.authenticate();
    const clientId = config.igdb.clientId;

    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Client-ID': clientId!,
        'Authorization': `Bearer ${token}`,
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB API error: ${response.status}`);
    }

    const data = await response.json();

    // ⚡ Bolt: If a TTL is specified, store the response in the cache.
    if (ttl > 0) {
      const expiry = Date.now() + ttl;
      this.cache.set(cacheKey, { data, expiry });
      igdbLogger.debug({ cacheKey, ttl }, "cached response");
    }

    return data;
  }

  async searchGames(query: string, limit: number = 20): Promise<IGDBGame[]> {
    // ⚡ Bolt: Cache search results, including empty ones, for 5 minutes.
    // This prevents redundant, expensive multi-step searches for the same term.
    const sanitizedQuery = sanitizeIgdbInput(query);

    const cacheKey = `searchGames:${sanitizedQuery}:${limit}`;
    const ttl = 5 * 60 * 1000; // 5 minutes

    if (this.cache.has(cacheKey)) {
      const entry = this.cache.get(cacheKey)!;
      if (Date.now() < entry.expiry) {
        igdbLogger.debug({ cacheKey }, "searchGames cache hit");
        return entry.data;
      }
      this.cache.delete(cacheKey);
    }

    const cacheAndReturn = (result: IGDBGame[]): IGDBGame[] => {
      this.cache.set(cacheKey, { data: result, expiry: Date.now() + ttl });
      igdbLogger.debug({ cacheKey, ttl, resultCount: result.length }, "cached searchGames response");
      return result;
    };

    // ⚡ Bolt: Address code review feedback to cache empty results for invalid queries.
    if (!sanitizedQuery) {
      return cacheAndReturn([]);
    }
    
    let attemptCount = 0;

    // Try multiple search approaches to maximize results
    const searchApproaches = [
      // Approach 1: Full text search without category filter  
      `search "${sanitizedQuery}"; fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; limit ${limit};`,
      
      // Approach 2: Full text search with category filter
      `search "${sanitizedQuery}"; fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where category = 0; limit ${limit};`,
      
      // Approach 3: Case-insensitive name matching without category
      `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where name ~= "${sanitizedQuery}"; limit ${limit};`,
      
      // Approach 4: Partial name matching without category
      `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where name ~ *"${sanitizedQuery}"*; sort rating desc; limit ${limit};`
    ];

    for (let i = 0; i < searchApproaches.length && attemptCount < MAX_SEARCH_ATTEMPTS; i++) {
      try {
        attemptCount++;
        igdbLogger.debug({ approach: i + 1, query: sanitizedQuery, attempt: attemptCount, maxAttempts: MAX_SEARCH_ATTEMPTS }, `trying approach ${i + 1}`);
        const results = await this.makeRequest('games', searchApproaches[i]);
        if (results.length > 0) {
          igdbLogger.info({ approach: i + 1, query: sanitizedQuery, resultCount: results.length }, `search approach ${i + 1} found ${results.length} results`);
          return cacheAndReturn(results);
        }
      } catch (error) {
        igdbLogger.warn({ approach: i + 1, query: sanitizedQuery, error }, `search approach ${i + 1} failed`);
      }
    }

    // Check if we've reached the max attempts before trying word search
    if (attemptCount >= MAX_SEARCH_ATTEMPTS) {
      igdbLogger.info({ query: sanitizedQuery, maxAttempts: MAX_SEARCH_ATTEMPTS }, `search reached max attempts`);
      return cacheAndReturn([]);
    }

    // If no full-phrase results, try individual words without category filter
    const words = sanitizedQuery.toLowerCase().split(' ').filter(word => word.length > 2);
    for (const word of words) {
      if (attemptCount >= MAX_SEARCH_ATTEMPTS) {
        console.warn(`IGDB search reached max attempts (${MAX_SEARCH_ATTEMPTS}) during word search for "${query}"`);
        break;
      }

      try {
        attemptCount++;
        const sanitizedWord = sanitizeIgdbInput(word);
        if (!sanitizedWord) continue;
        
        igdbLogger.debug({ word: sanitizedWord, attempt: attemptCount, maxAttempts: MAX_SEARCH_ATTEMPTS }, `trying word search`);
        const wordQuery = `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where name ~ *"${sanitizedWord}"*; sort rating desc; limit ${limit};`;
        const wordResults = await this.makeRequest('games', wordQuery);
        
        if (wordResults.length > 0) {
          igdbLogger.info({ word, resultCount: wordResults.length }, `word search found ${wordResults.length} results`);
          
          // Filter to prefer games containing multiple query words
          const filteredResults = wordResults.filter((game: IGDBGame) => 
            words.filter(w => game.name.toLowerCase().includes(w)).length >= Math.min(2, words.length)
          );
          
          return cacheAndReturn(filteredResults.length > 0 ? filteredResults : wordResults.slice(0, limit));
        }
      } catch (error) {
        igdbLogger.warn({ word, error }, `word search failed`);
      }
    }

    igdbLogger.info({ query: sanitizedQuery }, `search found no results`);
    return cacheAndReturn([]);
  }

  async getGameById(id: number): Promise<IGDBGame | null> {
    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where id = ${id};
    `;

    // ⚡ Bolt: Cache game data for 24 hours as it's unlikely to change frequently.
    const results = await this.makeRequest('games', igdbQuery, 24 * 60 * 60 * 1000);
    return results.length > 0 ? results[0] : null;
  }

  async getPopularGames(limit: number = 20): Promise<IGDBGame[]> {
    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where rating > 80 & rating_count > 10;
      sort rating desc;
      limit ${limit};
    `;

    // ⚡ Bolt: Cache popular games for 1 hour to reduce load during high traffic.
    return this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
  }

  async getRecentReleases(limit: number = 20): Promise<IGDBGame[]> {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const now = Math.floor(Date.now() / 1000);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where first_release_date >= ${thirtyDaysAgo} & first_release_date <= ${now};
      sort first_release_date desc;
      limit ${limit};
    `;

    // ⚡ Bolt: Cache recent releases for 1 hour.
    return this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
  }

  async getUpcomingReleases(limit: number = 20): Promise<IGDBGame[]> {
    const now = Math.floor(Date.now() / 1000);
    const sixMonthsFromNow = Math.floor((Date.now() + 6 * 30 * 24 * 60 * 60 * 1000) / 1000);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where first_release_date >= ${now} & first_release_date <= ${sixMonthsFromNow};
      sort first_release_date asc;
      limit ${limit};
    `;

    // ⚡ Bolt: Cache upcoming releases for 1 hour.
    return this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
  }

  async getGamesByGenres(genres: string[], excludeIds: number[] = [], limit: number = 20): Promise<IGDBGame[]> {
    if (genres.length === 0) return [];

    // Convert genre names to a query format - use regex matching for better results
    const genreConditions = genres.slice(0, 3).map(genre => {
      // Sanitize genre names to prevent query injection
      const cleanGenre = sanitizeIgdbInput(genre);
      return cleanGenre ? `genres.name ~ *"${cleanGenre}"*` : null;
    }).filter(Boolean);
    
    if (genreConditions.length === 0) return [];
    
    // ⚡ Bolt: Sort conditions alphabetically to ensure a consistent cache key
    // regardless of the original order of genres.
    const genreCondition = genreConditions.sort().join(' | ');
    const excludeCondition = excludeIds.length > 0 ? ` & id != (${excludeIds.join(',')})` : '';

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where (${genreCondition}) & rating > ${HIGH_RATING_THRESHOLD} & rating_count > ${HIGH_RATING_COUNT}${excludeCondition};
      sort rating desc;
      limit ${limit};
    `;

    try {
      // ⚡ Bolt: Cache genre-based searches for 1 hour.
      return await this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      igdbLogger.warn({ genres, error }, `genre search failed`);
      return [];
    }
  }

  async getGamesByPlatforms(platforms: string[], excludeIds: number[] = [], limit: number = 20): Promise<IGDBGame[]> {
    if (platforms.length === 0) return [];

    // Use common platform names for better matching
    const platformMap: { [key: string]: string } = {
      "PC (Microsoft Windows)": "PC",
      "PlayStation 5": "PlayStation",
      "PlayStation 4": "PlayStation",
      "Xbox Series X|S": "Xbox",
      "Xbox One": "Xbox",
      "Nintendo Switch": "Nintendo"
    };

    const mappedPlatforms = platforms.slice(0, 3).map(platform => 
      platformMap[platform] || platform.split(' ')[0] // Use first word if no mapping
    );
    const uniquePlatforms = Array.from(new Set(mappedPlatforms));
    
    const platformConditions = uniquePlatforms.map(platform => {
      // Sanitize platform names to prevent query injection
      const cleanPlatform = sanitizeIgdbInput(platform);
      return cleanPlatform ? `platforms.name ~ *"${cleanPlatform}"*` : null;
    }).filter(Boolean);
    
    if (platformConditions.length === 0) return [];
    
    // ⚡ Bolt: Sort conditions alphabetically to ensure a consistent cache key
    // regardless of the original order of platforms.
    const platformCondition = platformConditions.sort().join(' | ');
    const excludeCondition = excludeIds.length > 0 ? ` & id != (${excludeIds.join(',')})` : '';

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where (${platformCondition}) & rating > ${HIGH_RATING_THRESHOLD} & rating_count > ${HIGH_RATING_COUNT}${excludeCondition};
      sort rating desc;
      limit ${limit};
    `;

    try {
      // ⚡ Bolt: Cache platform-based searches for 1 hour.
      return await this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      igdbLogger.warn({ platforms, error }, `platform search failed`);
      return [];
    }
  }

  async getRecommendations(userGames: Array<{ genres?: string[]; platforms?: string[]; igdbId?: number }>, limit: number = 20): Promise<IGDBGame[]> {
    if (userGames.length === 0) {
      // If user has no games, show popular games
      return this.getPopularGames(limit);
    }

    // Extract genres and platforms from user's games
    const userGenres = Array.from(new Set(
      userGames.flatMap(game => game.genres || [])
    ));
    const userPlatforms = Array.from(new Set(
      userGames.flatMap(game => game.platforms || [])
    ));
    const userIgdbIds = userGames
      .filter(game => game.igdbId !== undefined)
      .map(game => game.igdbId!);

    igdbLogger.debug({ genreCount: userGenres.length, platformCount: userPlatforms.length, excludeCount: userIgdbIds.length }, `generating recommendations`);

    const recommendations: IGDBGame[] = [];
    
    try {
      // Get games by favorite genres (60% of results)
      if (userGenres.length > 0) {
        const topGenres = userGenres.slice(0, 5); // Use top 5 genres
        const genreGames = await this.getGamesByGenres(topGenres, userIgdbIds, Math.ceil(limit * 0.6));
        recommendations.push(...genreGames);
      }

      // Get games by platforms (40% of results)
      if (userPlatforms.length > 0 && recommendations.length < limit) {
        const remaining = limit - recommendations.length;
        const platformGames = await this.getGamesByPlatforms(userPlatforms, userIgdbIds, remaining);
        recommendations.push(...platformGames);
      }

      // Fill remaining with popular games if needed
      if (recommendations.length < limit) {
        const remaining = limit - recommendations.length;
        const popularGames = await this.getPopularGames(remaining + 10); // Get extra to filter duplicates
        const filteredPopular = popularGames.filter(game => 
          !userIgdbIds.includes(game.id) && 
          !recommendations.some(rec => rec.id === game.id)
        );
        recommendations.push(...filteredPopular.slice(0, remaining));
      }

      // Remove duplicates and return
      const uniqueRecommendations = recommendations.filter((game, index, self) => 
        index === self.findIndex(g => g.id === game.id)
      );

      igdbLogger.info({ count: uniqueRecommendations.length }, `generated ${uniqueRecommendations.length} unique recommendations`);
      return uniqueRecommendations.slice(0, limit);

    } catch (error) {
      igdbLogger.error({ error }, `error generating recommendations`);
      // Fallback to popular games
      return this.getPopularGames(limit);
    }
  }

  async getGamesByGenre(genre: string, limit: number = 20, offset: number = 0): Promise<IGDBGame[]> {
    // Sanitize the genre name to prevent query injection
    const cleanGenre = sanitizeIgdbInput(genre);
    if (!cleanGenre) return [];
    
    // Validate pagination parameters
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const validOffset = Math.min(Math.max(0, offset), MAX_OFFSET);
    
    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where genres.name ~ *"${cleanGenre}"* & rating > ${MIN_RATING_THRESHOLD} & rating_count > ${MIN_RATING_COUNT};
      sort rating desc;
      limit ${validLimit};
      offset ${validOffset};
    `;

    try {
      // ⚡ Bolt: Cache genre search results for 1 hour.
      return await this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      console.warn(`IGDB genre search failed for genre: ${genre}`, error);
      return [];
    }
  }

  async getGamesByPlatform(platform: string, limit: number = 20, offset: number = 0): Promise<IGDBGame[]> {
    // Sanitize the platform name to prevent query injection
    const cleanPlatform = sanitizeIgdbInput(platform);
    if (!cleanPlatform) return [];
    
    // Validate pagination parameters
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const validOffset = Math.min(Math.max(0, offset), MAX_OFFSET);
    
    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where platforms.name ~ *"${cleanPlatform}"* & rating > ${MIN_RATING_THRESHOLD} & rating_count > ${MIN_RATING_COUNT};
      sort rating desc;
      limit ${validLimit};
      offset ${validOffset};
    `;

    try {
      // ⚡ Bolt: Cache platform search results for 1 hour.
      return await this.makeRequest('games', igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      console.warn(`IGDB platform search failed for platform: ${platform}`, error);
      return [];
    }
  }

  async getGenres(): Promise<Array<{ id: number; name: string }>> {
    const igdbQuery = `
      fields id, name;
      sort name asc;
      limit 50;
    `;

    try {
      // ⚡ Bolt: Cache genres for 24 hours as they are static.
      return await this.makeRequest('genres', igdbQuery, 24 * 60 * 60 * 1000);
    } catch (error) {
      console.warn('IGDB genres fetch failed:', error);
      return [];
    }
  }

  async getPlatforms(): Promise<Array<{ id: number; name: string }>> {
    // Only get major gaming platforms
    const igdbQuery = `
      fields id, name;
      where category = (1, 5, 6);
      sort name asc;
      limit 50;
    `;

    try {
      // ⚡ Bolt: Cache platforms for 24 hours as they are static.
      return await this.makeRequest('platforms', igdbQuery, 24 * 60 * 60 * 1000);
    } catch (error) {
      console.warn('IGDB platforms fetch failed:', error);
      return [];
    }
  }

  formatGameData(igdbGame: IGDBGame): Record<string, unknown> {
    const releaseDate = igdbGame.first_release_date 
      ? new Date(igdbGame.first_release_date * 1000)
      : null;
    
    const now = new Date();
    const isReleased = releaseDate ? releaseDate <= now : false;
    
    return {
      id: `igdb-${igdbGame.id}`,
      igdbId: igdbGame.id,
      title: igdbGame.name,
      summary: igdbGame.summary || '',
      coverUrl: igdbGame.cover?.url ? `https:${igdbGame.cover.url.replace('t_thumb', 't_cover_big')}` : '',
      releaseDate: releaseDate ? releaseDate.toISOString().split('T')[0] : '',
      rating: igdbGame.rating ? Math.round(igdbGame.rating) / 10 : 0,
      platforms: igdbGame.platforms?.map(p => p.name) || [],
      genres: igdbGame.genres?.map(g => g.name) || [],
      screenshots: igdbGame.screenshots?.map(s => `https:${s.url.replace('t_thumb', 't_screenshot_big')}`) || [],
      // For Discovery games, don't set a status since they're not in collection yet
      status: null,
      isReleased,
      releaseYear: releaseDate ? releaseDate.getFullYear() : null,
    };
  }
}

export const igdbClient = new IGDBClient();