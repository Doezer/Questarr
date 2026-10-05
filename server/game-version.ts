import {
  carriesBaseGameVersion,
  compareVersions,
  extractVersionFromReleaseName,
} from "../shared/version-utils.js";
import type { IStorage } from "./storage.js";
import { logger } from "./logger.js";
import { notifyUser } from "./socket.js";

/**
 * Records the version carried by an installed download's release name (e.g. "v1.2.3") as the
 * game's installed version. Call it once the files are really in place: when the download
 * finishes with post-processing off, or when the import is finalized. Only the full game
 * (editions included) or an update counts (a DLC's version says nothing about the base game),
 * and a known version is only ever moved forward: an older or incomparable release never
 * overwrites what the user has. `category` is the one stored with the download, if any;
 * otherwise it is inferred from the title.
 * Never throws, so a failure here can't break the download or import flow. Returns the version
 * recorded, if any.
 */
export async function recordVersionFromCompletedDownload(
  store: Pick<IStorage, "getGame" | "replaceGameInstalledVersion">,
  gameId: string,
  downloadTitle: string,
  category: string | null = null
): Promise<string | null> {
  try {
    if (!carriesBaseGameVersion(downloadTitle, category)) return null;

    const detected = extractVersionFromReleaseName(downloadTitle);
    if (!detected) return null;

    // Read the current row: an import can run for minutes, during which the user may have
    // edited the version or another import may have advanced it. The write only lands if the
    // version is still the one just compared against; if something else wrote first, compare
    // again against what it wrote, so a concurrent older import can't hold back a newer one.
    let game: Awaited<ReturnType<typeof store.getGame>>;
    for (let attempt = 0; ; attempt++) {
      game = await store.getGame(gameId);
      if (!game) return null;
      if (game.installedVersion?.trim()) {
        const cmp = compareVersions(detected, game.installedVersion);
        if (cmp === null || cmp <= 0) return null;
      }
      const written = await store.replaceGameInstalledVersion(
        game.id,
        game.installedVersion ?? null,
        detected
      );
      if (written) break;
      if (attempt >= 2) return null;
    }
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
