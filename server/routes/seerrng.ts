import { Router, type Request, type Response } from "express";
import { readFileSync, constants as fsConstants, promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { TarArchive } from "archiver";
import { z } from "zod";
import { requireScope } from "../auth.js";
import { storage } from "../storage.js";
import {
  igdbClient,
  type DiscoverFilters,
  type IGDBContentRef,
  type IGDBGameContent,
} from "../igdb.js";
import { routesLogger as logger } from "../logger.js";
import {
  getContentFilterFlags,
  isContentFiltered,
  type ContentFilterFlags,
} from "../content-filter.js";
import { assertWithinRoots } from "../path-security.js";
import { DownloaderManager } from "../downloaders/manager.js";
import { quickAddGameByTitle } from "../game-quick-add.js";
import {
  ACQUIRED_GAME_STATUSES,
  SEERRNG_ARCHITECTURES,
  SEERRNG_OPERATING_SYSTEMS,
  type Game,
  type IntegrationRequest,
  type IntegrationRequestSelection,
  type SeerrngOperatingSystem,
} from "../../shared/schema.js";

/**
 * Provider API for SeerrNG (https://github.com/snapetech/seerrng), a
 * Jellyseerr-style request app. SeerrNG owns users, approvals and quotas;
 * Questarr stays single tenant and only answers for the one account that owns
 * the API key.
 *
 * The wire contract is the one QuestarrNG already ships (`apiVersion` 1,
 * `requestContractVersion` 2, https://github.com/snapetech/QuestarrNG/blob/main/docs/contracts/seerrng-v2.openapi.yaml)
 * so SeerrNG works with both projects unchanged. The implementation here is
 * independent: request state is derived from the existing game and download
 * records plus a small ledger (`integration_requests`), instead of extra
 * columns on games and downloads.
 */
export const seerrngRouter = Router();

const { version: APP_VERSION } = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
) as { version: string };

/** Route surface version (the `/v1` prefix). */
export const SEERRNG_API_VERSION = 1;
/** Request lifecycle semantics version; SeerrNG rejects versions it does not know. */
export const SEERRNG_REQUEST_CONTRACT_VERSION = 2;

const MAX_CATALOG_RESULTS = 50;
/** Paged catalog routes walk IGDB results from the start, so the window is bounded. */
// IGDB clamps one upstream request to 100 results, so that is the browsable window.
const MAX_CATALOG_WINDOW = 100;
const MAX_ASSETS = 100;
/** Discovery pages by offset; IGDB serves a bounded window, so the cursor is capped. */
const MAX_DISCOVER_OFFSET = 500;
const BASE_PATH = "/api/integration/seerrng/v1";

const scope = requireScope("requests");

// ── Catalog ──────────────────────────────────────────────────────────────────

type IgdbGame = Parameters<typeof igdbClient.formatGameData>[0];
type FormattedGame = ReturnType<typeof igdbClient.formatGameData>;

const catalogLimitSchema = z.coerce.number().int().min(1).max(MAX_CATALOG_RESULTS).default(20);
const offsetSchema = z.coerce.number().int().min(0).max(MAX_CATALOG_WINDOW).default(0);

function parseIdList(value: unknown, max = 100): number[] | null {
  if (value === undefined) return [];
  if (typeof value !== "string" || !/^[0-9,]{1,600}$/.test(value)) return null;
  const ids = value.split(",").map(Number);
  return ids.length <= max && ids.every((id) => Number.isSafeInteger(id) && id > 0)
    ? [...new Set(ids)]
    : null;
}

const filtersSchema = z.object({
  genre: z.string().trim().min(1).max(64).optional(),
  releaseYear: z.coerce.number().int().min(1950).max(2200).optional(),
});

function toCatalogGame(igdbGame: IgdbGame) {
  const game = igdbClient.formatGameData(igdbGame);
  return {
    id: `igdb-${String(game.igdbId)}`,
    igdbId: Number(game.igdbId),
    title: String(game.title ?? ""),
    summary: String(game.summary ?? ""),
    coverUrl: String(game.coverUrl ?? ""),
    releaseDate: String(game.releaseDate ?? ""),
    platforms: Array.isArray(game.platforms) ? game.platforms : [],
    platformOptions: Array.isArray(game.platformOptions) ? game.platformOptions : [],
    genres: Array.isArray(game.genres) ? game.genres : [],
    steamAppId:
      typeof game.steamAppId === "number" && Number.isSafeInteger(game.steamAppId)
        ? game.steamAppId
        : null,
    timeToBeat: null as { hastily?: number; normally?: number; completely?: number } | null,
  };
}

type CatalogGame = ReturnType<typeof toCatalogGame>;

function toCatalogGameDetail(igdbGame: IgdbGame) {
  const game: FormattedGame = igdbClient.formatGameData(igdbGame);
  const source = igdbGame as { videos?: Array<{ name?: string; video_id?: string }> };
  return {
    ...toCatalogGame(igdbGame),
    rating: typeof game.rating === "number" ? game.rating : null,
    publishers: Array.isArray(game.publishers) ? game.publishers.slice(0, 20) : [],
    developers: Array.isArray(game.developers) ? game.developers.slice(0, 20) : [],
    screenshots: Array.isArray(game.screenshots) ? game.screenshots.slice(0, 12) : [],
    videos: (Array.isArray(source.videos) ? source.videos : [])
      .filter(
        (video) =>
          video && typeof video.video_id === "string" && /^[A-Za-z0-9_-]{11}$/.test(video.video_id)
      )
      .slice(0, 6)
      .map((video) => ({ name: String(video.name ?? "").slice(0, 120), videoId: video.video_id })),
    platformReleaseDate: null as string | null,
  };
}

/** IGDB platform ids for Windows, Linux and macOS: the only targets this provider can acquire. */
const desktopPlatformIds = () => new Set(Object.values(TARGET_PLATFORMS).map(({ id }) => id));

/** Games with no platform data stay eligible; console-only titles are not acquirable here. */
function supportsDesktop(game: IgdbGame): boolean {
  const options = igdbClient.formatGameData(game).platformOptions;
  if (!Array.isArray(options) || options.length === 0) return true;
  return options.some((option) => desktopPlatformIds().has((option as { id?: number }).id ?? -1));
}

/**
 * The IGDB id a request resolves to (free-text titles take the top result, as quick-add does),
 * or null when that game has no desktop release. A missing game is left to quick-add to report.
 */
async function resolveDesktopMatch(
  title: string,
  igdbId?: number | null
): Promise<{ igdbId?: number } | null> {
  const found = igdbId
    ? await igdbClient.getGameById(igdbId)
    : (await igdbClient.searchGames(title, 1))[0];
  if (!found) return igdbId ? { igdbId } : {};
  if (!supportsDesktop(found)) return null;
  const resolved = Number(igdbClient.formatGameData(found).igdbId ?? igdbId ?? 0);
  return resolved > 0 ? { igdbId: resolved } : {};
}

/**
 * Drops adult/age-restricted titles the account's content filters hide everywhere else, and
 * titles that cannot be acquired for a desktop OS.
 */
async function visibleIgdbGames(userId: string, games: IgdbGame[]): Promise<IgdbGame[]> {
  const flags = await getContentFilterFlags(userId);
  return games.filter(
    (game) =>
      supportsDesktop(game) &&
      !isContentFiltered(
        igdbClient.formatGameData(game) as { isAdultContent?: boolean; isAgeRestricted?: boolean },
        flags
      )
  );
}

async function withTimeToBeats<T extends { igdbId: number }>(games: T[]) {
  if (games.length === 0) return games.map((game) => ({ ...game, timeToBeat: null }));
  try {
    const estimates = await igdbClient.getTimeToBeats(games.map((game) => game.igdbId));
    return games.map((game) => ({ ...game, timeToBeat: estimates.get(game.igdbId) ?? null }));
  } catch (error) {
    logger.warn({ error }, "SeerrNG time-to-beat lookup failed");
    return games.map((game) => ({ ...game, timeToBeat: null }));
  }
}

