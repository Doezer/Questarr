import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
// Relative path, not the "@shared" alias: that alias only resolves for Vite's
// client build and for type-only imports here (which tsc elides entirely).
// insertGameSchema is a runtime value, so an alias import would compile
// cleanly but crash Node at startup — there is no "@shared" package to
// resolve once this ships as plain ESM in dist/.
import { insertGameSchema, type Game } from "../shared/schema.js";
import { getContentFilterFlags, isContentFiltered } from "./content-filter.js";
import { normalizeInitialReleaseStatus } from "./game-status.js";

/**
 * Result of a title-based quick add. A discriminated union rather than
 * throwing/returning null, so callers (the browser "quick add" flow and the
 * integration API's "request a game" endpoint) can each map the same three
 * outcomes onto their own response shape.
 */
export type QuickAddResult =
  | { outcome: "added"; game: Game }
  | { outcome: "not_found" }
  | { outcome: "duplicate"; game: Game };

/**
 * Searches IGDB for a free-text title and adds the best match to the user's
 * library. Shared by `POST /api/games/match-and-add` (browser quick-add) and
 * `POST /api/integration/games/request` (Playnite and other machine clients)
 * so the two surfaces can never drift on matching, content-filtering, or
 * dedupe behavior.
 *
 * A content-filtered match is reported as `not_found`, deliberately
 * indistinguishable from no match at all: a filtered title must not be
 * discoverable through either endpoint.
 */
export async function quickAddGameByTitle(
  userId: string,
  title: string,
  options: { status?: "wanted" | "owned"; source?: Game["source"] } = {}
): Promise<QuickAddResult> {
  const igdbResults = await igdbClient.searchGames(title, 1);
  if (igdbResults.length === 0) {
    return { outcome: "not_found" };
  }

  const match = igdbClient.formatGameData(igdbResults[0]);
  const filterFlags = await getContentFilterFlags(userId);
  if (
    isContentFiltered(match as { isAdultContent?: boolean; isAgeRestricted?: boolean }, filterFlags)
  ) {
    return { outcome: "not_found" };
  }

  const gameData = insertGameSchema.parse({
    userId,
    title: match.title,
    igdbId: match.igdbId,
    status: options.status ?? "wanted",
    platform: "PC", // Default platform, user can change later
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
    ...(options.source ? { source: options.source } : {}),
  });

  const userGames = await storage.getUserGames(userId, true);
  const existingGame = userGames.find((g) =>
    gameData.igdbId != null
      ? g.igdbId === gameData.igdbId
      : g.title.toLowerCase() === gameData.title.toLowerCase()
  );
  if (existingGame) {
    return { outcome: "duplicate", game: existingGame };
  }

  const game = await storage.addGame(normalizeInitialReleaseStatus(gameData));
  return { outcome: "added", game };
}
