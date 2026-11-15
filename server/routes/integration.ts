import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { storage } from "../storage.js";
import { requireScope } from "../auth.js";
import { seerrngRouter } from "./seerrng.js";
import { routesLogger as logger } from "../logger.js";
import { normalizeTitle } from "../../shared/title-utils.js";
import { quickAddGameByTitle } from "../game-quick-add.js";
import { notifyUser } from "../socket.js";
import {
  decidePlayStatus,
  libraryTitlesAgree,
  mapPlayniteStatus,
  MIN_PLAYTIME_IMPORT_MINUTES,
  normalizedTitlesAgree,
  recordedMinutes,
  toSyncSource,
} from "../play-status-sync.js";
// Relative path, not the "@shared" alias — see the comment in
// game-quick-add.ts.
import { GAME_STATUSES, type Game } from "../../shared/schema.js";
import { getContentFilterFlags, excludeFilteredContent } from "../content-filter.js";

const { version: APP_VERSION } = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
) as { version: string };

/**
 * Version of the integration contract itself, bumped when a change would break
 * an already-released extension. Clients check it during the ping handshake so
 * a mismatched pair fails loudly instead of misbehaving halfway through a sync.
 */
export const INTEGRATION_API_VERSION = 1;

/** Same limits as a session entered by hand (see play-session-routes.ts). */
const MAX_PLAY_SESSION_MS = 24 * 60 * 60_000;
const PLAY_SESSION_FUTURE_SLACK_MS = 5 * 60_000;

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
  // Every response here varies by req.user (auth status, library contents),
  // so it must never be cached by a shared proxy or the client's HTTP cache.
  res.set("Cache-Control", "no-store");
  return next();
});

// SeerrNG provider API (docs/SEERRNG.md). Its routes declare their own scope.
integrationRouter.use("/seerrng/v1", seerrngRouter);

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
integrationRouter.get(
  "/ping",
  requireScope("library:write", "read", "requests"),
  (req: Request, res: Response) => {
    res.json({
      service: "questarr",
      version: APP_VERSION,
      apiVersion: INTEGRATION_API_VERSION,
      authenticatedAs: { id: req.user!.id, username: req.user!.username },
      usingApiKey: Boolean(req.apiKeyId),
      // Lets a client warn before its key expires. Both are null for a browser
      // session; expiresAt is also null for a key that never expires.
      scope: req.apiKeyScope ?? null,
      expiresAt: req.apiKeyExpiresAt?.toISOString() ?? null,
    });
  }
);

// ── Pull: Questarr library → external client ─────────────────────────────────
const libraryQuerySchema = z.object({
  // Rejects a malformed filter (e.g. "?status=,", "wanted,,owned", or an
  // unknown status) outright rather than silently degrading into "no filter"
  // or "matches nothing" — either of those would be a confusing way to fail.
  status: z
    .string()
    .trim()
    .min(1)
    .transform((v) => v.split(",").map((s) => s.trim()))
    .pipe(z.array(z.enum(GAME_STATUSES)).min(1))
    .optional(),
  includeHidden: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

integrationRouter.get(
  "/library",
  requireScope("library:write", "read"),
  async (req: Request, res: Response) => {
    try {
      const parsed = libraryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid query parameters" });
      }
      const { status: statuses, includeHidden } = parsed.data;

      const games = await storage.getUserGames(req.user!.id, includeHidden, statuses);
      // Match /api/games' own behavior: a title the user filtered out (adult
      // content, age-restricted) must not leak through this endpoint either.
      const filterFlags = await getContentFilterFlags(req.user!.id);
      const visibleGames = excludeFilteredContent(games, filterFlags);
      return res.json({ games: visibleGames.map(toIntegrationGame), count: visibleGames.length });
    } catch (error) {
      logger.error({ error }, "Integration library fetch failed");
      return res.status(500).json({ error: "Failed to fetch library" });
    }
  }
);

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

integrationRouter.post(
  "/library/sync",
  requireScope("library:write"),
  async (req: Request, res: Response) => {
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

      const matched: Array<{
        externalId?: string | undefined;
        title: string;
        gameId: string;
        status: string;
      }> = [];
      const unmatched: Array<{ externalId?: string | undefined; title: string }> = [];
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

      return res.json({
        received: incoming.length,
        matched,
        unmatched,
        promotedToOwned: promoted.length,
      });
    } catch (error) {
      logger.error({ error }, "Integration library sync failed");
      return res.status(500).json({ error: "Library sync failed" });
    }
  }
);