function matchesCatalogFilters(
  game: CatalogGame,
  filters: { platformIds: number[]; genre?: string | undefined; releaseYear?: number | undefined }
): boolean {
  if (filters.platformIds.length > 0) {
    const ids = game.platformOptions.map((option) => (option as { id?: number }).id);
    if (!filters.platformIds.some((id) => ids.includes(id))) return false;
  }
  if (filters.genre) {
    const wanted = filters.genre.toLocaleLowerCase();
    if (!game.genres.some((genre) => String(genre).toLocaleLowerCase() === wanted)) return false;
  }
  if (filters.releaseYear && !game.releaseDate.startsWith(String(filters.releaseYear))) {
    return false;
  }
  return true;
}

async function pagedCatalog(
  req: Request,
  fetchWindow: (windowSize: number) => Promise<IgdbGame[]>,
  offset: number
) {
  const limit = catalogLimitSchema.parse(req.query.limit ?? 20);
  const platformIds = parseIdList(req.query.platformIds);
  const filters = filtersSchema.safeParse(req.query);
  if (platformIds === null || !filters.success) throw new z.ZodError([]);
  // Filters can drop entries, so over-fetch and walk the visible list: the cursor is the index of
  // the first visible entry not yet returned.
  let windowSize = Math.min(offset + limit * 3 + 1, MAX_CATALOG_WINDOW);
  for (;;) {
    const raw = await fetchWindow(windowSize);
    const visible = (await visibleIgdbGames(req.user!.id, raw)).map(toCatalogGame);
    const page: CatalogGame[] = [];
    let index = offset;
    for (; index < visible.length && page.length < limit; index += 1) {
      const game = visible[index];
      if (game && matchesCatalogFilters(game, { platformIds, ...filters.data })) page.push(game);
    }
    const moreUpstream = raw.length >= windowSize && windowSize < MAX_CATALOG_WINDOW;
    // A window the filters emptied cannot move the cursor: widen it instead of repeating it.
    if (page.length === 0 && moreUpstream) {
      windowSize = Math.min(windowSize * 2, MAX_CATALOG_WINDOW);
      continue;
    }
    const hasMore = index < visible.length || moreUpstream;
    return { results: await withTimeToBeats(page), next: hasMore ? index : null };
  }
}

seerrngRouter.get("/ping", scope, (_req: Request, res: Response) => {
  res.json({
    service: "Questarr",
    version: APP_VERSION,
    apiVersion: SEERRNG_API_VERSION,
    requestContractVersion: SEERRNG_REQUEST_CONTRACT_VERSION,
    capabilities: {
      catalog: true,
      pcAcquisition: true,
      emulationAcquisition: false,
      requestActions: { retry: true, cancel: true },
      assetStreaming: true,
      assetBundles: true,
      editions: true,
      discover: true,
    },
  });
});

seerrngRouter.get("/catalog/search", scope, async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = catalogLimitSchema.safeParse(req.query.limit ?? 20);
  if (!query || query.length > 200 || !limit.success) {
    return res.status(400).json({ error: "A valid search query and limit are required." });
  }
  try {
    const found = await visibleIgdbGames(
      req.user!.id,
      await igdbClient.searchGames(query, limit.data)
    );
    return res.json(await withTimeToBeats(found.map(toCatalogGame)));
  } catch (error) {
    logger.error({ error }, "SeerrNG catalog search failed");
    return res.status(502).json({ error: "IGDB catalog search failed." });
  }
});

seerrngRouter.get("/catalog/search-page", scope, async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const cursor = req.query.cursor;
  const offset = cursor === undefined ? 0 : offsetSchema.safeParse(cursor);
  if (!query || query.length > 200 || (typeof offset === "object" && !offset.success)) {
    return res.status(400).json({ error: "A valid search query and cursor are required." });
  }
  try {
    const start = typeof offset === "number" ? offset : (offset as { data: number }).data;
    const page = await pagedCatalog(
      req,
      (windowSize) => igdbClient.searchGames(query, windowSize),
      start
    );
    return res.json({
      results: page.results,
      nextCursor: page.next === null ? null : String(page.next),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid catalog filters." });
    }
    logger.error({ error }, "SeerrNG paged catalog search failed");
    return res.status(502).json({ error: "IGDB catalog search failed." });
  }
});

seerrngRouter.get("/catalog/popular", scope, async (req: Request, res: Response) => {
  const limit = catalogLimitSchema.safeParse(req.query.limit ?? 20);
  if (!limit.success) return res.status(400).json({ error: "A valid limit is required." });
  try {
    const found = await visibleIgdbGames(
      req.user!.id,
      await igdbClient.getPopularGames(limit.data)
    );
    return res.json(await withTimeToBeats(found.map(toCatalogGame)));
  } catch (error) {
    logger.error({ error }, "SeerrNG popular catalog fetch failed");
    return res.status(502).json({ error: "IGDB popular games are unavailable." });
  }
});

seerrngRouter.get("/catalog/popular-page", scope, async (req: Request, res: Response) => {
  const offset = offsetSchema.safeParse(req.query.offset ?? 0);
  if (!offset.success) return res.status(400).json({ error: "A valid offset is required." });
  try {
    const page = await pagedCatalog(
      req,
      (windowSize) => igdbClient.getPopularGames(windowSize),
      offset.data
    );
    return res.json({ results: page.results, nextOffset: page.next });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid catalog filters." });
    }
    logger.error({ error }, "SeerrNG paged popular catalog fetch failed");
    return res.status(502).json({ error: "IGDB popular games are unavailable." });
  }
});

seerrngRouter.get("/catalog/platforms", scope, async (_req: Request, res: Response) => {
  try {
    return res.json(await igdbClient.getPlatforms());
  } catch (error) {
    logger.error({ error }, "SeerrNG platform catalog fetch failed");
    return res.status(502).json({ error: "IGDB platforms are unavailable." });
  }
});

seerrngRouter.get("/catalog/games/:igdbId", scope, async (req: Request, res: Response) => {
  const igdbId = z.coerce.number().int().positive().safeParse(req.params.igdbId);
  if (!igdbId.success) return res.status(400).json({ error: "A valid IGDB ID is required." });
  try {
    const game = await igdbClient.getGameById(igdbId.data);
    const [visible] = game ? await visibleIgdbGames(req.user!.id, [game]) : [];
    if (!visible) return res.status(404).json({ error: "Game not found." });
    const [detail] = await withTimeToBeats([toCatalogGameDetail(visible)]);
    return res.json(detail);
  } catch (error) {
    logger.error({ error, igdbId: igdbId.data }, "SeerrNG catalog game fetch failed");
    return res.status(502).json({ error: "IGDB game details are unavailable." });
  }
});

// ── Editions and discovery (contract v2.1) ───────────────────────────────────

type ContentType =
  "expansion" | "dlc" | "cosmetic" | "season-pass" | "bonus" | "soundtrack" | "unknown";

/** IGDB game_type 14 is an update/patch, which is never content a user requests. */
const IGDB_UPDATE_GAME_TYPE = 14;

function contentTypeOf(ref: IGDBContentRef): ContentType {
  const name = ref.name.toLocaleLowerCase();
  if (/\bsoundtrack\b|\bost\b/.test(name)) return "soundtrack";
  if (/season pass/.test(name)) return "season-pass";
  if (/\b(skin|costume|outfit|cosmetic)s?\b/.test(name)) return "cosmetic";
  if (/\b(bonus|pre-?order|digital extras?)\b/.test(name)) return "bonus";
  switch (ref.game_type) {
    case 2:
    case 4:
      return "expansion";
    case 1:
    case 6:
      return "dlc";
    case 7:
      return "season-pass";
    case 13:
      return "bonus";
    default:
      return "unknown";
  }
}

