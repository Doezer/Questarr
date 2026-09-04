import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { storage } from "../storage.js";
import { igdbClient } from "../igdb.js";
import { routesLogger as logger } from "../logger.js";
import { normalizeTitle } from "../../shared/title-utils.js";
import { getContentFilterFlags, isContentFiltered } from "../content-filter.js";
import { normalizeInitialReleaseStatus } from "../game-status.js";
import { insertGameSchema, type Game } from "@shared/schema";

const { version: APP_VERSION } = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
) as { version: string };

/**
 * Version of the integration contract itself, bumped when a change would break
 * an already-released extension. Clients check it during the ping handshake so
 * a mismatched pair fails loudly instead of misbehaving halfway through a sync.
 */
export const INTEGRATION_API_VERSION = 1;

/** Upper bound on a single library sync payload, to keep one request bounded. */
const MAX_SYNC_GAMES = 5000;

export const integrationRouter = Router();

// Every route below runs behind authenticateApiKeyOrToken, so req.user is
// always populated; this guard is defence-in-depth against a future mount that
// forgets the middleware.
integrationRouter.use((req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

/** The library shape handed to external clients — a stable subset of Game. */
function toIntegrationGame(game: Game) {
  return {
    id: game.id,
    title: game.title,
    igdbId: game.igdbId,
    steamAppId: game.steamAppId,
    status: game.status,
    releaseStatus: game.releaseStatus,
    releaseDate: game.releaseDate,
    coverUrl: game.coverUrl,
    platforms: game.platforms ?? [],
    genres: game.genres ?? [],
    libraryPath: game.libraryPath,
    addedAt: game.addedAt,
  };
}

// ── Handshake ────────────────────────────────────────────────────────────────
// Lets an extension verify its URL and credential in one call before doing any
// real work, and surfaces the version pair in its own logs.
integrationRouter.get("/ping", (req: Request, res: Response) => {
  res.json({
    service: "questarr",
    version: APP_VERSION,
    apiVersion: INTEGRATION_API_VERSION,
    authenticatedAs: { id: req.user!.id, username: req.user!.username },
    usingApiKey: Boolean(req.apiKeyId),
  });
});

// ── Pull: Questarr library → external client ─────────────────────────────────
const libraryQuerySchema = z.object({
  status: z.string().trim().min(1).optional(),
  includeHidden: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

integrationRouter.get("/library", async (req: Request, res: Response) => {
  try {
    const parsed = libraryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters" });
    }
    const { status, includeHidden } = parsed.data;

    const statuses = status
      ? status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const games = await storage.getUserGames(req.user!.id, includeHidden, statuses);
    res.json({ games: games.map(toIntegrationGame), count: games.length });
  } catch (error) {
    logger.error({ error }, "Integration library fetch failed");
    res.status(500).json({ error: "Failed to fetch library" });
  }
});

// ── Push: external library → Questarr ────────────────────────────────────────
const syncSchema = z.object({
  games: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        // Playnite's own game id, echoed back untouched so the extension can
        // correlate results with its library without re-matching by title.
        externalId: z.string().trim().max(200).optional(),
        installed: z.boolean().optional(),
        steamAppId: z.number().int().positive().optional(),
      })
    )
    .min(1)
    .max(MAX_SYNC_GAMES),
  // When true, a matched game that the client reports as installed is promoted
  // to "owned" in Questarr. Off by default: a sync should not rewrite library
  // state unless the user opted in.
  markInstalledAsOwned: z.boolean().optional().default(false),
});

