import {
  canAutoWriteVersion,
  carriesBaseGameVersion,
  compareVersions,
  extractVersionFromReleaseName,
} from "../shared/version-utils.js";
import type { IStorage } from "./storage.js";
import { logger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { detectVersionFromInstallFolder } from "./install-version.js";

/**
 * Records the version carried by an installed download's release name (e.g. "v1.2.3") as the
 * game's installed version. Call it once the files are really in place: when the download
 * finishes with post-processing off, or when the import is finalized. Only the full game
 * (editions included) or an update counts (a DLC's version says nothing about the base game),
 * and a known version is only ever moved forward: an older or incomparable release never
 * overwrites what the user has. A version typed by the user is replaced only by a strictly
 * newer, comparable one taken from a release name (a download newer than what was typed). `category` is the one stored with the download, if any;
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
      // A version the user typed is only ever moved forward: a download whose version is
      // strictly newer and comparable advances it; anything else leaves it alone.
      const typed = !canAutoWriteVersion(game);
      if (game.installedVersion?.trim()) {
        const cmp = compareVersions(detected, game.installedVersion);
        if (cmp === null || cmp <= 0) return null;
      } else if (typed) {
        return null;
      }
      const written = await store.replaceGameInstalledVersion(
        game.id,
        game.installedVersion ?? null,
        detected,
        "release",
        typed
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

/**
 * Reads the version from the files of a game's install folder (version.txt, a GOG .info file,
 * a Steam app manifest, an .nfo) and records it. The files are what is really installed, so
 * the version found there replaces one taken from a release name, whatever its order; only a
 * version the user typed is left alone. Never throws. Returns the version recorded, if any.
 */
export async function recordVersionFromInstallFolder(
  store: Pick<IStorage, "getGame" | "replaceGameInstalledVersion">,
  gameId: string,
  folder: string | null | undefined
): Promise<string | null> {
  try {
    if (!folder) return null;
    const detected = await detectVersionFromInstallFolder(folder);
    if (!detected) return null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const game = await store.getGame(gameId);
      if (!game || !canAutoWriteVersion(game)) return null;
      if (game.installedVersion?.trim() === detected && game.installedVersionSource === "install") {
        return null;
      }
      // Files can lag behind (a patch downloaded but not yet applied to the folder): when the
      // two versions compare, the files never move the version backwards.
      if (game.installedVersion?.trim()) {
        const cmp = compareVersions(detected, game.installedVersion);
        if (cmp !== null && cmp < 0) return null;
      }
      const written = await store.replaceGameInstalledVersion(
        game.id,
        game.installedVersion ?? null,
        detected,
        "install"
      );
      if (!written) continue;
      logger.info(
        { gameId: game.id, previous: game.installedVersion, installedVersion: detected },
        "Recorded game version from install files"
      );
      notifyUser("gameUpdated", game.id);
      return detected;
    }
    return null;
  } catch (error) {
    logger.warn({ error, gameId, folder }, "Failed to record game version from install files");
    return null;
  }
}