/** Story content is only claimed for what IGDB calls an expansion; cosmetics and extras never are. */
function storyContentOf(type: ContentType): boolean | null {
  if (type === "expansion") return true;
  if (type === "cosmetic" || type === "soundtrack" || type === "bonus") return false;
  return null;
}

function linkedContent(game: IGDBGameContent, flags: ContentFilterFlags): IGDBContentRef[] {
  const seen = new Set<number>();
  return [...(game.expansions ?? []), ...(game.dlcs ?? []), ...(game.standalone_expansions ?? [])]
    .filter((ref) => ref.game_type !== IGDB_UPDATE_GAME_TYPE)
    .filter((ref) => !isContentFiltered(igdbClient.contentFlags(ref), flags))
    .filter((ref) => !seen.has(ref.id) && seen.add(ref.id));
}

const coverUrlOf = (url?: string) =>
  url ? `https:${url.replace("t_thumb", "t_cover_big")}` : undefined;

const isoDate = (seconds?: number) =>
  seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : undefined;

/** Library games the account already has, keyed by IGDB id. */
async function libraryByIgdbId(userId: string): Promise<Map<number, Game>> {
  const games = await storage.getUserGames(userId, true);
  return new Map(games.filter((game) => game.igdbId != null).map((game) => [game.igdbId!, game]));
}

const isOwned = (game: Game | undefined) =>
  game !== undefined && (ACQUIRED_GAME_STATUSES as readonly string[]).includes(game.status);

function toGameContent(ref: IGDBContentRef, library: Map<number, Game>) {
  const type = contentTypeOf(ref);
  const releaseDate = isoDate(ref.first_release_date);
  const coverUrl = coverUrlOf(ref.cover?.url);
  return {
    igdbId: ref.id,
    title: ref.name,
    type,
    storyContent: storyContentOf(type),
    ...(releaseDate ? { releaseDate } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    owned: isOwned(library.get(ref.id)),
  };
}

seerrngRouter.get("/catalog/games/:igdbId/editions", scope, async (req: Request, res: Response) => {
  const igdbId = z.coerce.number().int().positive().safeParse(req.params.igdbId);
  if (!igdbId.success) return res.status(400).json({ error: "A valid IGDB ID is required." });
  try {
    const { base, editions } = await igdbClient.getGameEditions(igdbId.data);
    const game = base ? await igdbClient.getGameById(base.id) : null;
    const [visible] = game ? await visibleIgdbGames(req.user!.id, [game]) : [];
    if (!base || !visible) return res.status(404).json({ error: "Game not found." });
    const library = await libraryByIgdbId(req.user!.id);
    const flags = await getContentFilterFlags(req.user!.id);
    const owner = library.get(base.id);
    return res.json({
      base: {
        igdbId: base.id,
        title: base.name,
        owned: isOwned(owner),
        ...(owner ? { status: owner.status } : {}),
      },
      editions: editions
        .filter((edition) => !isContentFiltered(igdbClient.contentFlags(edition), flags))
        .map((edition) => {
          const includes = linkedContent(edition, flags).map((ref) => toGameContent(ref, library));
          const releaseDate = isoDate(edition.first_release_date);
          return {
            igdbId: edition.id,
            title: edition.name,
            ...(edition.summary ? { summary: edition.summary } : {}),
            ...(releaseDate ? { releaseDate } : {}),
            includes,
            contentKnown: includes.length > 0,
            owned: isOwned(library.get(edition.id)),
          };
        }),
      addons: linkedContent(base, flags).map((ref) => toGameContent(ref, library)),
    });
  } catch (error) {
    logger.error({ error, igdbId: igdbId.data }, "SeerrNG editions fetch failed");
    return res.status(502).json({ error: "IGDB edition details are unavailable." });
  }
});

const discoverQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  minYear: z.coerce.number().int().min(1970).max(2200).optional(),
  maxHoursToBeat: z.coerce.number().positive().max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  cursor: z
    .string()
    .regex(/^\d{1,4}$/)
    .optional(),
});

seerrngRouter.get("/catalog/discover", scope, async (req: Request, res: Response) => {
  const parsed = discoverQuerySchema.safeParse(req.query);
  const lists = Object.fromEntries(
    [
      "themes",
      "gameModes",
      "perspectives",
      "genres",
      "languages",
      "excludeThemes",
      "excludeGameModes",
      "excludeGenres",
    ].map((key) => [key, parseIdList(req.query[key], 30)])
  );
  if (!parsed.success || Object.values(lists).includes(null)) {
    return res.status(400).json({ error: "Invalid discovery filters." });
  }
  const { q, minYear, maxHoursToBeat, limit, cursor } = parsed.data;
  const offset = cursor ? Number(cursor) : 0;
  if (offset > MAX_DISCOVER_OFFSET) {
    return res.status(400).json({ error: "Invalid discovery filters." });
  }
  try {
    const raw = await igdbClient.discoverGames(
      { query: q, minYear, ...(lists as Record<string, number[]>) } as DiscoverFilters,
      limit,
      offset
    );
    const visible = await visibleIgdbGames(req.user!.id, raw);
    const facets = new Map(raw.map((game) => [game.id, game]));
    let results = await withTimeToBeats(visible.map(toCatalogGame));
    if (maxHoursToBeat !== undefined) {
      results = results.filter(
        (game) =>
          game.timeToBeat?.normally !== undefined && game.timeToBeat.normally <= maxHoursToBeat
      );
    }
    return res.json({
      results: results.map((game) => {
        const source = facets.get(game.igdbId);
        return {
          ...game,
          themes: (source?.themes ?? []).map((theme) => theme.name),
          gameModes: (source?.game_modes ?? []).map((mode) => mode.name),
          perspectives: (source?.player_perspectives ?? []).map((view) => view.name),
        };
      }),
      nextCursor:
        raw.length >= limit && offset + limit <= MAX_DISCOVER_OFFSET
          ? String(offset + limit)
          : null,
    });
  } catch (error) {
    logger.error({ error }, "SeerrNG discovery failed");
    return res.status(502).json({ error: "IGDB discovery is unavailable." });
  }
});

// ── Library ──────────────────────────────────────────────────────────────────

seerrngRouter.get("/library/lookup", scope, async (req: Request, res: Response) => {
  const igdbIds = parseIdList(req.query.igdbIds);
  if (!igdbIds || igdbIds.length === 0) {
    return res.status(400).json({ error: "Provide up to 100 IGDB IDs." });
  }
  try {
    const wanted = new Set(igdbIds);
    const userId = req.user!.id;
    const flags = await getContentFilterFlags(userId);
    const games = (await storage.getUserGames(userId, true)).filter(
      (game) =>
        game.igdbId != null &&
        wanted.has(game.igdbId) &&
        !isContentFiltered(game as { isAdultContent?: boolean; isAgeRestricted?: boolean }, flags)
    );
    return res.json({
      games: await Promise.all(
        games.map(async (game) => ({
          igdbId: game.igdbId,
          status: game.status,
          deliverable: (await listAssets(userId, game.id)).length > 0,
        }))
      ),
    });
  } catch (error) {
    logger.error({ error }, "SeerrNG library lookup failed");
    return res.status(500).json({ error: "Library lookup failed." });
  }
});

// ── Assets ───────────────────────────────────────────────────────────────────

interface Asset {
  id: string;
  name: string;
  size: number;
  path: string;
}

/**
 * Files registered to a game that still exist inside the account's library
 * root or an enabled root folder. A stale import row, a symlink pointing out of
 * the library, or a removed file is simply not deliverable.
 */
