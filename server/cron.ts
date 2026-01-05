import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { igdbLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { DownloaderManager } from "./downloaders.js";
import { torznabClient } from "./torznab.js";
import { type Game } from "../shared/schema.js";

const DELAY_THRESHOLD_DAYS = 7;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const AUTO_SEARCH_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Track last search time per user
const lastAutoSearchTime = new Map<string, number>();

export function startCronJobs() {
  igdbLogger.info("🕐 Starting cron jobs...");
  igdbLogger.info(
    {
      gameUpdates: `every ${CHECK_INTERVAL_MS / 1000 / 60 / 60} hours`,
      downloadStatus: `every ${DOWNLOAD_CHECK_INTERVAL_MS / 1000} seconds`,
      autoSearch: `every ${AUTO_SEARCH_CHECK_INTERVAL_MS / 1000 / 60} minutes`,
    },
    "Cron job intervals configured"
  );

  // Run immediately on startup (or after a slight delay to ensure DB is ready)
  setTimeout(() => {
    igdbLogger.info("🚀 Running initial cron job checks...");
    checkGameUpdates().catch((err) => igdbLogger.error({ err }, "Error in checkGameUpdates"));
    checkDownloadStatus().catch((err) => igdbLogger.error({ err }, "Error in checkDownloadStatus"));
    checkAutoSearch().catch((err) => igdbLogger.error({ err }, "Error in checkAutoSearch"));
  }, 10000);

  // Schedule periodic checks
  setInterval(() => {
    checkGameUpdates().catch((err) => igdbLogger.error({ err }, "Error in checkGameUpdates"));
  }, CHECK_INTERVAL_MS);

  setInterval(() => {
    checkDownloadStatus().catch((err) => igdbLogger.error({ err }, "Error in checkDownloadStatus"));
  }, DOWNLOAD_CHECK_INTERVAL_MS);

  setInterval(() => {
    checkAutoSearch().catch((err) => igdbLogger.error({ err }, "Error in checkAutoSearch"));
  }, AUTO_SEARCH_CHECK_INTERVAL_MS);
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
  const downloadingTorrents = await storage.getDownloadingGameTorrents();

  igdbLogger.info({ downloadingCount: downloadingTorrents.length }, "Checking download status");

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

      igdbLogger.debug(
        { downloaderId, activeTorrentCount: activeTorrents.length, trackingCount: torrents.length },
        "Checking torrents for downloader"
      );

      for (const torrent of torrents) {
        // Match by hash (handle case sensitivity just in case)
        const remoteTorrent = activeTorrentMap.get(torrent.torrentHash.toLowerCase());

        if (remoteTorrent) {
          igdbLogger.debug(
            {
              torrent: torrent.torrentTitle,
              status: remoteTorrent.status,
              progress: remoteTorrent.progress,
              dbStatus: torrent.status,
              dbHash: torrent.torrentHash,
              found: true,
            },
            "Checking torrent status"
          );

          // Check for completion
          // A torrent is considered complete if:
          // 1. Status is 'completed' or 'seeding', OR
          // 2. Progress is 100% (handles edge cases where status might not update correctly)
          const isComplete =
            remoteTorrent.status === "completed" ||
            remoteTorrent.status === "seeding" ||
            remoteTorrent.progress >= 100;

          if (isComplete) {
            igdbLogger.info(
              {
                torrent: torrent.torrentTitle,
                status: remoteTorrent.status,
                progress: remoteTorrent.progress,
              },
              "Torrent download completed (or seeding)"
            );

            // Update DB - mark as completed even if seeding
            await storage.updateGameTorrentStatus(torrent.id, "completed");

            // Update Game status to 'owned' (which means we have the files)
            await storage.updateGameStatus(torrent.gameId, { status: "owned" });
            
            igdbLogger.info(
              { gameId: torrent.gameId, downloadId: torrent.id },
              "Updated game status to 'owned' after completion"
            );

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
          } else {
            // Sync download status with actual status from downloader
            let newDownloadStatus: "downloading" | "paused" | "failed" | "completed" = "downloading";
            let newGameStatus: "wanted" | "downloading" | "owned" = "downloading";

            if (remoteTorrent.status === "error") {
              newDownloadStatus = "failed";
              newGameStatus = "wanted"; // Reset to wanted on error
              igdbLogger.warn(
                { torrent: torrent.torrentTitle, error: remoteTorrent.error },
                "Torrent error detected"
              );
            } else if (remoteTorrent.status === "paused") {
              newDownloadStatus = "paused";
              newGameStatus = "downloading"; // Still consider it downloading (user can resume)
            } else if (remoteTorrent.status === "downloading") {
              newDownloadStatus = "downloading";
              newGameStatus = "downloading";
            }

            // Only update if status changed
            if (torrent.status !== newDownloadStatus) {
              await storage.updateGameTorrentStatus(torrent.id, newDownloadStatus);
              igdbLogger.debug(
                { torrent: torrent.torrentTitle, oldStatus: torrent.status, newStatus: newDownloadStatus },
                "Updated download status"
              );
            }

            // Update game status
            const game = await storage.getGame(torrent.gameId);
            if (game && game.status !== newGameStatus) {
              await storage.updateGameStatus(torrent.gameId, { status: newGameStatus });
              igdbLogger.debug(
                { gameId: torrent.gameId, oldStatus: game.status, newStatus: newGameStatus },
                "Updated game status"
              );
            }
          }
        } else {
          // Torrent not found in downloader anymore
          // This can happen if:
          // 1. Hash mismatch between DB and qBittorrent
          // 2. Torrent was completed and removed by 'remove completed' setting
          // 3. Torrent was manually removed by user
          // 4. Downloader was restarted and lost the torrent
          
          igdbLogger.warn(
            { 
              torrent: torrent.torrentTitle,
              dbHash: torrent.torrentHash,
              dbHashLower: torrent.torrentHash.toLowerCase(),
              activeHashesCount: activeTorrentMap.size,
              firstFewActiveHashes: Array.from(activeTorrentMap.keys()).slice(0, 5),
            },
            "Torrent missing from downloader - hash mismatch or removed"
          );

          // Mark download as completed
          await storage.updateGameTorrentStatus(torrent.id, "completed");

          // Update game status to owned (assume completion rather than cancellation)
          await storage.updateGameStatus(torrent.gameId, { status: "owned" });
          
          igdbLogger.info(
            { gameId: torrent.gameId },
            "Updated game status to 'owned' after torrent removal"
          );
        }
      }
    } catch (error) {
      igdbLogger.error({ error, downloaderId }, "Error checking downloader status");
    }
  }
}

