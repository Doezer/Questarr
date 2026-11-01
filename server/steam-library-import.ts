import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { getContentFilterFlags, isContentFiltered } from "./content-filter.js";
import { normalizeInitialReleaseStatus } from "./game-status.js";
import { insertGameSchema } from "../shared/schema.js";
import { notifyUser } from "./socket.js";
import type { SteamOwnedGame } from "./steam.js";
import type { SteamImportResult } from "../shared/steam-library.js";

// One import operation per account, shared by synchronous and background imports.
export const steamLibraryImporting = new Set<string>();

/** Process one bounded batch. Ownership must already have been verified by the caller. */
export async function importSteamLibraryBatch(
  userId: string,
  selected: SteamOwnedGame[]
): Promise<SteamImportResult[]> {
  const ids = selected.map((game) => game.steamAppId);
  const byAppId = new Map(selected.map((game) => [game.steamAppId, game]));
  const library = await storage.getUserGames(userId, true);
  const tracked = new Set(library.map((game) => game.steamAppId));
  const mappings = await igdbClient.getGameIdsBySteamAppIds(ids.filter((id) => !tracked.has(id)));
  const byIgdb = new Map(
    library.filter((game) => game.igdbId != null).map((game) => [game.igdbId!, game])
  );
  const newIgdbIds = [...new Set(mappings.values())].filter((id) => !byIgdb.has(id));
  const [details, filterFlags] = await Promise.all([
    igdbClient.getGamesByIds(newIgdbIds),
    getContentFilterFlags(userId),
  ]);
  const detailsById = new Map(details.map((game) => [game.id, game]));
  const results: SteamImportResult[] = [];
  let changedGameId: string | undefined;
  for (const id of ids) {
    const game = byAppId.get(id)!;
    if (tracked.has(id)) {
      results.push({ ...game, outcome: "duplicate" });
      continue;
    }
    const igdbId = mappings.get(id);
    if (!igdbId) {
      results.push({ ...game, outcome: "not_found" });
      continue;
    }
    try {
      const existing = byIgdb.get(igdbId);
      if (existing) {
        // Link an exact match once so later previews recognize it. Never replace
        // another edition's App ID or alter the existing game's status/progress.
        if (existing.steamAppId == null) {
          await storage.updateGame(existing.id, { steamAppId: id });
          changedGameId ??= existing.id;
          existing.steamAppId = id;
        }
        results.push({ ...game, outcome: "duplicate" });
        continue;
      }
      const detail = detailsById.get(igdbId);
      if (!detail) {
        results.push({ ...game, outcome: "not_found" });
        continue;
      }
      const data = insertGameSchema.parse({
        ...igdbClient.formatGameData(detail),
        userId,
        igdbId,
        steamAppId: id,
        status: "owned",
        source: "steam",
      });
      if (isContentFiltered(data, filterFlags)) {
        results.push({ ...game, outcome: "not_found" });
        continue;
      }
      const added = await storage.addGame(normalizeInitialReleaseStatus(data));
      changedGameId ??= added.id;
      byIgdb.set(igdbId, added);
      results.push({ ...game, outcome: "added" });
    } catch {
      // Keep successful rows and let the user retry only failures. Never log provider URLs/keys.
      results.push({ ...game, outcome: "failed" });
    }
  }
  // The app-wide listener refreshes cached games even when Settings is closed.
  // One owner-scoped signal per changed batch avoids a burst of per-game events.
  if (changedGameId) notifyUser("gameUpdated", changedGameId, userId);
  return results;
}