async function listAssets(userId: string, gameId: string): Promise<Asset[]> {
  const [files, importConfig, rootFolders] = await Promise.all([
    storage.getGameFiles(gameId),
    storage.getImportConfig(userId),
    storage.getEnabledRootFolders(),
  ]);
  const roots = [importConfig.libraryRoot, ...rootFolders.map((folder) => folder.path)].filter(
    Boolean
  );
  if (roots.length === 0) return [];
  const assets: Asset[] = [];
  for (const file of files.slice(0, MAX_ASSETS)) {
    try {
      await assertWithinRoots(file.filePath, roots, "outside library");
      const realPath = await fs.realpath(file.filePath);
      await assertWithinRoots(realPath, roots, "outside library");
      const stats = await fs.stat(realPath);
      if (!stats.isFile()) continue;
      assets.push({
        id: file.id,
        name: path.basename(file.originalName || file.storedName || realPath),
        size: stats.size,
        path: realPath,
      });
    } catch {
      // Not deliverable: skipped on purpose.
    }
  }
  return assets;
}

function safeBaseName(value: string): string {
  const cleaned = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /[\\/:*?"<>|]/.test(character) || codePoint < 0x20 || codePoint === 0x7f
      ? "_"
      : character;
  })
    .join("")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return cleaned || "game";
}

function safeArchiveEntryName(name: string, index: number, used: Set<string>): string {
  const basename = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/\p{Cc}/gu, "")
    .trim();
  const original =
    basename && basename !== "." && basename !== ".." ? basename : `asset-${index + 1}`;
  let candidate = original;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase("en-US"))) {
    const extension = path.extname(original);
    const stem = extension ? original.slice(0, -extension.length) : original;
    candidate = `${stem} (${suffix++})${extension}`;
  }
  used.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

// ── Requests ─────────────────────────────────────────────────────────────────

const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
  );

const variantSchema = z.object({
  operatingSystem: z.enum(SEERRNG_OPERATING_SYSTEMS),
  architecture: z.enum(SEERRNG_ARCHITECTURES),
});

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({
    kind: z.literal("game-content"),
    mode: z.literal("edition"),
    editionId: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("game-content"),
    mode: z.literal("missing-selected"),
    addonIds: z.array(z.number().int().positive()).max(30),
  }),
]);

const createRequestSchema = z.object({
  externalRequestId: requestIdSchema,
  title: z.string().trim().min(1).max(500),
  igdbId: z.number().int().positive().optional(),
  variant: variantSchema,
  selection: selectionSchema.optional(),
});

/** Canonical form (sorted, de-duplicated ids) so a replay compares equal to the stored value. */
function normalizeSelection(
  selection: z.infer<typeof selectionSchema> | undefined
): IntegrationRequestSelection | null {
  if (!selection) return null;
  if (selection.mode === "edition") return selection;
  return { ...selection, addonIds: [...new Set(selection.addonIds)].sort((a, b) => a - b) };
}

function storedSelection(ledger: IntegrationRequest): IntegrationRequestSelection | null {
  if (!ledger.selection) return null;
  try {
    return normalizeSelection(selectionSchema.parse(JSON.parse(ledger.selection)));
  } catch {
    return null;
  }
}

const confirmationSchema = z
  .object({ confirmNoExistingDownload: z.boolean().optional() })
  .passthrough();

/**
 * IGDB platform the release search should target for each OS. Questarr's
 * release search filters on the game's target platform (explicit Linux/Mac
 * markers are required there, an unmarked release counts as Windows).
 * Architecture is recorded but not used to filter releases.
 */
const TARGET_PLATFORMS: Record<SeerrngOperatingSystem, { id: number; name: string }> = {
  windows: { id: 6, name: "PC (Microsoft Windows)" },
  linux: { id: 3, name: "Linux" },
  macos: { id: 14, name: "Mac" },
};

type RequestStatus =
  "accepted" | "searching" | "downloading" | "importing" | "available" | "failed" | "cancelled";

/** Ledger note on a cancelled request whose game has not been shelved yet. */
const CANCEL_PENDING_MARKER = "cancellation-pending";

const ACTIVE_DOWNLOAD_STATUSES = new Set(["downloading", "queued", "paused"]);
const IMPORTING_DOWNLOAD_STATUSES = new Set([
  "completed",
  "completed_pending_import",
  "unpacking",
  "manual_review_required",
  "game_link_required",
]);
const FAILED_DOWNLOAD_STATUSES = new Set(["failed", "error", "quarantined"]);

const isAcquired = (game: Game) =>
  (ACQUIRED_GAME_STATUSES as readonly string[]).includes(game.status);

async function findGame(userId: string, ledger: IntegrationRequest): Promise<Game | undefined> {
  if (!ledger.gameId) return undefined;
  const game = await storage.getGame(ledger.gameId);
  return game?.userId === userId ? game : undefined;
}

/** IGDB ids stored under a key of the request's selection JSON (add-on bookkeeping). */
function storedAddonIds(ledger: IntegrationRequest, key: "queuedAddonIds" | "shelvedAddonIds") {
  try {
    const parsed = z
      .object({ [key]: z.array(z.number().int().positive()).max(30) })
      .safeParse(JSON.parse(ledger.selection ?? "null"));
    return parsed.success ? (parsed.data[key] as number[]) : [];
  } catch {
    return [];
  }
}

/** IGDB ids of the add-ons this request itself added to the library. */
const queuedAddonIds = (ledger: IntegrationRequest) => storedAddonIds(ledger, "queuedAddonIds");

/** IGDB ids of the add-ons this request shelved when it was cancelled. */
const shelvedAddonIds = (ledger: IntegrationRequest) => storedAddonIds(ledger, "shelvedAddonIds");

/**
 * Wants an add-on again that a cancelled request shelved (and nothing else did), so a new
 * request for the same content is not left on a game auto-search skips. A game the user shelved
 * by hand is not in any cancelled request's list and keeps its state.
 */
async function reviveShelvedAddon(userId: string, addon: Game, igdbId: number): Promise<boolean> {
  if (addon.status !== "shelved") return false;
  const cancelled = await storage.getCancelledIntegrationRequests(userId);
  const shelver = cancelled.find((candidate) => shelvedAddonIds(candidate).includes(igdbId));
  if (!shelver) return false;
  await storage.updateGameStatus(addon.id, { status: "wanted" });
  const remaining = shelvedAddonIds(shelver).filter((id) => id !== igdbId);
  await storage.updateIntegrationRequest(userId, shelver.externalRequestId, {
    selection: JSON.stringify({
      ...JSON.parse(shelver.selection ?? "{}"),
      shelvedAddonIds: remaining,
    }),
  });
  return true;
}

/**
 * What is still outstanding for an edition or add-on request. An edition is the linked game
 * itself; add-ons are separate library games matched by IGDB id.
 */
async function describeContent(userId: string, ledger: IntegrationRequest, game?: Game) {
  const selection = storedSelection(ledger);
  if (!selection) return undefined;
  if (selection.mode === "edition") {
    const acquired = game !== undefined && isAcquired(game);
    return {
      mode: selection.mode,
      pending: acquired ? [] : [{ id: selection.editionId, title: game?.title ?? ledger.title }],
      acquiredCount: acquired ? 1 : 0,
    };
  }
  const library = await libraryByIgdbId(userId);
  const pending = selection.addonIds
    .filter((id) => !isOwned(library.get(id)))
    .map((id) => ({ id, title: library.get(id)?.title ?? `Add-on ${String(id)}` }));
  return {
    mode: selection.mode,
    pending,
    acquiredCount: selection.addonIds.length - pending.length,
  };
}

/**
 * The request as SeerrNG sees it. Status is derived from the linked game, its
 * downloads and its registered files on every read, so it can never drift from
 * what Questarr actually did; only a cancellation is remembered in the ledger.
 */