async function checkAutoSearch() {
  igdbLogger.debug("Checking auto-search for wanted games...");

  try {
    // Get all users to check their settings
    const allGames = await storage.getAllGames();

    // Group games by user
    const gamesByUser = new Map<string, typeof allGames>();
    for (const game of allGames) {
      if (game.userId) {
        const userGames = gamesByUser.get(game.userId) || [];
        userGames.push(game);
        gamesByUser.set(game.userId, userGames);
      }
    }

    for (const [userId, userGames] of Array.from(gamesByUser.entries())) {
      try {
        const settings = await storage.getUserSettings(userId);

        // Skip if auto-search is disabled
        if (!settings || !settings.autoSearchEnabled) {
          continue;
        }

        // Check if enough time has passed since last search
        const lastSearch = lastAutoSearchTime.get(userId) || 0;
        const timeSinceLastSearch = Date.now() - lastSearch;
        const intervalMs = settings.searchIntervalHours * 60 * 60 * 1000;

        if (timeSinceLastSearch < intervalMs) {
          continue;
        }

        // Get enabled indexers
        const indexers = await storage.getEnabledIndexers();
        if (indexers.length === 0) {
          igdbLogger.debug({ userId }, "No indexers configured, skipping auto-search");
          continue;
        }

        // Filter wanted games (not owned, not downloading)
        const wantedGames = userGames.filter((g: Game) => g.status === "wanted" && !g.hidden);

        if (wantedGames.length === 0) {
          igdbLogger.debug({ userId }, "No wanted games found");
          lastAutoSearchTime.set(userId, Date.now());
          continue;
        }

        igdbLogger.info(
          { userId, gameCount: wantedGames.length },
          "Starting auto-search for wanted games"
        );

        let gamesWithTorrents = 0;

        for (const game of wantedGames) {
          try {
            // Search for the game across all indexers
            const { results, errors } = await torznabClient.searchMultipleIndexers(indexers, {
              query: game.title,
              limit: 10,
            });

            if (errors.length > 0) {
              igdbLogger.warn({ gameTitle: game.title, errors }, "Errors during torrent search");
            }

            if (results.items.length === 0) {
              continue;
            }

            gamesWithTorrents++;

            // Filter "Main" torrents (not updates/DLC)
            const mainTorrents = results.items.filter((item) => {
              const title = item.title.toLowerCase();
              return (
                !title.includes("update") && !title.includes("dlc") && !title.includes("patch")
              );
            });

            // Check for updates
            const updateTorrents = results.items.filter((item) => {
              const title = item.title.toLowerCase();
              return title.includes("update") || title.includes("patch");
            });

            // Notify about updates if setting enabled
            if (updateTorrents.length > 0 && settings.notifyUpdates) {
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Game Updates Available",
                message: `${updateTorrents.length} update(s) found for ${game.title}`,
              });
              notifyUser("notification", notification);
            }

            // Handle main torrents
            if (mainTorrents.length === 0) {
              continue;
            }

            if (mainTorrents.length === 1) {
              // Single torrent found
              if (settings.autoDownloadEnabled) {
                // Auto-download if enabled
                const torrent = mainTorrents[0];
                const downloaders = await storage.getEnabledDownloaders();

                if (downloaders.length > 0) {
                  try {
                    const result = await DownloaderManager.addTorrentWithFallback(downloaders, {
                      url: torrent.link,
                      title: torrent.title,
                    });

                    if (result && result.success && result.id && result.downloaderId) {
                      // Track torrent
                      await storage.addGameTorrent({
                        gameId: game.id,
                        downloaderId: result.downloaderId,
                        torrentHash: result.id,
                        torrentTitle: torrent.title,
                        status: "downloading",
                      });

                      // Update game status
                      await storage.updateGameStatus(game.id, { status: "downloading" });

                      // Notify success
                      const notification = await storage.addNotification({
                        userId,
                        type: "success",
                        title: "Download Started",
                        message: `Started downloading ${game.title}`,
                      });
                      notifyUser("notification", notification);

                      igdbLogger.info({ gameTitle: game.title }, "Auto-downloaded torrent");
                    }
                  } catch (error) {
                    igdbLogger.error(
                      { gameTitle: game.title, error },
                      "Failed to auto-download torrent"
                    );
                  }
                }
              } else {
                // Just notify about availability
                const notification = await storage.addNotification({
                  userId,
                  type: "success",
                  title: "Game Available",
                  message: `${game.title} is now available for download`,
                });
                notifyUser("notification", notification);
              }
            } else if (mainTorrents.length > 1 && settings.notifyMultipleTorrents) {
              // Multiple torrents found, notify user to choose
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Multiple Torrents Found",
                message: `${mainTorrents.length} torrent(s) found for ${game.title}. Please review and choose.`,
              });
              notifyUser("notification", notification);
            }
          } catch (error) {
            igdbLogger.error({ gameTitle: game.title, error }, "Error searching for game torrents");
          }
        }

        igdbLogger.info(
          { userId, wantedGames: wantedGames.length, gamesWithTorrents },
          "Completed auto-search"
        );

        // Update last search time
        lastAutoSearchTime.set(userId, Date.now());
      } catch (error) {
        igdbLogger.error({ userId, error }, "Error processing auto-search for user");
      }
    }
  } catch (error) {
    igdbLogger.error({ error }, "Error in checkAutoSearch");
  }
}
