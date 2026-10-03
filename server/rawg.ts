import { config } from "./config.js";
import { rawgLogger } from "./logger.js";
import { storage } from "./storage.js";
import { safeFetch } from "./ssrf.js";

/**
 * RAWG (https://rawg.io) API client — Questarr's game-metadata provider.
 * RAWG is a plain REST API: every request is a GET with the user's API key in
 * the `Key` header (free keys from https://rawg.io/apidocs). The free tier is
 * rate-limited to a few requests per 10 seconds, so callers must not fire off
 * bursts of per-game requests without throttling (see getGamesForRefresh).
 *
 * Attribution: RAWG's terms require an active hyperlink to rawg.io on every
 * page where its data or images are shown. formatGame() therefore always
 * emits a `rawgUrl` (https://rawg.io/games/<slug>) that the client renders as
 * a link in the game details view.
 */

export const RAWG_API_BASE = "https://api.rawg.io/api";

// Upstream hard timeout; the free tier occasionally takes a few seconds.
const REQUEST_TIMEOUT_MS = 15000;
// Keep every API-key request (search, lists, details, refresh) under RAWG's
// approximate five-requests-per-ten-seconds free-tier burst, even when the UI
// loads several discovery carousels concurrently.
const REQUEST_INTERVAL_MS = 2100;
let rawgRequestTail: Promise<void> = Promise.resolve();
let nextRawgRequestAt = 0;

function queueRawgRequest<T>(request: () => Promise<T>): Promise<T> {
  const queued = rawgRequestTail.then(async () => {
    const waitMs = Math.max(0, nextRawgRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextRawgRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    return request();
  });
  rawgRequestTail = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

/** ESRB slugs that the user's "hide age-restricted content" filter treats as adult (17+/18+). */
const ADULT_ESRB_SLUGS = new Set(["mature", "adults-only"]);

export class RawgApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "RawgApiError";
  }
}

/**
 * Map a RAWG failure to an HTTP status + message suitable for API routes.
 * Rejected/invalid API keys and rate limits are client-side configuration
 * issues, not server errors — they must not surface as 500.
 */
export function rawgErrorToHttpError(error: unknown): { status: number; message: string } {
  if (error instanceof RawgApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: 401,
        message: "RAWG rejected the API key. Check the RAWG API key in Settings.",
      };
    }
    if (error.status === 429) {
      return { status: 429, message: "RAWG rate limit exceeded, please try again later" };
    }
    if (error.status === 404) {
      return { status: 404, message: "Resource not found in RAWG" };
    }
    return { status: 502, message: `RAWG error: ${error.message}` };
  }
  return { status: 500, message: "Internal server error" };
}

// ── Response types (only the fields Questarr consumes) ─────────────────────

export interface RawgEntity {
  id: number;
  name: string;
  slug?: string;
}

export type RawgGenre = RawgEntity;
export type RawgPlatform = RawgEntity;

export interface RawgEsrbRating {
  id: number;
  slug: string;
  name: string;
}

export interface RawgAddition {
  id: number;
  name: string;
  image?: string | null;
  released?: string | null;
}

export interface RawgGame {
  id: number;
  slug?: string | null;
  name: string;
  released?: string | null;
  tba?: boolean;
  background_image?: string | null;
  image?: string | null;
  description?: string | null;
  metacritic?: number | null;
  metacritic_url?: string | null;
  website?: string | null;
  esrb_rating?: RawgEsrbRating | null;
  platforms?: RawgPlatform[] | null;
  genres?: RawgGenre[] | null;
  developers?: RawgEntity[] | null;
  publishers?: RawgEntity[] | null;
  tags?: RawgEntity[] | null;
  additions?: RawgAddition[] | null;
}

interface RawgPagination<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

interface RawgScreenshot {
  id: number;
  image: string;
}

export interface RawgSearchOptions {
  /** RAWG platform slug or ID filter (e.g. "pc", "4"). */
  platform?: string;
  /** RAWG genre slug or ID filter (e.g. "action", "4"). */
  genre?: string;
  /** Restrict results to a release year (mapped to RAWG's date range). */
  year?: number;
}

// ── Client ──────────────────────────────────────────────────────────────────