// ── Request a game from the couch ────────────────────────────────────────────
// Matches a free-text title against IGDB and adds it to the library. Adding it
// as "wanted" is what hands it to the existing auto-search pipeline, which
// searches indexers and sends the best release to the download client — so a
// single call from Playnite is enough to start a download.
const requestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  status: z.enum(["wanted", "owned"]).optional().default("wanted"),
});

integrationRouter.post(
  "/games/request",
  requireScope("library:write"),
  async (req: Request, res: Response) => {
    try {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request payload", issues: parsed.error.issues });
      }
      const { title, status } = parsed.data;
      const userId = req.user!.id;

      // Shared with POST /api/games/match-and-add (the browser's own "quick
      // add" flow) so the two entry points can't drift on matching, content
      // filtering, or dedupe behavior.
      const result = await quickAddGameByTitle(userId, title, { status, source: "api" });

      switch (result.outcome) {
        case "not_found":
          // Deliberately indistinguishable from "no match": a filtered title
          // must not be discoverable through this endpoint either.
          return res.status(404).json({ error: "No game found on IGDB for this title" });
        case "duplicate":
          return res
            .status(409)
            .json({ error: "Game already in collection", game: toIntegrationGame(result.game) });
        case "added":
          logger.info(
            {
              userId,
              title: result.game.title,
              igdbId: result.game.igdbId,
              viaApiKey: Boolean(req.apiKeyId),
            },
            "Game requested through the integration API"
          );
          return res.status(201).json({ game: toIntegrationGame(result.game) });
      }

      return;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues });
      }
      logger.error({ error }, "Integration game request failed");
      return res.status(500).json({ error: "Failed to request game" });
    }
  }
);

// ── Play sessions from the couch PC ──────────────────────────────────────────
// Playnite knows exactly when a game started and stopped, so the extension sends
// the finished session instead of asking the user to run a timer by hand.
const playSessionSchema = z
  .object({
    // A game is matched by Questarr id, then Steam App ID, then normalized
    // title (same rules as the library sync). Nothing is created for a miss.
    gameId: z.string().trim().min(1).max(100).optional(),
    steamAppId: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(500).optional(),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date(),
  })
  .refine((v) => v.gameId || v.steamAppId || v.title, {
    message: "One of gameId, steamAppId or title is required",
  });

/** Why a session's times are refused, or null when they are acceptable. */
function playSessionTimeError(startedAt: Date, endedAt: Date): string | null {
  const durationMs = endedAt.getTime() - startedAt.getTime();
  if (durationMs < 0) return "A play session cannot end before it starts";
  if (durationMs > MAX_PLAY_SESSION_MS) return "A play session cannot last longer than 24 hours";
  if (endedAt.getTime() > Date.now() + PLAY_SESSION_FUTURE_SLACK_MS) {
    return "A play session cannot end in the future";
  }
  return null;
}

/** The caller's game for a session: by Questarr id, then Steam App ID, then normalized title. */
async function resolvePlaySessionGame(
  userId: string,
  ref: { gameId?: string | undefined; steamAppId?: number | undefined; title?: string | undefined }
): Promise<Game | undefined> {
  if (ref.gameId) {
    const byId = await storage.getGame(ref.gameId);
    if (byId?.userId === userId) return byId;
  }
  if (!ref.steamAppId && !ref.title) return undefined;
  const library = await storage.getUserGames(userId, true);
  const bySteam = ref.steamAppId ? library.find((g) => g.steamAppId === ref.steamAppId) : undefined;
  if (bySteam || !ref.title) return bySteam;
  const key = normalizeTitle(ref.title);
  // A title with no letters or digits (e.g. Japanese) normalizes to "", which would match
  // every other such title, so it can only match through an id.
  if (!key) return undefined;
  return library.find((g) => normalizeTitle(g.title) === key);
}

