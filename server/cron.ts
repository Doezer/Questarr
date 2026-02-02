import { storage } from "./storage.js";
import { igdbClient } from "./igdb.js";
import { igdbLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { DownloaderManager } from "./downloaders.js";
import { searchAllIndexers } from "./search.js";
import { xrelClient, DEFAULT_XREL_BASE } from "./xrel.js";

import { downloadRulesSchema } from "../shared/schema.js";
import { categorizeDownload } from "../shared/download-categorizer.js";
import { releaseMatchesGame, normalizeTitle, cleanReleaseName } from "../shared/title-utils.js";

const DELAY_THRESHOLD_DAYS = 7;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const AUTO_SEARCH_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const XREL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours (xREL search rate limit: 2/5s)

export function startCronJobs() {
  igdbLogger.info("Starting cron jobs...");
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
    igdbLogger.info("Running initial cron job checks...");
    checkGameUpdates().catch((err) => igdbLogger.error({ err }, "Error in checkGameUpdates"));
    checkDownloadStatus().catch((err) => igdbLogger.error({ err }, "Error in checkDownloadStatus"));
    checkAutoSearch().catch((err) => igdbLogger.error({ err }, "Error in checkAutoSearch"));
    checkXrelReleases().catch((err) => igdbLogger.error({ err }, "Error in checkXrelReleases"));
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

  setInterval(() => {
    checkXrelReleases().catch((err) => igdbLogger.error({ err }, "Error in checkXrelReleases"));
  }, XREL_CHECK_INTERVAL_MS);
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
  let igdbGames;
  try {
    igdbGames = await igdbClient.getGamesByIds(igdbIds);
  } catch (error) {
    if (error instanceof Error) {
      const err = error as Error & { code?: string };
      if (
        err.code === "ENOTFOUND" ||
        err.code === "EAI_AGAIN" ||
        err.message.includes("fetch failed")
      ) {
        igdbLogger.warn(
          { error: err.message },
          "Network error fetching updates from IGDB. Skipping this check."
        );
        return;
      }
    }
    throw error;
  }

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
  const downloadingDownloads = await storage.getDownloadingGameDownloads();

  igdbLogger.info({ downloadingCount: downloadingDownloads.length }, "Checking download status");

  if (downloadingDownloads.length === 0) {
    return;
  }

  // Group by downloader
  const downloadsByDownloader = new Map<string, typeof downloadingDownloads>();
  for (const d of downloadingDownloads) {
    const list = downloadsByDownloader.get(d.downloaderId) || [];
    list.push(d);
    downloadsByDownloader.set(d.downloaderId, list);
  }

  const entries = Array.from(downloadsByDownloader.entries());
  for (const [downloaderId, downloads] of entries) {
    const downloader = await storage.getDownloader(downloaderId);
    if (!downloader || !downloader.enabled) continue;

    try {
      const activeDownloads = await DownloaderManager.getAllDownloads(downloader);
      const activeDownloadMap = new Map(activeDownloads.map((t) => [t.id.toLowerCase(), t]));

      igdbLogger.debug(
        {
          downloaderId,
          activeDownloadCount: activeDownloads.length,
          trackingCount: downloads.length,
        },
        "Checking downloads for downloader"
      );

      for (const download of downloads) {
        // Match by hash/ID (handle case sensitivity just in case)
        const remoteDownload = activeDownloadMap.get(download.downloadHash.toLowerCase());

        if (remoteDownload) {
          igdbLogger.debug(
            {
              item: download.downloadTitle,
              status: remoteDownload.status,
              progress: remoteDownload.progress,
              dbStatus: download.status,
              dbHash: download.downloadHash,
              found: true,
            },
            "Checking download status"
          );

          // Check for completion
          const isComplete =
            remoteDownload.status === "completed" ||
            remoteDownload.status === "seeding" ||
            remoteDownload.progress >= 100;

          if (isComplete) {
            igdbLogger.info(
              {
                item: download.downloadTitle,
                status: remoteDownload.status,
                progress: remoteDownload.progress,
              },
              "Download completed"
            );

            // Update DB - mark as completed
            await storage.updateGameDownloadStatus(download.id, "completed");

            // Update Game status to 'owned' (which means we have the files)
            await storage.updateGameStatus(download.gameId, { status: "owned" });

            igdbLogger.info(
              { gameId: download.gameId, downloadId: download.id },
              "Updated game status to 'owned' after completion"
            );

            // Fetch game title for notification
            const game = await storage.getGame(download.gameId);
            const gameTitle = game ? game.title : download.downloadTitle;

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
            let newDownloadStatus: "downloading" | "paused" | "failed" | "completed" =
              "downloading";
            let newGameStatus: "wanted" | "downloading" | "owned" = "downloading";

            if (remoteDownload.status === "error") {
              newDownloadStatus = "failed";
              newGameStatus = "wanted"; // Reset to wanted on error
              igdbLogger.warn(
                { title: download.downloadTitle, error: remoteDownload.error },
                "Download error detected"
              );
            } else if (remoteDownload.status === "paused") {
              newDownloadStatus = "paused";
              newGameStatus = "downloading"; // Still consider it downloading (user can resume)
            } else if (remoteDownload.status === "downloading") {
              newDownloadStatus = "downloading";
              newGameStatus = "downloading";
            }

            // Only update if status changed
            if (download.status !== newDownloadStatus) {
              await storage.updateGameDownloadStatus(download.id, newDownloadStatus);
              igdbLogger.debug(
                {
                  title: download.downloadTitle,
                  oldStatus: download.status,
                  newStatus: newDownloadStatus,
                },
                "Updated download status"
              );
            }

            // Update game status
            const game = await storage.getGame(download.gameId);
            if (game && game.status !== newGameStatus) {
              await storage.updateGameStatus(download.gameId, { status: newGameStatus });
              igdbLogger.debug(
                { gameId: download.gameId, oldStatus: game.status, newStatus: newGameStatus },
                "Updated game status"
              );
            }
          }
        } else {
          // Download missing from downloader
          // NOTE: This could happen for several reasons:
          // 1. Download completed and was removed by the user
          // 2. Download failed and was manually removed
          // 3. Download was cancelled by the user
          // 4. Downloader was cleared/reset
          // Currently, we assume completion, but this may not always be correct.
          // TODO: Consider adding a user preference to handle this scenario differently
          // (e.g., reset to "wanted" status, or require manual confirmation)

          // Fetch game info for better logging and notification
          const game = await storage.getGame(download.gameId);
          const gameTitle = game ? game.title : download.downloadTitle;

          igdbLogger.warn(
            {
              gameId: download.gameId,
              downloadId: download.id,
              downloadTitle: download.downloadTitle,
              gameTitle,
              downloadHash: download.downloadHash,
            },
            "Download not found in downloader - assuming completion and marking as owned. " +
            "This could indicate the download was manually removed."
          );

          // Mark download as completed (assumption)
          await storage.updateGameDownloadStatus(download.id, "completed");

          // Update game status to owned (assumption)
          await storage.updateGameStatus(download.gameId, { status: "owned" });

          // Send notification to user about this automatic status change
          const notification = await storage.addNotification({
            type: "info",
            title: "Download Status Changed",
            message: `Download for "${gameTitle}" was not found in the downloader and has been marked as completed. If this was removed due to an error, you may need to re-download it.`,
          });
          notifyUser("notification", notification);

          igdbLogger.info(
            { gameId: download.gameId, gameTitle },
            "Automatically updated game status to 'owned' after download not found in downloader"
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
    // Get wanted games grouped by user directly from storage (optimized)
    const gamesByUser = await storage.getWantedGamesGroupedByUser();

    for (const [userId, userGames] of Array.from(gamesByUser.entries())) {
      try {
        const settings = await storage.getUserSettings(userId);

        // Skip if auto-search is disabled
        if (!settings || !settings.autoSearchEnabled) {
          continue;
        }

        // Check if enough time has passed since last search
        const lastSearch = settings.lastAutoSearch
          ? new Date(settings.lastAutoSearch).getTime()
          : 0;
        const timeSinceLastSearch = Date.now() - lastSearch;
        const intervalMs = settings.searchIntervalHours * 60 * 60 * 1000;

        if (timeSinceLastSearch < intervalMs) {
          continue;
        }

        // Games are already filtered for wanted and not hidden by the storage query
        const wantedGames = userGames;

        if (wantedGames.length === 0) {
          igdbLogger.debug({ userId }, "No wanted games found");
          // Update last search time even if no games found, to avoid checking again too soon
          await storage.updateUserSettings(userId, { lastAutoSearch: new Date() });
          continue;
        }

        igdbLogger.info(
          { userId, gameCount: wantedGames.length },
          "Starting auto-search for wanted games"
        );

        let gamesWithResults = 0;

        for (const game of wantedGames) {
          try {
            // Search for the game across all indexers
            const { items, errors } = await searchAllIndexers({
              query: game.title,
              limit: 10,
            });

            if (errors.length > 0) {
              igdbLogger.warn({ gameTitle: game.title, errors }, "Errors during search");
            }

            if (items.length === 0) {
              continue;
            }

            // Double-check matches locally to ensure they actually match the game title
            const matchedItems = items.filter((item) => releaseMatchesGame(item.title, game.title));

            if (matchedItems.length === 0) {
              igdbLogger.debug(
                { gameTitle: game.title, originalCount: items.length },
                "No items passed strict title matching"
              );
              continue;
            }

            gamesWithResults++;

            // Load download rules from settings
            let minSeeders = 0;
            let sortBy: "seeders" | "date" | "size" = "seeders";
            let visibleCategoriesSet = new Set(["main", "update", "dlc", "extra"]);

            if (settings.downloadRules) {
              try {
                const parsed = JSON.parse(settings.downloadRules);
                const rules = downloadRulesSchema.parse(parsed);
                minSeeders = rules.minSeeders;
                sortBy = rules.sortBy;
                visibleCategoriesSet = new Set(rules.visibleCategories);
              } catch (error) {
                igdbLogger.warn({ gameTitle: game.title, error }, "Failed to parse download rules");
              }
            }

            // Filter items by seeders
            let filteredItems = matchedItems.filter((item) => {
              const seeders = item.seeders ?? 0;
              return seeders >= minSeeders;
            });

            // Sort items according to rules
            filteredItems = filteredItems.sort((a, b) => {
              if (sortBy === "seeders") {
                return (b.seeders ?? 0) - (a.seeders ?? 0);
              } else if (sortBy === "date") {
                return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
              } else {
                // size
                return (b.size ?? 0) - (a.size ?? 0);
              }
            });

            // Filter and categorize items based on visible categories
            const categorizedItems = filteredItems
              .map((item) => {
                const { category } = categorizeDownload(item.title);
                return { item, category };
              })
              .filter(({ category }) => visibleCategoriesSet.has(category));

            const mainItems = categorizedItems
              .filter(({ category }) => category === "main")
              .map(({ item }) => item);

            const updateItems = categorizedItems
              .filter(({ category }) => category === "update")
              .map(({ item }) => item);

            // Notify about updates if setting enabled
            if (updateItems.length > 0 && settings.notifyUpdates) {
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Game Updates Available",
                message: `${updateItems.length} update(s) found for ${game.title}`,
              });
              notifyUser("notification", notification);
            }

            // Handle main items
            if (mainItems.length === 0) {
              continue;
            }

            if (mainItems.length === 1) {
              // Single result found
              if (settings.autoDownloadEnabled) {
                // Auto-download if enabled
                const item = mainItems[0];
                const downloaders = await storage.getEnabledDownloaders();

                if (downloaders.length > 0) {
                  try {
                    const result = await DownloaderManager.addDownloadWithFallback(downloaders, {
                      url: item.link,
                      title: item.title,
                    });

                    if (result && result.success && result.id && result.downloaderId) {
                      // Track download
                      await storage.addGameDownload({
                        gameId: game.id,
                        downloaderId: result.downloaderId,
                        downloadHash: result.id,
                        downloadTitle: item.title,
                        status: "downloading",
                        downloadType: item.downloadType,
                      });

                      // Update game status
                      await storage.updateGameStatus(game.id, { status: "downloading" });

                      // Notify success
                      const notification = await storage.addNotification({
                        userId,
                        type: "success",
                        title: "Download Started",
                        message: `Started downloading ${game.title} via ${item.downloadType === "usenet" ? "Usenet" : "Torrent"}`,
                      });
                      notifyUser("notification", notification);

                      igdbLogger.info(
                        { gameTitle: game.title, type: item.downloadType },
                        "Auto-downloaded result"
                      );
                    }
                  } catch (error) {
                    igdbLogger.error({ gameTitle: game.title, error }, "Failed to auto-download");
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
            } else if (mainItems.length > 1 && settings.notifyMultipleDownloads) {
              // Multiple results found, notify user to choose
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Multiple Results Found",
                message: `${mainItems.length} result(s) found for ${game.title}. Please review and choose.`,
              });
              notifyUser("notification", notification);
            }
          } catch (error) {
            igdbLogger.error({ gameTitle: game.title, error }, "Error searching for game");
          }
        }

        igdbLogger.info(
          { userId, wantedGames: wantedGames.length, gamesWithResults },
          "Completed auto-search"
        );

        // Update last search time
        await storage.updateUserSettings(userId, { lastAutoSearch: new Date() });
      } catch (error) {
        igdbLogger.error({ userId, error }, "Error processing auto-search for user");
      }
    }
  } catch (error) {
    igdbLogger.error({ error }, "Error in checkAutoSearch");
  }
}

async function checkXrelReleases() {
  igdbLogger.debug("Checking xREL.to for wanted games...");

  try {
    const baseUrl =
      (await storage.getSystemConfig("xrel_api_base"))?.trim() ||
      process.env.XREL_API_BASE ||
      DEFAULT_XREL_BASE;

    // Fetch latest releases once to compare against all wanted games (better performance)
    const { list: latestReleases } = await xrelClient.getLatestReleases({
      perPage: 100,
      baseUrl,
    });

    if (latestReleases.length === 0) {
      igdbLogger.debug("No latest releases found on xREL.to, skipping check.");
      return;
    }

    // ⚡ Bolt: Pre-process releases once to avoid redundant normalization in the nested loop
    const processedReleases = latestReleases.map((rel) => {
      const extTitleNorm = rel.ext_info?.title ? normalizeTitle(rel.ext_info.title) : null;
      const dirCleaned = cleanReleaseName(rel.dirname);
      const dirNorm = normalizeTitle(dirCleaned);
      const extRegex =
        extTitleNorm && extTitleNorm.length >= 5
          ? new RegExp(`\\b${extTitleNorm.replace(/[.*+?^${}()|[\\]/g, "\\$&")}\\b`, "i")
          : null;
      return {
        rel,
        extTitleNorm,
        dirNorm,
        dirLower: rel.dirname.toLowerCase().replace(/[._-]/g, " "),
        extRegex,
      };
    });

    const allGames = await storage.getAllGames();
    const wantedGames = allGames.filter((g) => g.userId && g.status === "wanted" && !g.hidden);

    if (wantedGames.length === 0) {
      return;
    }

    // Cache user settings to avoid redundant DB hits
    const userSettingsCache = new Map();

    for (const game of wantedGames) {
      try {
        const userId = game.userId!;
        if (!userSettingsCache.has(userId)) {
          const settings = await storage.getUserSettings(userId);
          userSettingsCache.set(userId, settings);
        }
        const settings = userSettingsCache.get(userId);
        const scene = settings?.xrelSceneReleases !== false;
        const p2p = settings?.xrelP2pReleases === true;

        const gameNorm = normalizeTitle(game.title);
        const gameRegex =
          gameNorm.length >= 5
            ? new RegExp(`\\b${gameNorm.replace(/[.*+?^${}()|[\\]/g, "\\$&")}\\b`, "i")
            : null;
        const gameWords = gameNorm.split(" ").filter((w: string) => w.length > 2);

        // Filter releases for this game based on user preferences and title match
        const matchingReleases = processedReleases
          .filter((pr) => {
            if (pr.rel.source === "scene" && !scene) return false;
            if (pr.rel.source === "p2p" && !p2p) return false;

            // 1. Exact match
            if (pr.extTitleNorm === gameNorm || pr.dirNorm === gameNorm) return true;

            // 2. Fuzzy match
            if (gameRegex) {
              if (pr.extTitleNorm && gameRegex.test(pr.extTitleNorm)) return true;
              if (gameRegex.test(pr.dirNorm)) return true;
            }
            if (pr.extRegex && pr.extRegex.test(gameNorm)) return true;

            // 3. Word-based fallback
            if (
              gameWords.length > 0 &&
              gameWords.every((word: string) => pr.dirLower.includes(word))
            )
              return true;

            return false;
          })
          .map((pr) => pr.rel);

        for (const rel of matchingReleases) {
          const already = await storage.hasXrelNotifiedRelease(game.id, rel.id);
          if (already) continue;

          await storage.addXrelNotifiedRelease({
            gameId: game.id,
            xrelReleaseId: rel.id,
          });

          const message = `${game.title} is listed on xREL.to: ${rel.dirname}`;
          const notification = await storage.addNotification({
            userId,
            type: "info",
            title: "Available on xREL.to",
            message,
          });
          notifyUser("notification", notification);
          igdbLogger.info(
            { gameTitle: game.title, dirname: rel.dirname },
            "xREL notification sent"
          );
        }
      } catch (error) {
        igdbLogger.warn({ gameTitle: game.title, error }, "xREL match failed for game");
      }
    }
  } catch (error) {
    igdbLogger.error({ error }, "Error in checkXrelReleases");
  }
}