async function describeRequest(userId: string, ledger: IntegrationRequest) {
  const game = await findGame(userId, ledger);
  const variant =
    ledger.operatingSystem && ledger.architecture
      ? { operatingSystem: ledger.operatingSystem, architecture: ledger.architecture }
      : undefined;
  const identity = ledger.igdbId
    ? { catalogProvider: "igdb" as const, catalogId: ledger.igdbId }
    : undefined;

  let status: RequestStatus;
  let error: string | null = null;
  let deliverable = false;

  if (ledger.status === "cancelled") {
    status = "cancelled";
  } else if (!game) {
    // "accepted" is only legitimate while dispatch is still creating the game; a request that
    // had reached "searching" and lost its game (deleted from the library) is retryable.
    const lostGame = ledger.status === "searching";
    status = ledger.status === "failed" || lostGame ? "failed" : "accepted";
    if (lostGame) error = "The game was removed from the library.";
    else if (ledger.status === "failed") error = ledger.errorMessage;
  } else {
    const [assets, downloads] = await Promise.all([
      listAssets(userId, game.id),
      storage.getDownloadsByGameId(game.id),
    ]);
    deliverable = assets.length > 0;
    const latest = [...downloads].sort(
      (a, b) => (b.addedAt?.getTime() ?? 0) - (a.addedAt?.getTime() ?? 0)
    )[0];
    const downloadStatus = latest?.status.toLowerCase() ?? "";
    // A failure older than the last ledger update (a retry) must not mask the new attempt.
    const failedBeforeRetry =
      ledger.status === "searching" &&
      !!latest?.addedAt &&
      !!ledger.updatedAt &&
      latest.addedAt.getTime() < ledger.updatedAt.getTime();
    const activeDownload = downloads.some((download) =>
      ACTIVE_DOWNLOAD_STATUSES.has(download.status.toLowerCase())
    );
    if (hasAddonFailure(ledger)) {
      // Add-ons that never got queued must stay visible (and retryable) behind an owned base game.
      status = "failed";
      error = ledger.errorMessage;
    } else if (deliverable || isAcquired(game)) {
      status = "available";
    } else if (activeDownload) {
      status = "downloading";
    } else if (IMPORTING_DOWNLOAD_STATUSES.has(downloadStatus)) {
      status = "importing";
    } else if (
      (FAILED_DOWNLOAD_STATUSES.has(downloadStatus) && !failedBeforeRetry) ||
      ledger.status === "failed"
    ) {
      status = "failed";
      error = latest?.errorMessage ?? ledger.errorMessage ?? "No usable release was found.";
    } else if (game.status === "downloading") {
      status = "downloading";
    } else {
      status = game.status === "wanted" ? "searching" : "accepted";
    }
  }

  const content = await describeContent(userId, ledger, game);

  return {
    externalRequestId: ledger.externalRequestId,
    status,
    deliverable,
    error: status === "failed" ? (error ?? "The request failed.") : null,
    title: game?.title ?? ledger.title,
    ...(variant ? { variant } : {}),
    ...(game ? { game: { id: game.id, title: game.title, status: game.status } } : {}),
    ...(identity ? { identity } : {}),
    ...(content ? { content } : {}),
    actions: {
      retry: status === "failed",
      cancel: !["available", "cancelled"].includes(status),
    },
  };
}

/**
 * Requests of one user share a single queue: an exact-ID request and a title-only one can resolve
 * to the same game, and the games table has no unique constraint to catch the second insert.
 */
const dispatchKey = (userId: string | number) => `${userId}:requests`;

/** Per-key queue so two concurrent requests for one game cannot both add it. */
const dispatchQueues = new Map<string, Promise<void>>();
async function withDispatchQueue<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = dispatchQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  dispatchQueues.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (dispatchQueues.get(key) === current) dispatchQueues.delete(key);
  }
}

/**
 * Attaches a request to a game that is already in the library. Another live request owning it
 * is a conflict (returns undefined); a cancelled one is released. Unacquired games are retargeted
 * to the requested OS so auto-search looks for the right release.
 */
function attachExistingGame(
  userId: string,
  externalRequestId: string,
  owner: Game,
  operatingSystem: keyof typeof TARGET_PLATFORMS
): Promise<IntegrationRequest | undefined> {
  // Serialized per game so two requests cannot both observe "no holder".
  return withDispatchQueue(`${userId}:game:${owner.id}`, () =>
    attachExistingGameLocked(userId, externalRequestId, owner, operatingSystem)
  );
}

async function attachExistingGameLocked(
  userId: string,
  externalRequestId: string,
  owner: Game,
  operatingSystem: keyof typeof TARGET_PLATFORMS
): Promise<IntegrationRequest | undefined> {
  let releasedCancelled = false;
  const holder = await storage.getIntegrationRequestByGameId(userId, owner.id);
  if (holder && holder.externalRequestId !== externalRequestId) {
    if (holder.status !== "cancelled") {
      await storage.updateIntegrationRequest(userId, externalRequestId, {
        status: "failed",
        errorMessage: "Game is already linked to another request.",
      });
      return undefined;
    }
    await storage.updateIntegrationRequest(userId, holder.externalRequestId, { gameId: null });
    releasedCancelled = true;
  }
  let claimed: IntegrationRequest | undefined;
  let unshelved = false;
  try {
    // Claim the game in the ledger first: the live-game unique index rejects a concurrent claim
    // here, before this request has touched the game's status or target platform.
    claimed = await storage.updateIntegrationRequest(userId, externalRequestId, {
      gameId: owner.id,
      status: "searching",
      errorMessage: null,
    });
    if (releasedCancelled && owner.status === "shelved") {
      // Our cancellation shelved the game; a new request wants it again. A game the user
      // shelved by hand is a curated, owned entry and keeps its state.
      await storage.updateGameStatus(owner.id, { status: "wanted" });
      owner = { ...owner, status: "wanted" };
      unshelved = true;
    }
    const platform = TARGET_PLATFORMS[operatingSystem];
    if (!isAcquired(owner) && owner.targetPlatformId !== platform.id) {
      await storage.updateGame(owner.id, {
        targetPlatformId: platform.id,
        targetPlatformName: platform.name,
      });
    }
  } catch (error) {
    // Undo the game and the cancelled holder first, while this request still holds the claim: the
    // live-game index then keeps a concurrent request off the game until the rollback is complete.
    if (releasedCancelled && holder) {
      if (unshelved) {
        // Put the game back on the shelf so auto-search ignores it and a retry un-shelves it again.
        await storage.updateGameStatus(owner.id, { status: "shelved" }).catch(() => undefined);
      }
      // Give the cancelled holder its game back so a retry takes the un-shelve path again.
      await storage
        .updateIntegrationRequest(userId, holder.externalRequestId, { gameId: owner.id })
        .catch(() => undefined);
    }
    // Release the claim last so a retry re-runs the retargeting instead of resuming on the old platform.
    await storage
      .updateIntegrationRequest(userId, externalRequestId, { gameId: null })
      .catch(() => undefined);
    throw error;
  }
  return claimed;
}

/**
 * Adds the selected add-ons the library does not know yet as wanted games and remembers which ones
 * this request created, so cancelling it never shelves a game someone else wanted. Returns how
 * many add-ons could not be queued; a retry runs this again for them.
 */
async function queueAddons(
  userId: string,
  ledger: IntegrationRequest,
  addons: IGDBContentRef[],
  operatingSystem: keyof typeof TARGET_PLATFORMS
): Promise<number> {
  const selection = storedSelection(ledger);
  if (addons.length === 0 || selection?.mode !== "missing-selected") return 0;
  const library = await libraryByIgdbId(userId);
  const queued = queuedAddonIds(ledger);
  let failed = 0;
  for (const addon of addons) {
    const existing = library.get(addon.id);
    if (existing) {
      if (!queued.includes(addon.id)) {
        try {
          if (await reviveShelvedAddon(userId, existing, addon.id)) queued.push(addon.id);
        } catch (error) {
          failed++;
          logger.warn({ error, igdbId: addon.id }, "SeerrNG add-on could not be wanted again");
        }
      }
      continue;
    }
    try {
      const result = await quickAddGameByTitle(userId, addon.name, {
        status: "wanted",
        source: "api",
        targetPlatform: TARGET_PLATFORMS[operatingSystem],
        igdbId: addon.id,
      });
      if (result.outcome === "added") queued.push(addon.id);
      else if (result.outcome === "not_found") failed++;
    } catch (error) {
      failed++;
      logger.warn({ error, igdbId: addon.id }, "SeerrNG add-on could not be queued");
    }
  }
  if (queued.length > queuedAddonIds(ledger).length) {
    await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
      selection: JSON.stringify({ ...selection, queuedAddonIds: queued }),
    });
  }
  return failed;
}