/** Tails of the in-flight session writes, one chain per user and game. */
const playSessionLocks = new Map<string, Promise<unknown>>();

/**
 * Runs `task` after every earlier task for the same key has finished, so two retries of one
 * session cannot both pass the duplicate check before either inserts. Per process, which is
 * enough: a single Questarr instance owns its database.
 */
async function withPlaySessionLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = playSessionLocks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  playSessionLocks.set(key, tail);
  try {
    return await run;
  } finally {
    // Drop the entry once nothing queued behind this task, so the map does not grow.
    if (playSessionLocks.get(key) === tail) playSessionLocks.delete(key);
  }
}

integrationRouter.post(
  "/play-sessions",
  requireScope("library:write"),
  async (req: Request, res: Response) => {
    try {
      const parsed = playSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid play session payload", issues: parsed.error.issues });
      }
      const { startedAt, endedAt } = parsed.data;
      const userId = req.user!.id;

      const timeError = playSessionTimeError(startedAt, endedAt);
      if (timeError) return res.status(400).json({ error: timeError });

      // The caller owns every row it can reach, so a hidden or filtered title leaks nothing here.
      const game = await resolvePlaySessionGame(userId, parsed.data);
      if (!game) {
        return res.status(404).json({
          error: "No game in the library matches this session",
          // Lets a client tell this apart from a server that has no such route (also a 404).
          code: "GAME_NOT_FOUND",
        });
      }

      // A retry after a network error must not count the session twice. Only sessions that came
      // through this API count as the same one: a manual session may share the start time.
      const { session, duplicate } = await withPlaySessionLock(`${userId}:${game.id}`, async () => {
        const existing = (await storage.getGamePlaySessions(game.id, userId)).find(
          (s) => s.source === "playnite" && s.startedAt.getTime() === startedAt.getTime()
        );
        if (existing) return { session: existing, duplicate: true };
        const created = await storage.addGamePlaySession({
          gameId: game.id,
          userId,
          startedAt,
          endedAt,
          source: "playnite",
        });
        return { session: created, duplicate: false };
      });
      if (duplicate) return res.status(200).json({ session, duplicate: true });

      logger.info(
        {
          userId,
          gameId: game.id,
          minutes: Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
        },
        "Play session received through the integration API"
      );
      notifyUser("playSessionsUpdated", { source: "playnite", gameId: game.id }, userId);
      return res.status(201).json({ session, duplicate: false });
    } catch (error) {
      logger.error({ error }, "Integration play session failed");
      return res.status(500).json({ error: "Failed to record the play session" });
    }
  }
);

// ── Play status from the couch PC ────────────────────────────────────────────
// Playnite exposes the completion status of every library it reads (Steam, GOG, Epic...), so the
// extension pushes it here. A status the user set by hand is never overwritten (see
// decidePlayStatus); the write itself repeats that check in one statement, so a status or
// download the user starts while a long sync runs is not overwritten.
const playStatusSchema = z.object({
  games: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        externalId: z.string().trim().max(200).optional(),
        gameId: z.string().trim().min(1).max(100).optional(),
        steamAppId: z.number().int().positive().optional(),
        // Playnite's CompletionStatus name, e.g. "Playing", "Beaten", "On Hold".
        status: z.string().trim().min(1).max(100),
        // Library the game comes from in Playnite (steam, gog, epic...); free text.
        platform: z.string().trim().max(100).optional(),
      })
    )
    .min(1)
    .max(MAX_SYNC_GAMES),
  // Off by default, like markInstalledAsOwned: games the user only wants are not turned into
  // owned ones unless the sync was asked to.
  promoteWanted: z.boolean().optional().default(false),
});

