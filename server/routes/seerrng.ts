import { Router, type Request, type Response } from "express";
import { readFileSync, constants as fsConstants, promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { TarArchive } from "archiver";
import { z } from "zod";
import { requireScope } from "../auth.js";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";
import { routesLogger as logger } from "../logger.js";
import { getContentFilterFlags, isContentFiltered } from "../content-filter.js";
import { assertWithinRoots } from "../path-security.js";
import { DownloaderManager } from "../downloaders/manager.js";
import { quickAddGameByTitle } from "../game-quick-add.js";
import {
  ACQUIRED_GAME_STATUSES,
  SEERRNG_ARCHITECTURES,
  SEERRNG_OPERATING_SYSTEMS,
  type Game,
  type IntegrationRequest,
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

const createRequestSchema = z.object({
  externalRequestId: requestIdSchema,
  title: z.string().trim().min(1).max(500),
  igdbId: z.number().int().positive().optional(),
  variant: variantSchema,
});

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
    if (deliverable || isAcquired(game)) {
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

  return {
    externalRequestId: ledger.externalRequestId,
    status,
    deliverable,
    error: status === "failed" ? (error ?? "The request failed.") : null,
    title: game?.title ?? ledger.title,
    ...(variant ? { variant } : {}),
    ...(game ? { game: { id: game.id, title: game.title, status: game.status } } : {}),
    ...(identity ? { identity } : {}),
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
    if (owner.status === "shelved") {
      // Cancellation shelved the game; a new request wants it again.
      await storage.updateGameStatus(owner.id, { status: "wanted" });
      owner = { ...owner, status: "wanted" };
    }
  }
  const platform = TARGET_PLATFORMS[operatingSystem];
  if (!isAcquired(owner) && owner.targetPlatformId !== platform.id) {
    await storage.updateGame(owner.id, {
      targetPlatformId: platform.id,
      targetPlatformName: platform.name,
    });
  }
  return storage.updateIntegrationRequest(userId, externalRequestId, {
    gameId: owner.id,
    status: "searching",
    errorMessage: null,
  });
}

seerrngRouter.post("/requests", scope, async (req: Request, res: Response) => {
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid software request payload." });
  }
  const { externalRequestId, title, igdbId, variant } = parsed.data;
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
      });

      if (!created) {
        const sameRequest =
          ledger.title === title &&
          ledger.operatingSystem === variant.operatingSystem &&
          ledger.architecture === variant.architecture &&
          (ledger.igdbId ?? null) === (igdbId ?? null);
        if (!sameRequest) {
          return res
            .status(409)
            .json({ error: "externalRequestId is already bound to a different request." });
        }
        return res.status(200).json(await describeRequest(userId, ledger));
      }

      if (igdbId) {
        // An exact IGDB id bypasses the catalog filters: refuse titles with no desktop release.
        const requested = await igdbClient.getGameById(igdbId);
        if (requested && !supportsDesktop(requested)) {
          await storage.updateIntegrationRequest(userId, externalRequestId, {
            status: "failed",
            errorMessage: "No matching PC game was found.",
          });
          return res.status(404).json({ error: "No matching PC game was found." });
        }
      }

      const result = await quickAddGameByTitle(userId, title, {
        status: "wanted",
        source: "api",
        targetPlatform: TARGET_PLATFORMS[variant.operatingSystem],
        ...(igdbId ? { igdbId } : {}),
      });

      if (result.outcome === "not_found") {
        await storage.updateIntegrationRequest(userId, externalRequestId, {
          status: "failed",
          errorMessage: "No matching PC game was found.",
        });
        return res.status(404).json({ error: "No matching PC game was found." });
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
        return res.status(201).json(await describeRequest(userId, linked));
      }

      const linked = await storage.updateIntegrationRequest(userId, externalRequestId, {
        gameId: result.game.id,
        status: "searching",
        errorMessage: null,
      });
      return res.status(201).json(await describeRequest(userId, linked ?? ledger));
    } catch (error) {
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
      if (!game) {
        // The game was deleted (or never created): add it again from the ledger.
        if (ledger.igdbId) {
          const requested = await igdbClient.getGameById(ledger.igdbId);
          if (requested && !supportsDesktop(requested)) {
            return res.status(404).json({ error: "No matching PC game was found." });
          }
        }
        const result = await quickAddGameByTitle(userId, ledger.title, {
          status: "wanted",
          source: "api",
          ...(ledger.igdbId ? { igdbId: ledger.igdbId } : {}),
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
      // An already-acquired game found again (added manually since) keeps its state.
      if (!isAcquired(game) && game.status !== "wanted") {
        await storage.updateGameStatus(game.id, { status: "wanted" });
      }
      if (!isAcquired(game)) await storage.updateGameSearchResultsAvailable(game.id, false);
      const updated = await storage.updateIntegrationRequest(userId, ledger.externalRequestId, {
        gameId: game.id,
        status: "searching",
        errorMessage: null,
      });
      return res.json(await describeRequest(userId, updated ?? ledger));
    }
  )
);

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