integrationRouter.post("/library/sync", async (req: Request, res: Response) => {
  try {
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid sync payload", issues: parsed.error.issues });
    }
    const { games: incoming, markInstalledAsOwned } = parsed.data;
    const userId = req.user!.id;

    const library = await storage.getUserGames(userId, true);

    // Index the library once; a sync can carry thousands of titles and a linear
    // scan per entry would make this quadratic.
    const byNormalizedTitle = new Map<string, Game>();
    const bySteamAppId = new Map<number, Game>();
    for (const game of library) {
      const key = normalizeTitle(game.title);
      if (!byNormalizedTitle.has(key)) byNormalizedTitle.set(key, game);
      if (game.steamAppId) bySteamAppId.set(game.steamAppId, game);
    }

    const matched: Array<{ externalId?: string; title: string; gameId: string; status: string }> =
      [];
    const unmatched: Array<{ externalId?: string; title: string }> = [];
    const promoted: string[] = [];

    for (const entry of incoming) {
      const match =
        (entry.steamAppId ? bySteamAppId.get(entry.steamAppId) : undefined) ??
        byNormalizedTitle.get(normalizeTitle(entry.title));

      if (!match) {
        unmatched.push({ externalId: entry.externalId, title: entry.title });
        continue;
      }

      let status = match.status;
      if (markInstalledAsOwned && entry.installed && match.status === "wanted") {
        await storage.updateGameStatus(match.id, { status: "owned" });
        status = "owned";
        promoted.push(match.id);
      }

      matched.push({
        externalId: entry.externalId,
        title: entry.title,
        gameId: match.id,
        status,
      });
    }

    logger.info(
      {
        userId,
        received: incoming.length,
        matched: matched.length,
        unmatched: unmatched.length,
        promoted: promoted.length,
      },
      "Integration library sync"
    );

    res.json({
      received: incoming.length,
      matched,
      unmatched,
      promotedToOwned: promoted.length,
    });
  } catch (error) {
    logger.error({ error }, "Integration library sync failed");
    res.status(500).json({ error: "Library sync failed" });
  }
});

// ── Request a game from the couch ────────────────────────────────────────────
// Matches a free-text title against IGDB and adds it to the library. Adding it
// as "wanted" is what hands it to the existing auto-search pipeline, which
// searches indexers and sends the best release to the download client — so a
// single call from Playnite is enough to start a download.
const requestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  status: z.enum(["wanted", "owned"]).optional().default("wanted"),
});

integrationRouter.post("/games/request", async (req: Request, res: Response) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid request payload", issues: parsed.error.issues });
    }
    const { title, status } = parsed.data;
    const userId = req.user!.id;

    const results = await igdbClient.searchGames(title, 1);
    if (results.length === 0) {
      return res.status(404).json({ error: "No game found on IGDB for this title" });
    }

    const match = igdbClient.formatGameData(results[0]);
    const filterFlags = await getContentFilterFlags(userId);
    if (
      isContentFiltered(
        match as { isAdultContent?: boolean; isAgeRestricted?: boolean },
        filterFlags
      )
    ) {
      // Deliberately indistinguishable from "no match": a filtered title must
      // not be discoverable through this endpoint either.
      return res.status(404).json({ error: "No game found on IGDB for this title" });
    }

    const gameData = insertGameSchema.parse({
      userId,
      title: match.title,
      igdbId: match.igdbId,
      status,
      platforms: match.platforms,
      genres: match.genres,
      themes: match.themes,
      isAdultContent: match.isAdultContent,
      isAgeRestricted: match.isAgeRestricted,
      coverUrl: match.coverUrl,
      releaseDate: match.releaseDate,
      summary: match.summary,
      publishers: match.publishers,
      developers: match.developers,
      screenshots: match.screenshots,
      rating: match.rating,
      source: "api",
    });

    const existing = (await storage.getUserGames(userId, true)).find((g) =>
      gameData.igdbId != null
        ? g.igdbId === gameData.igdbId
        : g.title.toLowerCase() === gameData.title.toLowerCase()
    );
    if (existing) {
      return res
        .status(409)
        .json({ error: "Game already in collection", game: toIntegrationGame(existing) });
    }

    const game = await storage.addGame(normalizeInitialReleaseStatus(gameData));
    logger.info(
      { userId, title: game.title, igdbId: game.igdbId, viaApiKey: Boolean(req.apiKeyId) },
      "Game requested through the integration API"
    );
    res.status(201).json({ game: toIntegrationGame(game) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    logger.error({ error }, "Integration game request failed");
    res.status(500).json({ error: "Failed to request game" });
  }
});