const ADDON_FAILURE_MESSAGE = "Some add-ons could not be queued. Retry to queue them again.";

const hasAddonFailure = (ledger: IntegrationRequest) =>
  ledger.status === "failed" && ledger.errorMessage === ADDON_FAILURE_MESSAGE;

/** An incomplete add-on queue leaves the request failed, which is what makes it retryable. */
async function flagIncompleteAddons(userId: string, ledger: IntegrationRequest, failed: number) {
  if (failed === 0) return ledger;
  const updated = await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
    status: "failed",
    errorMessage: ADDON_FAILURE_MESSAGE,
  });
  return updated ?? ledger;
}

/**
 * The selected add-ons IGDB still links to the base game. A selected add-on that cannot be
 * resolved (IGDB unavailable, link gone) and is not in the library counts as failed.
 */
async function resolveSelectedAddons(
  userId: string,
  ledger: IntegrationRequest
): Promise<{ addons: IGDBContentRef[]; unresolved: number }> {
  const selection = storedSelection(ledger);
  if (selection?.mode !== "missing-selected" || !ledger.igdbId)
    return { addons: [], unresolved: 0 };
  const { base } = await igdbClient.getGameEditions(ledger.igdbId);
  const wanted = new Set(selection.addonIds);
  const addons = base
    ? linkedContent(base, await getContentFilterFlags(userId)).filter((ref) => wanted.has(ref.id))
    : [];
  const library = await libraryByIgdbId(userId);
  const resolved = new Set(addons.map((ref) => ref.id));
  const unresolved = selection.addonIds.filter((id) => !resolved.has(id) && !library.has(id));
  return { addons, unresolved: unresolved.length };
}

seerrngRouter.post("/requests", scope, async (req: Request, res: Response) => {
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid software request payload." });
  }
  const { externalRequestId, title, igdbId, variant } = parsed.data;
  const selection = normalizeSelection(parsed.data.selection);
  const userId = req.user!.id;
  return withDispatchQueue(dispatchKey(userId), async () => {
    try {
      const { request: ledger, created } = await storage.addIntegrationRequest({
        userId,
        externalRequestId,
        title,
        igdbId: igdbId ?? null,
        operatingSystem: variant.operatingSystem,
        architecture: variant.architecture,
        selection: selection ? JSON.stringify(selection) : null,
      });

      if (!created) {
        const sameRequest =
          ledger.title === title &&
          ledger.operatingSystem === variant.operatingSystem &&
          ledger.architecture === variant.architecture &&
          (ledger.igdbId ?? null) === (igdbId ?? null) &&
          JSON.stringify(storedSelection(ledger)) === JSON.stringify(selection);
        if (!sameRequest) {
          return res
            .status(409)
            .json({ error: "externalRequestId is already bound to a different request." });
        }
        return res.status(200).json(await describeRequest(userId, ledger));
      }

      const rejectRequest = async (status: 400 | 404, message: string) => {
        await storage.updateIntegrationRequest(userId, externalRequestId, {
          status: "failed",
          errorMessage: message,
        });
        return res.status(status).json({ error: message });
      };

      // A selection is checked against what IGDB links to the base game: an edition becomes the
      // game to acquire, add-ons are queued next to the base game.
      let target = { title, igdbId };
      let addons: IGDBContentRef[] = [];
      if (selection) {
        if (!igdbId) return rejectRequest(400, "A content selection needs an IGDB id.");
        const { base, editions } = await igdbClient.getGameEditions(igdbId);
        if (!base) return rejectRequest(404, "No matching PC game was found.");
        if (selection.mode === "edition") {
          const flags = await getContentFilterFlags(userId);
          const edition = editions.find(
            (candidate) =>
              candidate.id === selection.editionId &&
              !isContentFiltered(igdbClient.contentFlags(candidate), flags)
          );
          if (!edition)
            return rejectRequest(400, "The selected edition does not belong to the game.");
          target = { title: edition.name, igdbId: edition.id };
        } else {
          const flags = await getContentFilterFlags(userId);
          const linked = new Map(linkedContent(base, flags).map((ref) => [ref.id, ref]));
          const unknown = selection.addonIds.filter((id) => !linked.has(id));
          if (unknown.length > 0) {
            return rejectRequest(400, "A selected add-on does not belong to the game.");
          }
          addons = selection.addonIds.map((id) => linked.get(id)!);
        }
      }

      // An exact IGDB id bypasses the catalog filters, and a title takes whatever ranks first:
      // refuse both when the game has no desktop release.
      const match = await resolveDesktopMatch(target.title, target.igdbId);
      if (!match) return rejectRequest(404, "No matching PC game was found.");

      const result = await quickAddGameByTitle(userId, target.title, {
        status: "wanted",
        source: "api",
        targetPlatform: TARGET_PLATFORMS[variant.operatingSystem],
        ...(match.igdbId ? { igdbId: match.igdbId } : {}),
      });

      if (result.outcome === "not_found") {
        return rejectRequest(404, "No matching PC game was found.");
      }

      if (result.outcome === "duplicate") {
        const linked = await attachExistingGame(
          userId,
          externalRequestId,
          result.game,
          variant.operatingSystem
        );
        if (!linked) {
          return res.status(409).json({ error: "Game is already linked to another request." });
        }
        const failed = await queueAddons(userId, linked, addons, variant.operatingSystem);
        return res
          .status(201)
          .json(await describeRequest(userId, await flagIncompleteAddons(userId, linked, failed)));
      }

      const linked = await storage.updateIntegrationRequest(userId, externalRequestId, {
        gameId: result.game.id,
        status: "searching",
        errorMessage: null,
      });
      const failed = await queueAddons(userId, linked ?? ledger, addons, variant.operatingSystem);
      return res
        .status(201)
        .json(
          await describeRequest(
            userId,
            await flagIncompleteAddons(userId, linked ?? ledger, failed)
          )
        );
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Another process claimed the game between our holder check and this write.
        await storage
          .updateIntegrationRequest(userId, externalRequestId, {
            status: "failed",
            errorMessage: "Game is already linked to another request.",
          })
          .catch(() => undefined);
        return res.status(409).json({ error: "Game is already linked to another request." });
      }
      logger.error({ error, externalRequestId }, "SeerrNG software request failed");
      // Leave the ledger row retryable instead of stuck in "accepted" with no game.
      await storage
        .updateIntegrationRequest(userId, externalRequestId, {
          status: "failed",
          errorMessage: "Software request could not be started.",
        })
        .catch(() => undefined);
      return res.status(500).json({ error: "Software request could not be started." });
    }
  });
});

/**
 * SQLite and Postgres report a unique-index violation with different shapes, and Drizzle wraps
 * the driver error (code and message sit on `cause`); accept both.
 */
function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some((candidate) => {
    const { code, message } = (candidate ?? {}) as { code?: unknown; message?: unknown };
    return (
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      code === "23505" ||
      (typeof message === "string" && /UNIQUE constraint failed|duplicate key value/i.test(message))
    );
  });
}

async function loadRequest(req: Request, res: Response): Promise<IntegrationRequest | undefined> {
  const externalRequestId = requestIdSchema.safeParse(req.params.externalRequestId);
  if (!externalRequestId.success) {
    res.status(400).json({ error: "Invalid request ID." });
    return undefined;
  }
  const ledger = await storage.getIntegrationRequest(req.user!.id, externalRequestId.data);
  if (!ledger) {
    res.status(404).json({ error: "Request not found." });
    return undefined;
  }
  return ledger;
}

