import { categorizeDownload } from "../shared/download-categorizer.js";
import { compareVersions, extractVersionFromReleaseName } from "../shared/version-utils.js";
import type { IStorage } from "./storage.js";
import { logger } from "./logger.js";
import { notifyUser } from "./socket.js";

/**
 * Records the version carried by an installed download's release name (e.g. "v1.2.3") as the
 * game's installed version. Call it once the files are really in place: when the download
 * finishes with post-processing off, or when the import is finalized. Only the full game or an
 * update counts (a DLC's version says nothing about the base game), and a known version is only
 * ever moved forward: an older or incomparable release never overwrites what the user has.
 * Never throws, so a failure here can't break the download or import flow. Returns the version
 * recorded, if any.
 */
export async function recordVersionFromCompletedDownload(
  store: Pick<IStorage, "getGame" | "updateGame">,
  gameId: string,
  downloadTitle: string
): Promise<string | null> {
  try {
    const { category } = categorizeDownload(downloadTitle);
    if (category !== "main" && category !== "update") return null;

    const detected = extractVersionFromReleaseName(downloadTitle);
    if (!detected) return null;

    // Read the current row: an import can run for minutes, during which the user may have
    // edited the version or another import may have advanced it.
    const game = await store.getGame(gameId);
    if (!game) return null;
    if (game.installedVersion?.trim()) {
      const cmp = compareVersions(detected, game.installedVersion);
      if (cmp === null || cmp <= 0) return null;
    }

    await store.updateGame(game.id, { installedVersion: detected });
    logger.info(
      { gameId: game.id, previous: game.installedVersion, installedVersion: detected },
      "Recorded game version from completed download"
    );
    // Lets an open game details modal refresh the games query, which is otherwise never stale.
    notifyUser("gameUpdated", game.id);
    return detected;
  } catch (error) {
    logger.warn(
      { error, gameId, item: downloadTitle },
      "Failed to record game version from completed download"
    );
    return null;
  }
}