integrationRouter.post(
  "/play-status",
  requireScope("library:write"),
  async (req: Request, res: Response) => {
    try {
      const parsed = playStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid play status payload", issues: parsed.error.issues });
      }
      const { games: incoming, promoteWanted } = parsed.data;
      const userId = req.user!.id;

      const library = await storage.getUserGames(userId, true);
      const byId = new Map<string, Game>();
      const byNormalizedTitle = new Map<string, Game>();
      const bySteamAppId = new Map<number, Game>();
      for (const game of library) {
        byId.set(game.id, game);
        const key = normalizeTitle(game.title);
        // A title with no letters or digits normalizes to "" and would match every other one.
        if (key && !byNormalizedTitle.has(key)) byNormalizedTitle.set(key, game);
        if (game.steamAppId) bySteamAppId.set(game.steamAppId, game);
      }

      type Result = {
        externalId?: string | undefined;
        title: string;
        gameId?: string;
        status?: string;
        result: "updated" | "unchanged" | "skipped" | "unmatched";
        reason?: string;
      };
      const results: Result[] = [];
      const counts = { updated: 0, unchanged: 0, skipped: 0, unmatched: 0 };

      for (const entry of incoming) {
        const base = { externalId: entry.externalId, title: entry.title };
        const push = (r: Omit<Result, "externalId" | "title">) => {
          counts[r.result] += 1;
          results.push({ ...base, ...r });
        };

        const target = mapPlayniteStatus(entry.status);
        if (!target) {
          push({ result: "skipped", reason: "unknown_status" });
          continue;
        }
        const key = normalizeTitle(entry.title);
        const match =
          (entry.gameId ? byId.get(entry.gameId) : undefined) ??
          (entry.steamAppId ? bySteamAppId.get(entry.steamAppId) : undefined) ??
          (key ? byNormalizedTitle.get(key) : undefined);
        if (!match) {
          push({ result: "unmatched" });
          continue;
        }

        const decision = decidePlayStatus(match, target, { promoteWanted });
        if (decision.action === "skip") {
          push({
            gameId: match.id,
            status: match.status,
            result: "skipped",
            reason: decision.reason,
          });
          continue;
        }
        if (decision.action === "unchanged") {
          push({ gameId: match.id, status: match.status, result: "unchanged" });
          continue;
        }

        const updated = await storage.updateGameStatus(
          match.id,
          { status: target },
          { syncSource: toSyncSource(entry.platform), allowWanted: promoteWanted }
        );
        if (!updated) {
          // The user set a status by hand between the read above and this write.
          push({
            gameId: match.id,
            status: match.status,
            result: "skipped",
            reason: "manual_status",
          });
          continue;
        }
        // Keep the index current so a duplicate entry in the same payload sees the new state.
        byId.set(updated.id, updated);
        if (updated.steamAppId) bySteamAppId.set(updated.steamAppId, updated);
        const titleKey = normalizeTitle(updated.title);
        if (titleKey) byNormalizedTitle.set(titleKey, updated);
        push({ gameId: match.id, status: updated.status, result: "updated" });
        notifyUser("gameUpdated", match.id, userId);
      }

      logger.info(
        { userId, received: incoming.length, ...counts },
        "Play status received through the integration API"
      );
      return res.json({ received: incoming.length, ...counts, results });
    } catch (error) {
      logger.error({ error }, "Integration play status failed");
      return res.status(500).json({ error: "Failed to sync play status" });
    }
  }
);