class RawgClient {
  /**
   * Resolves the API key to use: the user-saved key from system config takes
   * precedence over the RAWG_API_KEY env var.
   */
  async getApiKey(): Promise<string | null> {
    const dbKey = (await storage.getSystemConfig("rawg.apiKey"))?.trim();
    if (dbKey) return dbKey;
    const envKey = config.rawg?.apiKey?.trim();
    return envKey ? envKey : null;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getApiKey()) !== null;
  }

  /**
   * Verifies an API key against RAWG with a minimal request, for the
   * "Test connection" buttons in the setup wizard and settings page.
   */
  async testApiKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const data = await this.request<RawgPagination<RawgGame>>("/games", { page_size: 1 }, apiKey);
      if (!Array.isArray(data.results)) {
        return { success: false, error: "Unexpected response from RAWG" };
      }
      return { success: true };
    } catch (error) {
      if (error instanceof RawgApiError && (error.status === 401 || error.status === 403)) {
        return { success: false, error: "RAWG rejected this API key" };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Could not reach RAWG: ${message}` };
    }
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    apiKeyOverride?: string
  ): Promise<T> {
    const key = apiKeyOverride ?? (await this.getApiKey());
    if (!key) {
      throw new RawgApiError("RAWG API key is not configured", 401);
    }

    const url = new URL(`${RAWG_API_BASE}${path}`);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }

    let response: Response;
    try {
      response = await queueRawgRequest(() =>
        safeFetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            Key: key,
          },
          timeoutMs: REQUEST_TIMEOUT_MS,
        })
      );
    } catch (error) {
      const message = errorMessage(error);
      if (message.toLowerCase().includes("abort") || message.toLowerCase().includes("timed out")) {
        throw new RawgApiError(`RAWG request timed out (${path})`);
      }
      throw new RawgApiError(`Could not reach RAWG: ${message}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new RawgApiError("RAWG rejected the API key (401/403)", response.status);
    }
    if (response.status === 429) {
      throw new RawgApiError("RAWG rate limit exceeded, please try again later", 429);
    }
    if (response.status === 404) {
      throw new RawgApiError(`RAWG resource not found (${path})`, 404);
    }
    if (!response.ok) {
      throw new RawgApiError(
        `RAWG request failed (${response.status}) for ${path}`,
        response.status
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new RawgApiError(`RAWG returned invalid JSON for ${path}`);
    }
  }

  // ── Discovery endpoints ───────────────────────────────────────────────────

  /** Full-text search; RAWG matches names, descriptions, tags, developers, etc. */
  async searchGames(
    query: string,
    limit: number = 20,
    options: RawgSearchOptions = {}
  ): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    const params: Record<string, string | number | undefined> = {
      search: query,
      page_size: clampLimit(limit),
    };
    if (options.year) {
      params.start_date = `${options.year}-01-01`;
      params.end_date = `${options.year}-12-31`;
    }
    const data = await this.request<RawgPagination<RawgGame>>("/games", params);
    let results = data.results ?? [];
    const platformFilter = options.platform;
    if (platformFilter) results = results.filter((g) => matchesFilter(g.platforms, platformFilter));
    const genreFilter = options.genre;
    if (genreFilter) results = results.filter((g) => matchesFilter(g.genres, genreFilter));
    return results;
  }

  /**
   * Search RAWG for multiple candidate titles (one throttled request per
   * title) and return a map of title -> best-matching game. Used by xREL
   * matching to attach candidate games to release names.
   */
  async batchSearchGames(titles: string[]): Promise<Map<string, RawgGame>> {
    const results = new Map<string, RawgGame>();
    for (const title of titles) {
      const trimmed = title.trim();
      if (!trimmed) continue;
      try {
        const games = await this.searchGames(trimmed, 3);
        const best = games[0];
        if (best) results.set(trimmed, best);
      } catch {
        // A single failed lookup doesn't break the whole batch.
      }
    }
    return results;
  }

  /** Most-added-to-collections games (RAWG's notion of popularity). */
  async getPopularGames(limit: number = 20, options: RawgSearchOptions = {}): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    const data = await this.request<RawgPagination<RawgGame>>(
      "/games",
      this.listParams({ ordering: "-added" }, limit, options)
    );
    return data.results ?? [];
  }

  /** Most recently released games. */
  async getRecentReleases(
    limit: number = 20,
    options: RawgSearchOptions = {}
  ): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    const data = await this.request<RawgPagination<RawgGame>>(
      "/games",
      this.listParams({ ordering: "-released" }, limit, options)
    );
    // `ordering=-released` leaves undated (TBA) games floating; drop them so
    // "recent" actually means recently released.
    return (data.results ?? []).filter((g) => !!g.released);
  }

  /** Games with a known release date in the next 12 months. */
  async getUpcomingReleases(
    limit: number = 20,
    options: RawgSearchOptions = {}
  ): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    const today = new Date();
    const horizon = new Date(today);
    horizon.setFullYear(today.getFullYear() + 1);
    const data = await this.request<RawgPagination<RawgGame>>(
      "/games",
      this.listParams(
        { dates: `${isoDate(today)},${isoDate(horizon)}`, ordering: "released" },
        limit,
        options
      )
    );
    return (data.results ?? []).filter((g) => !!g.released);
  }

  private listParams(
    base: Record<string, string | number | undefined>,
    limit: number,
    options: RawgSearchOptions
  ): Record<string, string | number | undefined> {
    return {
      ...base,
      ...(options.platform ? { platforms: options.platform } : {}),
      ...(options.genre ? { genres: options.genre } : {}),
      page_size: clampLimit(limit),
    };
  }

  async getGamesByGenre(
    genreSlug: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    const data = await this.request<RawgPagination<RawgGame>>("/games", {
      genres: genreSlug,
      ordering: "-added",
      page: Math.floor(offset / clampLimit(limit)) + 1,
      page_size: clampLimit(limit),
    });
    return data.results ?? [];
  }

  async getGamesByPlatform(
    platformSlug: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    const data = await this.request<RawgPagination<RawgGame>>("/games", {
      platforms: platformSlug,
      ordering: "-added",
      page: Math.floor(offset / clampLimit(limit)) + 1,
      page_size: clampLimit(limit),
    });
    return data.results ?? [];
  }

  /** Look up a game by its Steam App ID via RAWG's external reference endpoint. */
  async getGameBySteamAppId(steamAppId: number): Promise<RawgGame | null> {
    if (!(await this.isConfigured())) return null;
    try {
      return await this.request<RawgGame>(`/games/external/steam/${steamAppId}/`);
    } catch (error) {
      if (error instanceof RawgApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** Full detail for one game (with the expanded relationship fields). */
  async getGameById(id: number): Promise<RawgGame | null> {
    if (!(await this.isConfigured())) return null;
    try {
      return await this.request<RawgGame>(`/games/${id}`);
    } catch (error) {
      if (error instanceof RawgApiError && error.status === 404) return null;
      throw error;
    }
  }

  async getScreenshots(id: number, limit: number = 8): Promise<string[]> {
    if (!(await this.isConfigured())) return [];
    try {
      const data = await this.request<RawgPagination<RawgScreenshot>>(`/games/${id}/screenshots`, {
        page_size: clampLimit(limit, 100),
      });
      return (data.results ?? [])
        .map((s) => s.image)
        .filter((img): img is string => !!img && img.startsWith("http"));
    } catch (error) {
      if (error instanceof RawgApiError && error.status === 404) return [];
      throw error;
    }
  }

  /** Visual-similarity suggestions (RAWG's equivalent of recommendations). */
  async getSuggested(id: number, limit: number = 10): Promise<RawgGame[]> {
    if (!(await this.isConfigured())) return [];
    try {
      const data = await this.request<RawgPagination<RawgGame>>(`/games/${id}/suggested`, {
        page_size: clampLimit(limit),
      });
      return data.results ?? [];
    } catch (error) {
      if (error instanceof RawgApiError && error.status === 404) return [];
      throw error;
    }
  }

  async getGenres(): Promise<RawgGenre[]> {
    if (!(await this.isConfigured())) return [];
    const data = await this.request<RawgPagination<RawgGenre>>("/genres", { page_size: 100 });
    return (data.results ?? []).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPlatforms(): Promise<RawgPlatform[]> {
    if (!(await this.isConfigured())) return [];
    const data = await this.request<RawgPagination<RawgPlatform>>("/platforms", { page_size: 100 });
    return (data.results ?? []).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetches several games for the metadata-refresh flow without exceeding the
   * free tier's burst limit (5 requests / 10s on the public API). Each game is
   * one request; when includeScreenshots is set, screenshots are only fetched
   * for games that currently have none stored (screenshots rarely change, so
   * refreshing existing ones keeps the request count at 1 per game).
   */
  async getGamesForRefresh(
    ids: number[],
    includeScreenshotsFor: (id: number) => boolean
  ): Promise<Map<number, { game: RawgGame; screenshots: string[] }>> {
    const result = new Map<number, { game: RawgGame; screenshots: string[] }>();
    if (ids.length === 0) return result;

    const BURST_SIZE = 4; // leave headroom under the 5-per-10s ceiling
    const BURST_DELAY_MS = 2100;

    for (let i = 0; i < ids.length; i += BURST_SIZE) {
      const chunk = ids.slice(i, i + BURST_SIZE);
      await Promise.all(
        chunk.map(async (id) => {
          try {
            const game = await this.getGameById(id);
            if (!game) return;
            let screenshots: string[] = [];
            if (includeScreenshotsFor(id)) {
              screenshots = await this.getScreenshots(id);
            }
            result.set(id, { game, screenshots });
          } catch (error) {
            rawgLogger.warn({ id, error: errorMessage(error) }, "failed to refresh RAWG game");
          }
        })
      );
      if (i + BURST_SIZE < ids.length) {
        await sleep(BURST_DELAY_MS);
      }
    }
    return result;
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  /**
   * Maps a RAWG game onto the discovery/insert shape the client UI consumes.
   * `rawgUrl` backs the RAWG attribution link.
   */
  formatGame(game: RawgGame, screenshots: string[] = []): Record<string, unknown> {
    const releaseDate = game.released ?? null;
    const releaseDateObj = releaseDate ? parseIsoDate(releaseDate) : null;
    const now = new Date();
    const isReleased = releaseDateObj ? releaseDateObj <= now : false;

    return {
      id: `rawg-${game.id}`,
      source: "rawg",
      rawgId: game.id,
      rawgSlug: game.slug ?? null,
      title: game.name,
      summary: stripHtml(game.description) || "",
      coverUrl: game.image ?? "",
      releaseDate: releaseDate ?? "",
      rating: null,
      platforms: game.platforms?.map((p) => p.name) || [],
      platformOptions: game.platforms?.map((p) => ({ id: p.id, name: p.name })) || [],
      genres: game.genres?.map((g) => g.name) || [],
      // RAWG's free-text tags fill the client's themes UI slot.
      themes: (game.tags ?? [])
        .map((t) => t.name)
        .filter((name) => name.trim().length > 0)
        .slice(0, 20),
      isAdultContent: false,
      isAgeRestricted:
        !!game.esrb_rating && ADULT_ESRB_SLUGS.has(game.esrb_rating.slug.toLowerCase()),
      publishers: game.publishers?.map((p) => p.name) || [],
      developers: game.developers?.map((d) => d.name) || [],
      screenshots,
      // Category 1 renders as "Official Site" in the details modal; RAWG's
      // metacritic_url is intentionally excluded (its URL doesn't match any
      // modal link pattern and would otherwise be dropped anyway).
      websites: game.website
        ? [
            {
              category: 1,
              url: game.website,
            },
          ]
        : [],
      aggregatedRating: game.metacritic ?? undefined,
      // For Discovery games, don't set a status since they're not in collection yet
      status: null,
      isReleased,
      releaseYear: releaseDateObj ? releaseDateObj.getFullYear() : null,
      earlyAccess: false,
      category: "main" as const,
      expansions: (game.additions ?? [])
        .map((a) => ({
          id: a.id,
          name: a.name,
          coverUrl: a.image ?? "",
          releaseDate: a.released ?? "",
          category: "dlc" as const,
          rawgUrl: `https://rawg.io/games/${a.id}`,
        }))
        .slice(0, 10),
      rawgUrl: `https://rawg.io/games/${game.slug ?? game.id}`,
    };
  }
}

export const rawgClient = new RawgClient();

// ── Helpers ─────────────────────────────────────────────────────────────────

function clampLimit(limit: number, max: number = 50): number {
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(Math.floor(limit), max);
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0] ?? "";
}

function parseIsoDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** RAWG descriptions are HTML with <br> line breaks; flatten to plain text. */
function stripHtml(value?: string | null): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesFilter(
  entities: Array<{ id: number; name: string; slug?: string }> | null | undefined,
  filter: string
): boolean {
  if (!entities) return false;
  return entities.some(
    (e) =>
      String(e.id) === filter ||
      e.name === filter ||
      e.name.toLowerCase() === filter.toLowerCase() ||
      (e.slug ?? "") === filter
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
