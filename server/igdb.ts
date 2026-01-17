import { config } from "./config.js";
import { igdbLogger } from "./logger.js";
import { storage } from "./storage.js";
import { db } from "./db.js";
import { userSettings } from "../shared/schema.js";

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
  involved_companies?: Array<{
    company: { name: string };
    developer: boolean;
    publisher: boolean;
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
 * - Backticks (`): Sometimes used for execution or string templating
 *
 * The 100-character limit prevents abuse through extremely long inputs that
 * could cause performance issues or circumvent other security measures.
 */
// ⚡ Bolt: Move regex compilation outside the function to avoid recompilation on every call.
const SPECIAL_CHARS_REGEX = /['"`;|&*()<>[\]]/g;
const WHITESPACE_REGEX = /\s+/g;

function sanitizeIgdbInput(input: string): string {
  return input
    .replace(SPECIAL_CHARS_REGEX, "") // Remove special characters including square brackets
    .replace(WHITESPACE_REGEX, " ") // Normalize whitespace
    .trim()
    .slice(0, 100); // Limit length to prevent abuse
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache = new Map<string, CacheEntry<any>>();

  private async getCredentials(): Promise<{
    clientId: string | undefined;
    clientSecret: string | undefined;
  }> {
    const dbClientId = await storage.getSystemConfig("igdb.clientId");
    const dbClientSecret = await storage.getSystemConfig("igdb.clientSecret");

    if (dbClientId && dbClientSecret) {
      return { clientId: dbClientId, clientSecret: dbClientSecret };
    }

    return {
      clientId: config.igdb.clientId,
      clientSecret: config.igdb.clientSecret,
    };
  }

  private async ensureConfigured(): Promise<boolean> {
    if (config.igdb.isConfigured) return true;
    const { clientId, clientSecret } = await this.getCredentials();
    return !!(clientId && clientSecret);
  }

  // Request queueing properties
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestTime: number = 0;
  // IGDB limit is ~4 req/s. 250ms is 4 req/s. Use 300ms to be safe (~3.33 req/s).
  private readonly MIN_REQUEST_INTERVAL = 300;

  private async queueRequest<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue = this.requestQueue.then(async () => {
        try {
          const now = Date.now();
          const timeSinceLast = now - this.lastRequestTime;
          if (timeSinceLast < this.MIN_REQUEST_INTERVAL) {
            const delay = this.MIN_REQUEST_INTERVAL - timeSinceLast;
            await new Promise((r) => setTimeout(r, delay));
          }
          this.lastRequestTime = Date.now();
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = await this.getCredentials();

    if (!clientId || !clientSecret) {
      throw new Error("IGDB credentials not configured");
    }

    const response = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error(`IGDB authentication failed: ${response.status}`);
    }

    const data: IGDBAuthResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000 - 60000; // Refresh 1 minute early

    return this.accessToken;
  }

  private async executeRequest<T>(
    endpoint: string,
    query: string,
    ttl: number,
    cacheKey: string
  ): Promise<T> {
    const token = await this.authenticate();
    const { clientId } = await this.getCredentials();

    this.lastRequestTime = Date.now();

    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Client-ID": clientId!,
        Authorization: `Bearer ${token}`,
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

    return data as T;
  }

  // IGDB API returns dynamic JSON structures
  private async makeRequest<T>(
    endpoint: string,
    query: string,
    ttl: number = 0,
    skipQueue: boolean = false
  ): Promise<T> {
    // ⚡ Bolt: Generate a unique cache key based on the endpoint and a normalized query.
    // Normalizing whitespace ensures that semantically identical queries
    // with different formatting hit the same cache entry.
    const cacheKey = `${endpoint}:${query.replace(/\s+/g, " ").trim()}`;

    // ⚡ Bolt: Check for a valid, non-expired cache entry first.
    if (this.cache.has(cacheKey)) {
      const entry = this.cache.get(cacheKey)!;
      if (Date.now() < entry.expiry) {
        igdbLogger.debug({ cacheKey }, "cache hit");
        return entry.data as T;
      }
      igdbLogger.debug({ cacheKey }, "cache expired");
      this.cache.delete(cacheKey);
    }
    igdbLogger.debug({ cacheKey }, "cache miss");

    if (skipQueue) {
      return this.executeRequest<T>(endpoint, query, ttl, cacheKey);
    }

    // Queue the API request to respect rate limits
    return this.queueRequest(async () => {
      return this.executeRequest<T>(endpoint, query, ttl, cacheKey);
    });
  }

  async searchGames(query: string, limit: number = 20): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) {
      igdbLogger.warn("IGDB credentials not configured, skipping search");
      return [];
    }

    // Sanitize the search query to prevent query injection
    const sanitizedQuery = sanitizeIgdbInput(query);
    if (!sanitizedQuery) return [];

    let attemptCount = 0;

    // Try multiple search approaches to maximize results
    const searchApproaches = [
      // Approach 1: Full text search without category filter
      `search "${sanitizedQuery}"; fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; limit ${limit};`,

      // Approach 2: Full text search with category filter
      `search "${sanitizedQuery}"; fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where category = 0; limit ${limit};`,

      // Approach 3: Case-insensitive name matching without category
      `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where name ~= "${sanitizedQuery}"; limit ${limit};`,

      // Approach 4: Partial name matching without category
      `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where name ~ *"${sanitizedQuery}"*; sort rating desc; limit ${limit};`,
    ];

    for (let i = 0; i < searchApproaches.length && attemptCount < MAX_SEARCH_ATTEMPTS; i++) {
      try {
        attemptCount++;
        igdbLogger.debug(
          {
            approach: i + 1,
            query: sanitizedQuery,
            attempt: attemptCount,
            maxAttempts: MAX_SEARCH_ATTEMPTS,
          },
          `trying approach ${i + 1}`
        );
        // Cache search results for 15 minutes to reduce redundant API calls
        const results = await this.makeRequest<IGDBGame[]>(
          "games",
          searchApproaches[i],
          15 * 60 * 1000
        );
        if (results.length > 0) {
          igdbLogger.info(
            { approach: i + 1, query: sanitizedQuery, resultCount: results.length },
            `search approach ${i + 1} found ${results.length} results`
          );
          return results;
        }
      } catch {
        igdbLogger.warn(
          { approach: i + 1, query: sanitizedQuery },
          `search approach ${i + 1} failed`
        );
      }
    }

    // Check if we've reached the max attempts before trying word search
    if (attemptCount >= MAX_SEARCH_ATTEMPTS) {
      igdbLogger.info(
        { query: sanitizedQuery, maxAttempts: MAX_SEARCH_ATTEMPTS },
        `search reached max attempts`
      );
      return [];
    }

    // If no full-phrase results, try individual words without category filter
    const words = sanitizedQuery
      .toLowerCase()
      .split(" ")
      .filter((word) => word.length > 2);

    // ⚡ Bolt: Sequential word search fallback was slow. Replaced with parallel execution
    // to improve response time for fallback queries.
    // We strictly respect the global attempt limit to prevent excessive API usage.
    const remainingAttempts = MAX_SEARCH_ATTEMPTS - attemptCount;
    if (words.length > 0 && remainingAttempts > 0) {
      // Only take as many words as we have remaining attempts
      const wordsToSearch = words.slice(0, remainingAttempts);

      const wordPromises = wordsToSearch.map(async (word) => {
        try {
          const sanitizedWord = sanitizeIgdbInput(word);
          if (!sanitizedWord) return [];

          const wordQuery = `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where name ~ *"${sanitizedWord}"*; sort rating desc; limit ${limit};`;
          // Cache word search results for 15 minutes
          return await this.makeRequest<IGDBGame[]>("games", wordQuery, 15 * 60 * 1000);
        } catch (error) {
          igdbLogger.warn({ word, error }, `word search failed`);
          return [];
        }
      });

      const allWordResults = await Promise.all(wordPromises);

      // Flatten and process results
      const wordResults = allWordResults.flat();

      if (wordResults.length > 0) {
        igdbLogger.info(
          { wordCount: wordsToSearch.length, resultCount: wordResults.length },
          `parallel word search found results`
        );

        // Filter to prefer games containing multiple query words
        const filteredResults = wordResults.filter(
          (game: IGDBGame) =>
            words.filter((w) => game.name.toLowerCase().includes(w)).length >=
            Math.min(2, words.length)
        );

        // Remove duplicates after merging
        const uniqueResults = (filteredResults.length > 0 ? filteredResults : wordResults).filter(
          (game: IGDBGame, index: number, self: IGDBGame[]) =>
            index === self.findIndex((g) => g.id === game.id)
        );

        return uniqueResults.slice(0, limit);
      }
    }

    igdbLogger.info({ query: sanitizedQuery }, `search found no results`);
    return [];
  }

  async getGameById(id: number): Promise<IGDBGame | null> {
    if (!(await this.ensureConfigured())) return null;

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where id = ${id};
    `;

    // ⚡ Bolt: Cache game data for 24 hours as it's unlikely to change frequently.
    const results = await this.makeRequest<IGDBGame[]>("games", igdbQuery, 24 * 60 * 60 * 1000);
    return results.length > 0 ? results[0] : null;
  }

  async getGamesByIds(ids: number[]): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];
    if (ids.length === 0) return [];

    // Get rate limit from settings
    let rateLimit = 3;
    try {
      const [settings] = await db.select().from(userSettings).limit(1);
      if (settings?.igdbRateLimitPerSecond) {
        rateLimit = settings.igdbRateLimitPerSecond;
      }
    } catch {
      igdbLogger.warn("Failed to fetch user settings for rate limit, defaulting to 3");
    }

    // Split into chunks of 100 to avoid query length limits
    const chunks = [];
    for (let i = 0; i < ids.length; i += 100) {
      chunks.push(ids.slice(i, i + 100));
    }

    const allResults: IGDBGame[] = [];

    // Process chunks in batches respecting rate limit
    for (let i = 0; i < chunks.length; i += rateLimit) {
      const batchStartTime = Date.now();
      const startLastRequestTime = this.lastRequestTime;

      const batch = chunks.slice(i, i + rateLimit);
      const promises = batch.map((chunk) => {
        const igdbQuery = `
        fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
        where id = (${chunk.join(",")});
        limit 100;
      `;
        // Cache batch requests for 1 hour, skip queue for manual batching
        return this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000, true);
      });

      const results = await Promise.all(promises);
      results.forEach((r) => allResults.push(...r));

      // If we made actual requests (cache miss), enforce rate limit
      if (this.lastRequestTime > startLastRequestTime && i + rateLimit < chunks.length) {
        const elapsed = Date.now() - batchStartTime;
        // Ensure at least 1 second passes per batch to respect X req/s
        const delay = Math.max(0, 1000 - elapsed);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return allResults;
  }

  async getPopularGames(limit: number = 20): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where rating > 80 & rating_count > 10;
      sort rating desc;
      limit ${limit};
    `;

    // ⚡ Bolt: Cache popular games for 1 hour to reduce load during high traffic.
    return this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
  }

  async getRecentReleases(limit: number = 20): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];

    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const now = Math.floor(Date.now() / 1000);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where first_release_date >= ${thirtyDaysAgo} & first_release_date <= ${now};
      sort first_release_date desc;
      limit ${limit};
    `;

    // ⚡ Bolt: Cache recent releases for 1 hour.
    return this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
  }

  async getUpcomingReleases(limit: number = 20): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];

    const now = Math.floor(Date.now() / 1000);
    const sixMonthsFromNow = Math.floor((Date.now() + 6 * 30 * 24 * 60 * 60 * 1000) / 1000);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where first_release_date >= ${now} & first_release_date <= ${sixMonthsFromNow};
      sort first_release_date asc;
      limit ${limit};
    `;

    // ⚡ Bolt: Cache upcoming releases for 1 hour.
    return this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
  }

  async getGamesByGenres(
    genres: string[],
    excludeIds: number[] = [],
    limit: number = 20
  ): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];
    if (genres.length === 0) return [];

    // Convert genre names to a query format - use regex matching for better results
    const genreConditions = genres
      .slice(0, 3)
      .map((genre) => {
        // Sanitize genre names to prevent query injection
        const cleanGenre = sanitizeIgdbInput(genre);
        return cleanGenre ? `genres.name ~ *"${cleanGenre}"*` : null;
      })
      .filter(Boolean);

    if (genreConditions.length === 0) return [];

    // ⚡ Bolt: Sort conditions alphabetically to ensure a consistent cache key
    // regardless of the original order of genres.
    const genreCondition = genreConditions.sort().join(" | ");
    const excludeCondition = excludeIds.length > 0 ? ` & id != (${excludeIds.join(",")})` : "";

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where (${genreCondition}) & rating > ${HIGH_RATING_THRESHOLD} & rating_count > ${HIGH_RATING_COUNT}${excludeCondition};
      sort rating desc;
      limit ${limit};
    `;

    try {
      // ⚡ Bolt: Cache genre-based searches for 1 hour.
      return await this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
    } catch {
      igdbLogger.warn({ genres }, `genre search failed`);
      return [];
    }
  }

  async getGamesByPlatforms(
    platforms: string[],
    excludeIds: number[] = [],
    limit: number = 20
  ): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];
    if (platforms.length === 0) return [];

    // Use common platform names for better matching
    const platformMap: { [key: string]: string } = {
      "PC (Microsoft Windows)": "PC",
      "PlayStation 5": "PlayStation",
      "PlayStation 4": "PlayStation",
      "Xbox Series X|S": "Xbox",
      "Xbox One": "Xbox",
      "Nintendo Switch": "Nintendo",
    };

    const mappedPlatforms = platforms.slice(0, 3).map(
      (platform) => platformMap[platform] || platform.split(" ")[0] // Use first word if no mapping
    );
    const uniquePlatforms = Array.from(new Set(mappedPlatforms));

    const platformConditions = uniquePlatforms
      .map((platform) => {
        // Sanitize platform names to prevent query injection
        const cleanPlatform = sanitizeIgdbInput(platform);
        return cleanPlatform ? `platforms.name ~ *"${cleanPlatform}"*` : null;
      })
      .filter(Boolean);

    if (platformConditions.length === 0) return [];

    // ⚡ Bolt: Sort conditions alphabetically to ensure a consistent cache key
    // regardless of the original order of platforms.
    const platformCondition = platformConditions.sort().join(" | ");
    const excludeCondition = excludeIds.length > 0 ? ` & id != (${excludeIds.join(",")})` : "";

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where (${platformCondition}) & rating > ${HIGH_RATING_THRESHOLD} & rating_count > ${HIGH_RATING_COUNT}${excludeCondition};
      sort rating desc;
      limit ${limit};
    `;

    try {
      // ⚡ Bolt: Cache platform-based searches for 1 hour.
      return await this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      igdbLogger.warn({ platforms, error }, `platform search failed`);
      return [];
    }
  }

  async getRecommendations(
    userGames: Array<{ genres?: string[]; platforms?: string[]; igdbId?: number }>,
    limit: number = 20
  ): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];

    if (userGames.length === 0) {
      // If user has no games, show popular games
      return this.getPopularGames(limit);
    }

    // Extract genres and platforms from user's games
    const userGenres = Array.from(new Set(userGames.flatMap((game) => game.genres || [])));
    const userPlatforms = Array.from(new Set(userGames.flatMap((game) => game.platforms || [])));
    const userIgdbIds = userGames
      .filter((game) => game.igdbId !== undefined)
      .map((game) => game.igdbId!);

    igdbLogger.debug(
      {
        genreCount: userGenres.length,
        platformCount: userPlatforms.length,
        excludeCount: userIgdbIds.length,
      },
      `generating recommendations`
    );

    const recommendations: IGDBGame[] = [];

    try {
      // Get games by favorite genres (60% of results)
      if (userGenres.length > 0) {
        const topGenres = userGenres.slice(0, 5); // Use top 5 genres
        const genreGames = await this.getGamesByGenres(
          topGenres,
          userIgdbIds,
          Math.ceil(limit * 0.6)
        );
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
        const filteredPopular = popularGames.filter(
          (game) =>
            !userIgdbIds.includes(game.id) && !recommendations.some((rec) => rec.id === game.id)
        );
        recommendations.push(...filteredPopular.slice(0, remaining));
      }

      // Remove duplicates and return
      const uniqueRecommendations = recommendations.filter(
        (game, index, self) => index === self.findIndex((g) => g.id === game.id)
      );

      igdbLogger.info(
        { count: uniqueRecommendations.length },
        `generated ${uniqueRecommendations.length} unique recommendations`
      );
      return uniqueRecommendations.slice(0, limit);
    } catch (error) {
      igdbLogger.error({ error }, `error generating recommendations`);
      // Fallback to popular games
      return this.getPopularGames(limit);
    }
  }

  async getGamesByGenre(
    genre: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];

    // Sanitize the genre name to prevent query injection
    const cleanGenre = sanitizeIgdbInput(genre);
    if (!cleanGenre) return [];

    // Validate pagination parameters
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const validOffset = Math.min(Math.max(0, offset), MAX_OFFSET);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where genres.name ~ *"${cleanGenre}"* & rating > ${MIN_RATING_THRESHOLD} & rating_count > ${MIN_RATING_COUNT};
      sort rating desc;
      limit ${validLimit};
      offset ${validOffset};
    `;

    try {
      // ⚡ Bolt: Cache genre search results for 1 hour.
      return await this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      console.warn(`IGDB genre search failed for genre: ${genre}`, error);
      return [];
    }
  }

  async getGamesByPlatform(
    platform: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<IGDBGame[]> {
    if (!(await this.ensureConfigured())) return [];

    // Sanitize the platform name to prevent query injection
    const cleanPlatform = sanitizeIgdbInput(platform);
    if (!cleanPlatform) return [];

    // Validate pagination parameters
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const validOffset = Math.min(Math.max(0, offset), MAX_OFFSET);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;
      where platforms.name ~ *"${cleanPlatform}"* & rating > ${MIN_RATING_THRESHOLD} & rating_count > ${MIN_RATING_COUNT};
      sort rating desc;
      limit ${validLimit};
      offset ${validOffset};
    `;

    try {
      // ⚡ Bolt: Cache platform search results for 1 hour.
      return await this.makeRequest<IGDBGame[]>("games", igdbQuery, 60 * 60 * 1000);
    } catch (error) {
      console.warn(`IGDB platform search failed for platform: ${platform}`, error);
      return [];
    }
  }

  async getGenres(): Promise<Array<{ id: number; name: string }>> {
    if (!(await this.ensureConfigured())) return [];

    const igdbQuery = `
      fields id, name;
      sort name asc;
      limit 50;
    `;

    try {
      // ⚡ Bolt: Cache genres for 24 hours as they are static.
      return await this.makeRequest<{ id: number; name: string }[]>(
        "genres",
        igdbQuery,
        24 * 60 * 60 * 1000
      );
    } catch (error) {
      console.warn("IGDB genres fetch failed:", error);
      return [];
    }
  }

  async getPlatforms(): Promise<Array<{ id: number; name: string }>> {
    if (!(await this.ensureConfigured())) return [];

    // Only get major gaming platforms
    const igdbQuery = `
      fields id, name;
      where category = (1, 5, 6);
      sort name asc;
      limit 50;
    `;

    try {
      // ⚡ Bolt: Cache platforms for 24 hours as they are static.
      return await this.makeRequest<{ id: number; name: string }[]>(
        "platforms",
        igdbQuery,
        24 * 60 * 60 * 1000
      );
    } catch (error) {
      console.warn("IGDB platforms fetch failed:", error);
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
      summary: igdbGame.summary || "",
      coverUrl: igdbGame.cover?.url
        ? `https:${igdbGame.cover.url.replace("t_thumb", "t_cover_big")}`
        : "",
      releaseDate: releaseDate ? releaseDate.toISOString().split("T")[0] : "",
      rating: igdbGame.rating ? Math.round(igdbGame.rating) / 10 : 0,
      platforms: igdbGame.platforms?.map((p) => p.name) || [],
      genres: igdbGame.genres?.map((g) => g.name) || [],
      publishers:
        igdbGame.involved_companies?.filter((c) => c.publisher).map((c) => c.company.name) || [],
      developers:
        igdbGame.involved_companies?.filter((c) => c.developer).map((c) => c.company.name) || [],
      screenshots:
        igdbGame.screenshots?.map((s) => `https:${s.url.replace("t_thumb", "t_screenshot_big")}`) ||
        [],
      // For Discovery games, don't set a status since they're not in collection yet
      status: null,
      isReleased,
      releaseYear: releaseDate ? releaseDate.getFullYear() : null,
    };
  }
}

export const igdbClient = new IGDBClient();