// ── Play time totals from the couch PC ───────────────────────────────────────
// A store library (GOG, through Playnite) already knows how long each game was played before
// Questarr existed. The extension sends that total once; the part not yet recorded in Questarr
// becomes one estimated session (`playnite_import`). Re-sending is harmless: the recorded time
// is subtracted first, so nothing is counted twice.
const playTimeTotalsSchema = z.object({
  games: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        externalId: z.string().trim().max(200).optional(),
        gameId: z.string().trim().min(1).max(100).optional(),
        steamAppId: z.number().int().positive().optional(),
        // Total play time Playnite holds for the game, in seconds.
        playtimeSeconds: z.number().int().nonnegative().max(100_000_000),
        // When the game was last played, if Playnite knows; the imported time ends there.
        lastPlayedAt: z.coerce.date().optional(),
      })
    )
    .min(1)
    .max(MAX_SYNC_GAMES),
});

integrationRouter.post(
  "/play-time-totals",
  requireScope("library:write"),
  async (req: Request, res: Response) => {
    try {
      const parsed = playTimeTotalsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid play time payload", issues: parsed.error.issues });
      }
      const { games: incoming } = parsed.data;
      const userId = req.user!.id;
      const running = await storage.getRunningPlaySession(userId);

      // One read and one index for the whole batch, like /play-status: a batch can hold thousands
      // of title-only entries.
      const library = await storage.getUserGames(userId, true);
      const byId = new Map<string, Game>();
      const bySteamAppId = new Map<number, Game>();
      const byTitle = new Map<string, Game>();
      // Normalized once per library game: the edition fallback below compares against all of them.
      const normalizedLibrary: Array<{ game: Game; key: string }> = [];
      for (const g of library) {
        byId.set(g.id, g);
        if (g.steamAppId) bySteamAppId.set(g.steamAppId, g);
        const key = normalizeTitle(g.title);
        if (!key) continue;
        normalizedLibrary.push({ game: g, key });
        if (!byTitle.has(key)) byTitle.set(key, g);
      }
      /**
       * Id, Steam App ID, then normalized title. As a last resort, the one game whose title
       * differs only by an edition suffix: library import stores IGDB's title, so a GOG
       * "... - Enhanced Edition" would otherwise never find the game it just created.
       */
      const resolveGame = (entry: {
        gameId?: string | undefined;
        steamAppId?: number | undefined;
        title: string;
      }) => {
        const key = normalizeTitle(entry.title);
        const exact =
          (entry.gameId ? byId.get(entry.gameId) : undefined) ??
          (entry.steamAppId ? bySteamAppId.get(entry.steamAppId) : undefined) ??
          (key ? byTitle.get(key) : undefined);
        if (exact || !key) return exact;
        const near = normalizedLibrary.filter((x) => normalizedTitlesAgree(key, x.key));
        return near.length === 1 ? near[0]?.game : undefined;
      };

      let imported = 0;
      let unchanged = 0;
      let skipped = 0;
      let unmatched = 0;
      let minutesAdded = 0;
      const results: Array<{
        externalId?: string | undefined;
        title: string;
        gameId?: string;
        result: "imported" | "unchanged" | "skipped" | "unmatched";
        minutes?: number;
        reason?: string;
      }> = [];

      for (const entry of incoming) {
        const base = { externalId: entry.externalId, title: entry.title };
        const game = resolveGame(entry);
        if (!game) {
          unmatched += 1;
          results.push({ ...base, result: "unmatched" });
          continue;
        }
        // The timer owns the game's time while it runs; the next sync picks the rest up.
        if (running?.gameId === game.id) {
          skipped += 1;
          results.push({ ...base, gameId: game.id, result: "skipped", reason: "timer_running" });
          continue;
        }

        const outcome = await withPlaySessionLock(`${userId}:${game.id}`, async () => {
          const total = Math.floor(entry.playtimeSeconds / 60);
          const missing =
            total - recordedMinutes(await storage.getGamePlaySessions(game.id, userId));
          if (missing < MIN_PLAYTIME_IMPORT_MINUTES) return 0;
          const now = Date.now();
          const last = entry.lastPlayedAt?.getTime();
          const end =
            last !== undefined && last <= now && last > 0 ? new Date(last) : new Date(now);
          await storage.addGamePlaySession({
            gameId: game.id,
            userId,
            startedAt: new Date(end.getTime() - missing * 60_000),
            endedAt: end,
            source: "playnite_import",
          });
          return missing;
        });

        if (outcome > 0) {
          imported += 1;
          minutesAdded += outcome;
          results.push({ ...base, gameId: game.id, result: "imported", minutes: outcome });
        } else {
          unchanged += 1;
          results.push({ ...base, gameId: game.id, result: "unchanged" });
        }
      }

      logger.info(
        {
          userId,
          received: incoming.length,
          imported,
          unchanged,
          skipped,
          unmatched,
          minutesAdded,
        },
        "Play time totals received through the integration API"
      );
      if (imported > 0) notifyUser("playSessionsUpdated", { source: "playnite" }, userId);
      return res.json({
        received: incoming.length,
        imported,
        unchanged,
        skipped,
        unmatched,
        minutesAdded,
        results,
      });
    } catch (error) {
      logger.error({ error }, "Integration play time totals failed");
      return res.status(500).json({ error: "Failed to import play time" });
    }
  }
);

