import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { igdbLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { DownloaderManager } from "./downloaders.js";

const DELAY_THRESHOLD_DAYS = 7;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

export function startCronJobs() {
  igdbLogger.info("Starting cron jobs...");

  // Run immediately on startup (or after a slight delay to ensure DB is ready)
  setTimeout(() => {
    checkGameUpdates().catch((err) => igdbLogger.error({ err }, "Error in checkGameUpdates"));
    checkDownloadStatus().catch((err) => igdbLogger.error({ err }, "Error in checkDownloadStatus"));
  }, 10000);

  // Schedule periodic checks
  setInterval(() => {
    checkGameUpdates().catch((err) => igdbLogger.error({ err }, "Error in checkGameUpdates"));
  }, CHECK_INTERVAL_MS);

  setInterval(() => {
    checkDownloadStatus().catch((err) => igdbLogger.error({ err }, "Error in checkDownloadStatus"));
  }, DOWNLOAD_CHECK_INTERVAL_MS);
}

async function checkGameUpdates() {
  igdbLogger.info("Checking for game updates...");

  const allGames = await storage.getAllGames();

  // Filter games that are tracked (have IGDB ID)
  const gamesToCheck = allGames.filter((g) => g.igdbId !== null);

  if (gamesToCheck.length === 0) {
    igdbLogger.info("No games to check for updates.");
    return;
  }

  const igdbIds = gamesToCheck.map((g) => g.igdbId as number);

  // Batch fetch from IGDB
  const igdbGames = await igdbClient.getGamesByIds(igdbIds);
  const igdbGameMap = new Map(igdbGames.map((g) => [g.id, g]));

  let updatedCount = 0;

  for (const game of gamesToCheck) {
    const igdbGame = igdbGameMap.get(game.igdbId!);

    if (!igdbGame || !igdbGame.first_release_date) continue;

    const currentReleaseDate = new Date(igdbGame.first_release_date * 1000);
    const currentReleaseDateStr = currentReleaseDate.toISOString().split("T")[0];

    // Initialize originalReleaseDate if not set
    if (!game.originalReleaseDate) {
      if (game.releaseDate) {
        await storage.updateGame(game.id, { originalReleaseDate: game.releaseDate });
        game.originalReleaseDate = game.releaseDate;
      } else {
        await storage.updateGame(game.id, {
          releaseDate: currentReleaseDateStr,
          originalReleaseDate: currentReleaseDateStr,
        });
        continue;
      }
    }

    // Now compare
    const storedOriginalDate = new Date(game.originalReleaseDate!);
    const diffTime = currentReleaseDate.getTime() - storedOriginalDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let newReleaseStatus: "released" | "upcoming" | "delayed" | "tbd" = "upcoming";
    const now = new Date();

    if (currentReleaseDate <= now) {
      newReleaseStatus = "released";
    } else if (diffDays > DELAY_THRESHOLD_DAYS) {
      newReleaseStatus = "delayed";
    } else {
      newReleaseStatus = "upcoming";
    }

    // Check if released status changed to released
    if (newReleaseStatus === "released" && game.releaseStatus !== "released") {
      const message = `${game.title} is now available!`;
      const notification = await storage.addNotification({
        type: "success",
        title: "Game Released",
        message,
      });
      notifyUser("notification", notification);
    }

    // If things changed, update DB
    if (game.releaseDate !== currentReleaseDateStr || game.releaseStatus !== newReleaseStatus) {
      igdbLogger.info(
        {
          game: game.title,
          oldDate: game.releaseDate,
          newDate: currentReleaseDateStr,
          oldStatus: game.releaseStatus,
          newStatus: newReleaseStatus,
          diffDays,
        },
        "Game release updated"
      );

      await storage.updateGame(game.id, {
        releaseDate: currentReleaseDateStr,
        releaseStatus: newReleaseStatus,
      });
      updatedCount++;

      // Send notification if game is delayed
      if (newReleaseStatus === "delayed" && game.releaseStatus !== "delayed") {
        const message = `${game.title} has been delayed to ${currentReleaseDateStr}`;
        const notification = await storage.addNotification({
          type: "delayed",
          title: "Game Delayed",
          message,
        });
        notifyUser("notification", notification);
      }
    }
  }

  igdbLogger.info(
    { updatedCount, checkedCount: gamesToCheck.length },
    "Finished checking for game updates."
  );
}

async function checkDownloadStatus() {
  igdbLogger.debug("Checking download status...");

  const downloadingTorrents = await storage.getDownloadingGameTorrents();

  if (downloadingTorrents.length === 0) {
    return;
  }

  // Group by downloader
  const torrentsByDownloader = new Map<string, typeof downloadingTorrents>();
  for (const t of downloadingTorrents) {
    const list = torrentsByDownloader.get(t.downloaderId) || [];
    list.push(t);
    torrentsByDownloader.set(t.downloaderId, list);
  }

  const entries = Array.from(torrentsByDownloader.entries());
  for (const [downloaderId, torrents] of entries) {
    const downloader = await storage.getDownloader(downloaderId);
    if (!downloader || !downloader.enabled) continue;

    try {
      const activeTorrents = await DownloaderManager.getAllTorrents(downloader);
      const activeTorrentMap = new Map(activeTorrents.map((t) => [t.id.toLowerCase(), t]));

      for (const torrent of torrents) {
        // Match by hash (handle case sensitivity just in case)
        const remoteTorrent = activeTorrentMap.get(torrent.torrentHash.toLowerCase());

        if (remoteTorrent) {
          // Check for completion
          // Status can be 'completed' or 'seeding'
          if (remoteTorrent.status === "completed" || remoteTorrent.status === "seeding") {
            igdbLogger.info(
              { torrent: torrent.torrentTitle, status: remoteTorrent.status },
              "Torrent download completed"
            );

            // Update DB
            await storage.updateGameTorrentStatus(torrent.id, "completed");

            // Update Game status to 'owned' (which means we have the files)
            await storage.updateGameStatus(torrent.gameId, { status: "owned" });

            // Fetch game title for notification
            const game = await storage.getGame(torrent.gameId);
            const gameTitle = game ? game.title : torrent.torrentTitle;

            // Send notification
            const message = `Download finished for ${gameTitle}`;
            const notification = await storage.addNotification({
              type: "success",
              title: "Download Completed",
              message,
            });
            notifyUser("notification", notification);
          } else if (remoteTorrent.status === "error") {
            // Should we notify on error? Maybe later.
            igdbLogger.warn(
              { torrent: torrent.torrentTitle, error: remoteTorrent.error },
              "Torrent error detected"
            );
          }
        } else {
          // Torrent not found in downloader anymore?
          // Maybe it was removed manually or by 'remove completed' setting.
          // If removeCompleted is true, we might assume it finished if it was close to done?
          // But simpler to just ignore or mark as failed if it vanishes without completion.
          // For now, do nothing.
        }
      }
    } catch (error) {
      igdbLogger.error({ error, downloaderId }, "Error checking downloader status");
    }
  }
}