type RequestActionContext = {
  userId: string;
  ledger: IntegrationRequest;
  current: Awaited<ReturnType<typeof describeRequest>>;
};

/** Shared prelude of the retry/cancel actions: confirmation body, ledger lookup, current status. */
function requestAction(
  confirmationError: string,
  failureError: string,
  logMessage: string,
  action: (ctx: RequestActionContext, res: Response) => Promise<unknown>
) {
  return async (req: Request, res: Response) => {
    if (!confirmationSchema.safeParse(req.body ?? {}).success) {
      return res.status(400).json({ error: confirmationError });
    }
    try {
      const ledger = await loadRequest(req, res);
      if (!ledger) return undefined;
      const userId = req.user!.id;
      // Same queue as request creation: retries cannot race each other or a new request.
      return await withDispatchQueue(dispatchKey(userId), async () => {
        // Reload inside the queue so the guards see what the previous action left behind.
        const fresh =
          (await storage.getIntegrationRequest(userId, ledger.externalRequestId)) ?? ledger;
        return action(
          { userId, ledger: fresh, current: await describeRequest(userId, fresh) },
          res
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: "Game is already linked to another request." });
      }
      logger.error({ error }, logMessage);
      return res.status(500).json({ error: failureError });
    }
  };
}

seerrngRouter.get("/requests/:externalRequestId", scope, async (req: Request, res: Response) => {
  try {
    const ledger = await loadRequest(req, res);
    if (!ledger) return undefined;
    return res.json(await describeRequest(req.user!.id, ledger));
  } catch (error) {
    logger.error({ error }, "SeerrNG software request status failed");
    return res.status(500).json({ error: "Request status is unavailable." });
  }
});

seerrngRouter.post(
  "/requests/:externalRequestId/retry",
  scope,
  requestAction(
    "Invalid retry confirmation.",
    "Request could not be retried.",
    "SeerrNG software request retry failed",
    async ({ userId, ledger, current }, res) => {
      if (current.status === "cancelled") {
        return res.status(409).json({ error: "Cancelled requests cannot be retried." });
      }
      if (current.status === "available") {
        return res.status(409).json({ error: "The game is already available." });
      }
      if (["downloading", "importing"].includes(current.status)) {
        return res
          .status(409)
          .json({ error: "Another acquisition operation is already in progress." });
      }

      let game = await findGame(userId, ledger);
      // Only the add-on queue failed: the base game is left exactly as it is.
      const addonsOnly = game !== undefined && hasAddonFailure(ledger);
      if (!game) {
        // The game was deleted (or never created): add it again from the ledger. An edition
        // request acquires the edition, not the base game the ledger title and id name.
        const selection = storedSelection(ledger);
        let target = { title: ledger.title, igdbId: ledger.igdbId };
        if (selection?.mode === "edition") {
          // The same check as on creation: a rejected selection must not be retried into
          // acquiring an arbitrary IGDB game.
          const { editions } = ledger.igdbId
            ? await igdbClient.getGameEditions(ledger.igdbId)
            : { editions: [] };
          const flags = await getContentFilterFlags(userId);
          const edition = editions.find(
            (candidate) =>
              candidate.id === selection.editionId &&
              !isContentFiltered(igdbClient.contentFlags(candidate), flags)
          );
          if (!edition) {
            return res
              .status(400)
              .json({ error: "The selected edition does not belong to the game." });
          }
          target = { title: edition.name, igdbId: edition.id };
        }
        const match = await resolveDesktopMatch(target.title, target.igdbId);
        if (!match) {
          return res.status(404).json({ error: "No matching PC game was found." });
        }
        const result = await quickAddGameByTitle(userId, target.title, {
          status: "wanted",
          source: "api",
          ...(match.igdbId ? { igdbId: match.igdbId } : {}),
          ...(ledger.operatingSystem
            ? { targetPlatform: TARGET_PLATFORMS[ledger.operatingSystem] }
            : {}),
        });
        if (result.outcome === "not_found") {
          return res.status(404).json({ error: "No matching PC game was found." });
        }
        game = result.game;
        if (result.outcome === "duplicate") {
          const attached = await attachExistingGame(
            userId,
            ledger.externalRequestId,
            game,
            ledger.operatingSystem ?? "windows"
          );
          if (!attached) {
            return res.status(409).json({ error: "Game is already linked to another request." });
          }
        }
      }
      if (!addonsOnly) {
        // An already-acquired game found again (added manually since) keeps its state.
        if (!isAcquired(game) && game.status !== "wanted") {
          await storage.updateGameStatus(game.id, { status: "wanted" });
        }
        if (!isAcquired(game)) await storage.updateGameSearchResultsAvailable(game.id, false);
      }
      // Add-ons are queued again before the failed state is cleared, so a lookup error here
      // leaves the request retryable.
      const { addons, unresolved } = await resolveSelectedAddons(userId, ledger);
      const failed =
        (await queueAddons(userId, ledger, addons, ledger.operatingSystem ?? "windows")) +
        unresolved;
      const updated =
        (await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
          gameId: game.id,
          status: failed > 0 ? "failed" : "searching",
          errorMessage: failed > 0 ? ADDON_FAILURE_MESSAGE : null,
        })) ?? ledger;
      return res.json(await describeRequest(userId, updated));
    }
  )
);

/** Add-ons this request queued stop being searched on cancel, unless they were acquired since. */
async function shelvePendingAddons(userId: string, ledger: IntegrationRequest): Promise<void> {
  const queued = queuedAddonIds(ledger);
  if (queued.length === 0) return;
  const library = await libraryByIgdbId(userId);
  const shelved: number[] = [];
  for (const id of queued) {
    const addon = library.get(id);
    if (addon?.status !== "wanted") continue;
    // Another live request may have claimed the same game since this one queued it.
    const holder = await storage.getIntegrationRequestByGameId(userId, addon.id);
    if (
      holder &&
      holder.status !== "cancelled" &&
      holder.externalRequestId !== ledger.externalRequestId
    ) {
      continue;
    }
    await storage.updateGameStatus(addon.id, { status: "shelved" });
    await storage.updateGameSearchResultsAvailable(addon.id, false);
    shelved.push(id);
  }
  if (shelved.length > 0) {
    // Remembered so a later request for the same add-on can tell this shelving from a manual one.
    await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
      selection: JSON.stringify({
        ...JSON.parse(ledger.selection ?? "{}"),
        shelvedAddonIds: [...new Set([...shelvedAddonIds(ledger), ...shelved])],
      }),
    });
  }
}