// ── Import a store library as owned games ────────────────────────────────────
// Creates the games a Playnite library holds and Questarr does not, as "owned". Each title goes
// through the same IGDB matching as "request a game", and a match whose title is not the one
// asked for is left out rather than added wrongly. IGDB is called once per new title, so a
// request is small and the extension sends the library in batches.
const MAX_IMPORT_GAMES = 25;
const importSchema = z.object({
  games: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        externalId: z.string().trim().max(200).optional(),
        steamAppId: z.number().int().positive().optional(),
        platform: z.string().trim().max(100).optional(),
      })
    )
    .min(1)
    .max(MAX_IMPORT_GAMES),
});

integrationRouter.post(
  "/library/import",
  requireScope("library:write"),
  async (req: Request, res: Response) => {
    try {
      const parsed = importSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid import payload", issues: parsed.error.issues });
      }
      const { games: incoming } = parsed.data;
      const userId = req.user!.id;

      const library = await storage.getUserGames(userId, true);
      const byTitle = new Set<string>();
      const bySteam = new Set<number>();
      for (const g of library) {
        const key = normalizeTitle(g.title);
        if (key) byTitle.add(key);
        if (g.steamAppId) bySteam.add(g.steamAppId);
      }

      const counts = { added: 0, existing: 0, notFound: 0 };
      const results: Array<{
        externalId?: string | undefined;
        title: string;
        result: "added" | "existing" | "not_found";
        gameId?: string;
      }> = [];

      for (const entry of incoming) {
        const base = { externalId: entry.externalId, title: entry.title };
        const key = normalizeTitle(entry.title);
        if ((entry.steamAppId && bySteam.has(entry.steamAppId)) || (key && byTitle.has(key))) {
          counts.existing += 1;
          results.push({ ...base, result: "existing" });
          continue;
        }

        const result = await quickAddGameByTitle(userId, entry.title, {
          status: "owned",
          source:
            toSyncSource(entry.platform) === "playnite" ? "api" : toSyncSource(entry.platform),
          acceptMatch: (matched) => libraryTitlesAgree(entry.title, matched),
        });
        if (result.outcome === "not_found") {
          counts.notFound += 1;
          results.push({ ...base, result: "not_found" });
          continue;
        }
        const gameKey = normalizeTitle(result.game.title);
        if (gameKey) byTitle.add(gameKey);
        if (key) byTitle.add(key);
        if (result.outcome === "duplicate") {
          counts.existing += 1;
          results.push({ ...base, result: "existing", gameId: result.game.id });
          continue;
        }
        counts.added += 1;
        results.push({ ...base, result: "added", gameId: result.game.id });
        notifyUser("gameUpdated", result.game.id, userId);
      }

      logger.info(
        { userId, received: incoming.length, ...counts },
        "Library import received through the integration API"
      );
      return res.json({ received: incoming.length, ...counts, results });
    } catch (error) {
      logger.error({ error }, "Integration library import failed");
      return res.status(500).json({ error: "Failed to import the library" });
    }
  }
);