seerrngRouter.post(
  "/requests/:externalRequestId/cancel",
  scope,
  requestAction(
    "Invalid cancellation confirmation.",
    "Request could not be cancelled.",
    "SeerrNG software request cancellation failed",
    async ({ userId, ledger, current }, res) => {
      if (current.status === "cancelled") {
        // Finish a cancellation that stopped before the game was shelved; the marker tells it
        // apart from a game someone wanted again afterwards.
        if (ledger.errorMessage === CANCEL_PENDING_MARKER) {
          const interrupted = await findGame(userId, ledger);
          if (interrupted && !isAcquired(interrupted)) {
            await storage.updateGameStatus(interrupted.id, { status: "shelved" });
            await storage.updateGameSearchResultsAvailable(interrupted.id, false);
          }
          await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
            errorMessage: null,
          });
        }
        return res.json(current);
      }
      if (current.status === "available") {
        return res.status(409).json({ error: "An available game cannot be cancelled." });
      }

      const game = await findGame(userId, ledger);
      if (game) {
        const downloads = await storage.getDownloadsByGameId(game.id);
        const active = downloads.filter((download) =>
          ACTIVE_DOWNLOAD_STATUSES.has(download.status.toLowerCase())
        );
        if (game.status === "downloading" && active.length === 0) {
          return res.status(409).json({
            error:
              "Questarr reports an active download but cannot identify a tracked download to stop.",
          });
        }
        for (const download of active) {
          if (download.downloadHash.startsWith("questarr-add-")) {
            return res.status(409).json({
              error:
                "The download client is still confirming this download. Try cancelling again shortly.",
            });
          }
          const downloader = await storage.getDownloader(download.downloaderId);
          if (!downloader) {
            return res
              .status(409)
              .json({ error: "The active download client is no longer configured." });
          }
          const removed = await DownloaderManager.removeDownload(
            downloader,
            download.downloadHash,
            false
          );
          if (!removed.success) {
            return res.status(502).json({ error: "The active download could not be cancelled." });
          }
          await storage.updateGameDownloadStatus(
            download.id,
            "cancelled",
            "Cancelled through SeerrNG."
          );
        }
      }
      await shelvePendingAddons(userId, ledger);
      // Recorded before the game is shelved, with a marker, so an interruption can be finished.
      const updated = await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
        status: "cancelled",
        errorMessage: game ? CANCEL_PENDING_MARKER : null,
      });
      if (game) {
        // "shelved" is the existing "no longer wanted" state: auto-search skips it.
        await storage.updateGameStatus(game.id, { status: "shelved" });
        await storage.updateGameSearchResultsAvailable(game.id, false);
        await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
          errorMessage: null,
        });
      }
      return res.json(await describeRequest(userId, updated ?? ledger));
    }
  )
);

// ── Asset delivery ───────────────────────────────────────────────────────────

const assetUrl = (externalRequestId: string, assetId?: string) =>
  `${BASE_PATH}/requests/${encodeURIComponent(externalRequestId)}/assets/${
    assetId === undefined ? "bundle" : encodeURIComponent(assetId)
  }`;

seerrngRouter.get(
  "/requests/:externalRequestId/assets",
  scope,
  async (req: Request, res: Response) => {
    try {
      const ledger = await loadRequest(req, res);
      if (!ledger) return undefined;
      const game = await findGame(req.user!.id, ledger);
      if (!game) return res.status(404).json({ error: "Request not found." });
      const assets = await listAssets(req.user!.id, game.id);
      const bundleSupported = assets.length > 1;
      return res.json({
        assets: assets.map(({ id, name, size }) => ({
          id,
          name,
          size,
          url: assetUrl(ledger.externalRequestId, id),
        })),
        bundleSupported,
        ...(bundleSupported
          ? {
              bundleName: `${safeBaseName(game.title)}.tar.gz`,
              bundleUrl: assetUrl(ledger.externalRequestId),
            }
          : {}),
      });
    } catch (error) {
      logger.error({ error }, "SeerrNG software assets lookup failed");
      return res.status(500).json({ error: "Assets are unavailable." });
    }
  }
);

seerrngRouter.get(
  "/requests/:externalRequestId/assets/bundle",
  scope,
  async (req: Request, res: Response) => {
    const opened: Array<{
      name: string;
      handle: Awaited<ReturnType<typeof fs.open>>;
      stats: Stats;
    }> = [];
    try {
      const ledger = await loadRequest(req, res);
      if (!ledger) return undefined;
      const game = await findGame(req.user!.id, ledger);
      if (!game) return res.status(404).json({ error: "Request not found." });

      const usedNames = new Set<string>();
      for (const asset of await listAssets(req.user!.id, game.id)) {
        try {
          // O_NOFOLLOW: the path was already resolved, so a swap for a symlink
          // after listing is refused instead of followed.
          const handle = await fs.open(
            asset.path,
            fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
          );
          const stats = await handle.stat();
          if (!stats.isFile()) {
            await handle.close();
            continue;
          }
          opened.push({
            name: safeArchiveEntryName(asset.name, opened.length, usedNames),
            handle,
            stats,
          });
        } catch {
          // Removed or replaced while the bundle was being prepared.
        }
      }
      if (opened.length < 2) {
        await Promise.all(opened.map(({ handle }) => handle.close().catch(() => undefined)));
        return res
          .status(409)
          .json({ error: "At least two deliverable files are needed for a bundle." });
      }

      res.set({
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          `${safeBaseName(game.title)}.tar.gz`
        )}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      const archive = new TarArchive({ gzip: true, gzipOptions: { level: 1 } });
      archive.on("error", (error: Error) => {
        logger.warn({ error }, "SeerrNG bundle stream failed");
        if (res.headersSent) res.destroy(error);
        else res.status(500).end();
      });
      const streams = opened.map((entry) => entry.handle.createReadStream());
      res.on("close", () => {
        if (res.writableEnded) return;
        archive.abort();
        // Streams the archive never reached would otherwise keep their file handles open.
        for (const stream of streams) stream.destroy();
      });
      archive.pipe(res.status(200));
      opened.forEach((entry, index) => {
        archive.append(streams[index]!, {
          name: entry.name,
          stats: entry.stats,
          date: entry.stats.mtime,
        });
      });
      void archive.finalize().catch((error: unknown) => archive.emit("error", error));
      return undefined;
    } catch (error) {
      await Promise.all(opened.map(({ handle }) => handle.close().catch(() => undefined)));
      logger.error({ error }, "SeerrNG bundle could not be prepared");
      if (res.headersSent) return res.destroy(error as Error);
      return res.status(500).json({ error: "Files could not be bundled." });
    }
  }
);

seerrngRouter.get(
  "/requests/:externalRequestId/assets/:assetId",
  scope,
  async (req: Request, res: Response) => {
    const assetId = z.string().min(1).max(256).safeParse(req.params.assetId);
    if (!assetId.success) return res.status(400).json({ error: "Invalid asset request." });
    try {
      const ledger = await loadRequest(req, res);
      if (!ledger) return undefined;
      const game = await findGame(req.user!.id, ledger);
      if (!game) return res.status(404).json({ error: "Request not found." });
      const asset = (await listAssets(req.user!.id, game.id)).find(
        (item) => item.id === assetId.data
      );
      if (!asset) return res.status(404).json({ error: "Asset not found." });

      // O_NOFOLLOW: the path was already resolved, so a swap for a symlink after listing is
      // refused instead of followed; everything below reads from the verified handle.
      let handle: Awaited<ReturnType<typeof fs.open>>;
      try {
        handle = await fs.open(asset.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      } catch {
        return res.status(404).json({ error: "Asset not found." });
      }
      const stats = await handle.stat();
      if (!stats.isFile()) {
        await handle.close();
        return res.status(404).json({ error: "Asset not found." });
      }
      const size = stats.size;
      let start = 0;
      let end = size - 1;
      let statusCode = 200;
      const range = req.header("Range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const unsatisfiable = () => {
          res.set("Content-Range", `bytes */${size}`);
          void handle.close();
          return res.status(416).end();
        };
        if (!match || size === 0) return unsatisfiable();
        if (!match[1]) {
          const suffix = Number(match[2]);
          if (!suffix) return unsatisfiable();
          start = Math.max(0, size - suffix);
        } else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(size - 1, Number(match[2]));
        }
        if (!Number.isSafeInteger(start) || start < 0 || start >= size || end < start) {
          return unsatisfiable();
        }
        statusCode = 206;
        res.set("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      res.set({
        "Accept-Ranges": "bytes",
        "Content-Length": String(size === 0 ? 0 : end - start + 1),
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "X-Content-Type-Options": "nosniff",
      });
      if (size === 0) {
        await handle.close();
        return res.status(200).end();
      }
      const stream = handle.createReadStream({ start, end });
      stream.on("error", (error) => {
        logger.warn({ error }, "SeerrNG asset stream failed");
        if (!res.headersSent) res.status(404).end();
        else res.destroy(error);
      });
      res.on("close", () => stream.destroy());
      return stream.pipe(res.status(statusCode));
    } catch (error) {
      logger.error({ error }, "SeerrNG software asset stream failed");
      return res.status(500).json({ error: "Asset could not be streamed." });
    }
  }
);
