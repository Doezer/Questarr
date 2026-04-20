import { storage } from "./storage.js";
import { igdbClient, IGDB_EARLY_ACCESS_STATUS } from "./igdb.js";
import { igdbLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { DownloaderManager } from "./downloaders.js";
import { importManager } from "./services/index.js";
import { searchAllIndexers, filterBlacklistedReleases } from "./search.js";
import { xrelClient, DEFAULT_XREL_BASE } from "./xrel.js";
import { steamService } from "./steam.js";
import { downloadRulesSchema, type Game, type InsertNotification } from "../shared/schema.js";
import { categorizeDownload } from "../shared/download-categorizer.js";
import {
  releaseMatchesGame,
  normalizeTitle,
  cleanReleaseName,
  parseJsonStringArray,
  parseReleaseMetadata,
  matchesPlatformFilter,
} from "../shared/title-utils.js";

const DELAY_THRESHOLD_DAYS = 7;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Track consecutive "not found" counts per download to avoid prematurely marking
// downloads as owned during the brief SABnzbd queue→history transition window.
const downloadMissCount = new Map<string, number>();
const DOWNLOAD_MISS_THRESHOLD = 3;
const AUTO_SEARCH_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const XREL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours (xREL search rate limit: 2/5s)
const OWNED_STATUSES = new Set(["owned", "completed", "downloading"]);

type DownloadSortBy = "seeders" | "date" | "size";

interface AutoSearchRules {
  minSeeders: number;
  sortBy: DownloadSortBy;
  visibleCategoriesSet: Set<string>;
}

interface AutoSearchCategorizedItems {
  mainItems: Awaited<ReturnType<typeof searchAllIndexers>>["items"];
  updateItems: Awaited<ReturnType<typeof searchAllIndexers>>["items"];
}

function getAutoSearchRules(downloadRules: string | null): AutoSearchRules {
  let minSeeders = 0;
  let sortBy: DownloadSortBy = "seeders";
  let visibleCategoriesSet = new Set(["main", "update", "dlc", "extra"]);

  if (downloadRules) {
    const parsed = JSON.parse(downloadRules);
    const rules = downloadRulesSchema.parse(parsed);
    minSeeders = rules.minSeeders;
    sortBy = rules.sortBy;
    visibleCategoriesSet = new Set(rules.visibleCategories);
  }

  return { minSeeders, sortBy, visibleCategoriesSet };
}

function categorizeSearchItems(
  items: Awaited<ReturnType<typeof searchAllIndexers>>["items"],
  rules: AutoSearchRules
): AutoSearchCategorizedItems {
  const sortedItems = items
    .filter((item) => {
      const seeders = item.seeders ?? 0;
      return seeders >= rules.minSeeders;
    })
    .sort((a, b) => {
      if (rules.sortBy === "seeders") {
        return (b.seeders ?? 0) - (a.seeders ?? 0);
      }
      if (rules.sortBy === "date") {
        return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
      }
      return (b.size ?? 0) - (a.size ?? 0);
    });

  return sortedItems.reduce<AutoSearchCategorizedItems>(
    (acc, item) => {
      const { category } = categorizeDownload(item.title);

      if (!rules.visibleCategoriesSet.has(category)) {
        return acc;
      }

      if (category === "main") {
        acc.mainItems.push(item);
      } else if (category === "update") {
        acc.updateItems.push(item);
      }

      return acc;
    },
    { mainItems: [], updateItems: [] }
  );
}

function applyPreferredGroupsFilter(
  items: Awaited<ReturnType<typeof searchAllIndexers>>["items"],
  preferredGroups: string[]
): Awaited<ReturnType<typeof searchAllIndexers>>["items"] {
  if (preferredGroups.length === 0) return items;
  const filtered = items.filter(
    (item) =>
      item.group && preferredGroups.some((g) => g.toLowerCase() === item.group!.toLowerCase())
  );
  return filtered.length > 0 ? filtered : items;
}

/**
 * Applies a strict preferred platform filter to search items.
 * PC is special: matches releases with no detected platform as well as explicit PC detections.
 * Returns the input unchanged when no preferred platform is configured.
 */
function applyPreferredPlatformFilter(
  items: Awaited<ReturnType<typeof searchAllIndexers>>["items"],
  preferredPlatform: string | null | undefined
): Awaited<ReturnType<typeof searchAllIndexers>>["items"] {
  if (!preferredPlatform) return items;
  return items.filter((item) => {
    const { platform } = parseReleaseMetadata(item.title);
    return matchesPlatformFilter(platform, preferredPlatform);
  });
}

async function searchAndCategorizeItemsForGame(
  game: Pick<Game, "id" | "title">,
  downloadRules: string | null
): Promise<AutoSearchCategorizedItems | null> {
  const { items, errors } = await searchAllIndexers({
    query: game.title,
    limit: 10,
  });

  if (errors.length > 0) {
    const networkKeywords = [
      "fetch failed",
      "Unsafe URL detected",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "network timeout",
    ];

    const areAllErrorsNetworkRelated = errors.every((err) =>
      networkKeywords.some((keyword) => err.includes(keyword))
    );

    if (areAllErrorsNetworkRelated) {
      igdbLogger.warn(
        { gameTitle: game.title, errorCount: errors.length },
        "Search failed due to network connectivity issues (DNS/Fetch/Safety check). Please check your internet connection."
      );
    } else {
      igdbLogger.warn({ gameTitle: game.title, errors }, "Errors during search");
    }
  }

  if (items.length === 0) {
    return null;
  }

  const matchedItems = items.filter((item) => releaseMatchesGame(item.title, game.title));
  if (matchedItems.length === 0) {
    igdbLogger.debug(
      { gameTitle: game.title, originalCount: items.length },
      "No items passed strict title matching"
    );
    return null;
  }

  // Filter out blacklisted releases
  const blacklisted = await storage.getReleaseBlacklistSet(game.id);
  const nonBlacklisted = filterBlacklistedReleases(matchedItems, blacklisted);

  if (nonBlacklisted.length === 0) {
    igdbLogger.debug(
      { gameTitle: game.title, matchedCount: matchedItems.length },
      "All matched items were blacklisted"
    );
    return null;
  }

  let rules: AutoSearchRules;
  try {
    rules = getAutoSearchRules(downloadRules);
  } catch (error) {
    igdbLogger.warn({ gameTitle: game.title, error }, "Failed to parse download rules");
    rules = getAutoSearchRules(null);
  }

  return categorizeSearchItems(nonBlacklisted, rules);
}

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

export async function checkGameUpdates() {
  igdbLogger.info("Checking for game updates...");

  const allGames = await storage.getAllGames();

  // Filter games that are tracked (have IGDB ID) and not hidden
  const gamesToCheck = allGames.filter((g) => g.igdbId !== null && !g.hidden);

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

  const updatesMap = new Map<string, Partial<Game>>();
  const notificationsToSend: InsertNotification[] = [];

  for (const game of gamesToCheck) {
    const igdbGame = igdbGameMap.get(game.igdbId!);

    if (!igdbGame) continue;

    // Helper to queue update
    const queueUpdate = (updates: Partial<Game>) => {
      const existing = updatesMap.get(game.id) || {};
      updatesMap.set(game.id, { ...existing, ...updates });
    };

    // Update early access flag regardless of whether a release date is known
    const newEarlyAccess = igdbGame.status === IGDB_EARLY_ACCESS_STATUS;
    if (game.earlyAccess !== newEarlyAccess) {
      queueUpdate({ earlyAccess: newEarlyAccess });
    }

    if (!igdbGame.first_release_date) continue;

    const currentReleaseDate = new Date(igdbGame.first_release_date * 1000);
    const currentReleaseDateStr = currentReleaseDate.toISOString().split("T")[0];

    // Initialize originalReleaseDate if not set
    if (!game.originalReleaseDate) {
      if (game.releaseDate) {
        queueUpdate({ originalReleaseDate: game.releaseDate });
        game.originalReleaseDate = game.releaseDate;
      } else {
        queueUpdate({
          releaseDate: currentReleaseDateStr,
          originalReleaseDate: currentReleaseDateStr,
        });
        // We need to update local object if we were to continue using it,
        // but the original code did 'continue'.
        // However, 'continue' skips the rest of the loop logic (status check).
        // If we just initialized, do we want to skip status check?
        // Original code: yes.
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
      notificationsToSend.push({
        type: "success",
        title: "Game Released",
        message,
        link: "/library",
      });
    }

    // If release date or status changed, update DB
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

      queueUpdate({
        releaseDate: currentReleaseDateStr,
        releaseStatus: newReleaseStatus,
      });

      // Send notification if game is delayed
      if (newReleaseStatus === "delayed" && game.releaseStatus !== "delayed") {
        const message = `${game.title} has been delayed to ${currentReleaseDateStr}`;
        notificationsToSend.push({
          type: "delayed",
          title: "Game Delayed",
          message,
          link: "/wishlist",
        });
      }
    }
  }

  // Apply batch updates
  if (updatesMap.size > 0) {
    const batchUpdates = Array.from(updatesMap.entries()).map(([id, data]) => ({ id, data }));
    await storage.updateGamesBatch(batchUpdates);
  }

  // Send notifications in batch
  if (notificationsToSend.length > 0) {
    try {
      const addedNotifications = await storage.addNotificationsBatch(notificationsToSend);
      for (const notification of addedNotifications) {
        notifyUser("notification", notification);
      }
    } catch (error) {
      igdbLogger.error({ error }, "Failed to add notifications in batch");
    }
  }

  igdbLogger.info(
    { updatedCount: updatesMap.size, checkedCount: gamesToCheck.length },
    "Finished checking for game updates."
  );
}

export async function checkDownloadStatus() {
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
    try {
      const downloader = await storage.getDownloader(downloaderId);
      if (!downloader || !downloader.enabled) continue;

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
        let remoteDownload = activeDownloadMap.get(download.downloadHash.toLowerCase());

        // For Usenet clients (SABnzbd, NZBGet), getAllDownloads() only returns
        // queue items. Once a download finishes it moves to history and disappears
        // from the queue. Fall back to a direct per-item check so history items
        // are found before declaring the download missing.
        if (!remoteDownload) {
          const individualStatus = await DownloaderManager.getDownloadStatus(
            downloader,
            download.downloadHash
          );
          if (individualStatus) {
            remoteDownload = individualStatus;
          }
        }

        if (remoteDownload) {
          // Clear any previous miss count — download is alive.
          downloadMissCount.delete(download.id);

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

            // Notify frontend to refresh downloads for this game.
            // TODO: scope this to a per-user socket room once multi-user socket auth is wired up.
            notifyUser("downloadUpdate", download.gameId);

            // Fetch game title for notification
            const game = await storage.getGame(download.gameId);
            const gameTitle = game ? game.title : download.downloadTitle;

            // Send notification
            const message = `Download finished for ${gameTitle}`;
            const notification = await storage.addNotification({
              type: "success",
              title: "Download Completed",
              message,
              link: "/library",
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
              // Notify frontend to refresh downloads for this game.
              // TODO: scope this to a per-user socket room once multi-user socket auth is wired up.
              notifyUser("downloadUpdate", download.gameId);
            }

            // Update game status
            // If we're about to reset to "wanted" (error case), check whether any
            // sibling download for the same game is still actively downloading.
            // If so, leave the game status as-is to avoid a false regression.
            let skipGameStatusUpdate = false;
            if (newGameStatus === "wanted") {
              const siblings = await storage.getDownloadsByGameId(download.gameId);
              const hasActiveDownload = siblings.some(
                (s) => s.id !== download.id && s.status === "downloading"
              );
              if (hasActiveDownload) {
                skipGameStatusUpdate = true;
              }
            }

            const game = await storage.getGame(download.gameId);
            if (!skipGameStatusUpdate && game && game.status !== newGameStatus) {
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
          // 5. SABnzbd/usenet: brief transition window between queue and history
          // Currently, we assume completion, but this may not always be correct.
          // TODO: Consider adding a user preference to handle this scenario differently
          // (e.g., reset to "wanted" status, or require manual confirmation)

          // Guard against false "not found" during brief queue→history transitions
          // (common with SABnzbd post-processing). Only act after several consecutive misses.
          const misses = (downloadMissCount.get(download.id) ?? 0) + 1;
          downloadMissCount.set(download.id, misses);

          igdbLogger.debug(
            {
              downloadId: download.id,
              downloadHash: download.downloadHash,
              misses,
              threshold: DOWNLOAD_MISS_THRESHOLD,
            },
            "SABnzbd: download miss count"
          );

          if (misses < DOWNLOAD_MISS_THRESHOLD) {
            igdbLogger.warn(
              {
                gameId: download.gameId,
                downloadId: download.id,
                downloadTitle: download.downloadTitle,
                downloadHash: download.downloadHash,
                misses,
                threshold: DOWNLOAD_MISS_THRESHOLD,
              },
              "Download not found in downloader - will retry before marking as completed"
            );
            continue;
          }

          // Threshold reached — proceed with assumption of completion.
          downloadMissCount.delete(download.id);

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
            link: "/library",
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

export async function checkAutoSearch() {
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
        const OWNED_STATUSES_ARRAY = Array.from(OWNED_STATUSES);
        const ownedGames = await storage.getUserGames(userId, false, OWNED_STATUSES_ARRAY);

        if (wantedGames.length === 0 && ownedGames.length === 0) {
          igdbLogger.debug({ userId }, "No wanted or owned games found");
          // Update last search time even if no games found, to avoid checking again too soon
          await storage.updateUserSettings(userId, { lastAutoSearch: new Date() });
          continue;
        }

        igdbLogger.info(
          { userId, gameCount: wantedGames.length },
          "Starting auto-search for wanted games"
        );

        let gamesWithResults = 0;

        const preferredGroups = parseJsonStringArray(settings.preferredReleaseGroups);
        const preferredPlatform = settings.preferredPlatform ?? null;

        for (const game of wantedGames) {
          try {
            // Skip unreleased games if configured to do so
            if (!settings.autoSearchUnreleased && game.releaseStatus !== "released") {
              igdbLogger.debug(
                { gameTitle: game.title, status: game.releaseStatus },
                "Skipping auto-search for unreleased game"
              );
              continue;
            }

            const searchResult = await searchAndCategorizeItemsForGame(
              game,
              settings.downloadRules
            );
            if (!searchResult) {
              // No results at all (zero results or all blacklisted) — clear the badge
              await storage.updateGameSearchResultsAvailable(game.id, false);
              continue;
            }

            // Apply platform filter first (strict), then preferred groups (soft preference)
            const platformFilteredMain = applyPreferredPlatformFilter(
              searchResult.mainItems,
              preferredPlatform
            );
            const mainItems = applyPreferredGroupsFilter(platformFilteredMain, preferredGroups);

            // Handle main items
            if (mainItems.length === 0) {
              // Results found by indexers but none survive user's filters — clear the flag
              await storage.updateGameSearchResultsAvailable(game.id, false);
              continue;
            }

            gamesWithResults++;
            // Always mark as available when filtered results exist
            await storage.updateGameSearchResultsAvailable(game.id, true);

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
                      const groupSuffix = item.group ? ` [${item.group}]` : "";
                      const notification = await storage.addNotification({
                        userId,
                        type: "success",
                        title: "Download Started",
                        message: `Started downloading ${game.title}${groupSuffix} via ${item.downloadType === "usenet" ? "Usenet" : "Torrent"}`,
                        link: "/library",
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
                  link: `modal:game:${game.id}`,
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
                link: `modal:game:${game.id}`,
              });
              notifyUser("notification", notification);
            }
          } catch (error) {
            igdbLogger.error({ gameTitle: game.title, error }, "Error searching for game");
          }
        }

        // Search owned games for update packs only.
        for (const game of ownedGames) {
          try {
            // Skip unreleased games if configured to do so
            if (!settings.autoSearchUnreleased && game.releaseStatus !== "released") {
              continue;
            }

            const searchResult = await searchAndCategorizeItemsForGame(
              game,
              settings.downloadRules
            );
            if (!searchResult) {
              await storage.updateGameSearchResultsAvailable(game.id, false);
              continue;
            }

            const platformFilteredUpdate = applyPreferredPlatformFilter(
              searchResult.updateItems,
              preferredPlatform
            );
            const updateItems = applyPreferredGroupsFilter(platformFilteredUpdate, preferredGroups);

            await storage.updateGameSearchResultsAvailable(game.id, updateItems.length > 0);

            if (updateItems.length > 0 && settings.notifyUpdates) {
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Game Updates Available",
                message: `${updateItems.length} update(s) found for ${game.title}`,
                link: `modal:game:${game.id}`,
              });
              notifyUser("notification", notification);
            }
          } catch (error) {
            igdbLogger.error(
              { gameTitle: game.title, error },
              "Error searching for owned game updates"
            );
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

export async function checkXrelReleases() {
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
          ? new RegExp(`\\b${extTitleNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
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
    const wantedGames = allGames
      .filter((g) => g.userId && g.status === "wanted" && !g.hidden)
      .map((g) => ({
        game: g,
        normalized: normalizeTitle(g.title),
      }));

    if (wantedGames.length === 0) {
      return;
    }

    // Cache user settings to avoid redundant DB hits
    const userSettingsCache = new Map();

    for (const { game, normalized } of wantedGames) {
      try {
        const userId = game.userId!;
        if (!userSettingsCache.has(userId)) {
          const settings = await storage.getUserSettings(userId);
          userSettingsCache.set(userId, settings);
        }
        const settings = userSettingsCache.get(userId);
        const scene = settings?.xrelSceneReleases !== false;
        const p2p = settings?.xrelP2pReleases === true;

        // Filter releases for this game based on user preferences and title match
        const matchingReleases = processedReleases.filter((pr) => {
          if (pr.rel.source === "scene" && !scene) return false;
          if (pr.rel.source === "p2p" && !p2p) return false;

          // 1. Pre-processed normalized match
          if (pr.extTitleNorm === normalized || pr.dirNorm === normalized) return true;

          // 2. Fallback to shared matching logic for fuzzy/word-based (still benefits from less cleaning)
          if (releaseMatchesGame(pr.rel.dirname, game.title)) return true;
          if (pr.rel.ext_info?.title && releaseMatchesGame(pr.rel.ext_info.title, game.title))
            return true;

          return false;
        });

        for (const { rel } of matchingReleases) {
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
            link: `modal:game:${game.id}`,
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

export async function checkSteamWishlist() {
  igdbLogger.info("Starting Steam Wishlist check for all users...");
  const users = await storage.getAllUsers();
  for (const user of users) {
    if (user.steamId64) {
      await syncUserSteamWishlist(user.id);
    }
  }
}

const MAX_STEAM_SYNC_FAILURES = 3;

interface SteamSyncGameSet {
  currentGames: Game[];
  ownedIgdbIds: Set<number>;
  ownedSteamAppIds: Set<number>;
}

/** Link existing games that match by IGDB ID but are missing their Steam App ID. */
async function linkExistingGamesToSteam(
  pendingSteamAppIds: number[],
  steamToIgdbMap: Map<number, number>,
  { currentGames, ownedIgdbIds }: SteamSyncGameSet
): Promise<Set<number>> {
  const newIgdbIdsToFetch = new Set<number>();
  const currentGamesByIgdbId = new Map(
    currentGames.filter((g) => g.igdbId != null).map((g) => [g.igdbId as number, g])
  );

  for (const steamAppId of pendingSteamAppIds) {
    const igdbId = steamToIgdbMap.get(steamAppId);
    if (igdbId == null) {
      igdbLogger.debug({ steamAppId }, "No IGDB ID found for Steam App ID");
      continue;
    }

    if (ownedIgdbIds.has(igdbId)) {
      const existing = currentGamesByIgdbId.get(igdbId);
      if (existing && !existing.steamAppId) {
        await storage.updateGame(existing.id, { steamAppId });
      }
    } else {
      newIgdbIdsToFetch.add(igdbId);
    }
  }

  return newIgdbIdsToFetch;
}

/** Fetch details from IGDB and add new games to the user's library. */
async function addNewSteamWishlistGames(
  userId: string,
  pendingSteamAppIds: number[],
  steamToIgdbMap: Map<number, number>,
  newIgdbIds: Set<number>,
  ownedIgdbIds: Set<number>
) {
  const addedGames: { title: string; igdbId: number; steamAppId: number }[] = [];

  const gameDetailsList = await igdbClient.getGamesByIds(Array.from(newIgdbIds));
  const gameDetailsMap = new Map(gameDetailsList.map((g) => [g.id, g]));

  for (const steamAppId of pendingSteamAppIds) {
    const igdbId = steamToIgdbMap.get(steamAppId);
    if (igdbId == null || ownedIgdbIds.has(igdbId)) continue;

    const gameDetails = gameDetailsMap.get(igdbId);
    if (!gameDetails) continue;

    const formatted = igdbClient.formatGameData(gameDetails);
    await storage.addGame({
      userId,
      title: formatted.title as string,
      igdbId: formatted.igdbId as number,
      steamAppId: steamAppId,
      status: "wanted",
      coverUrl: formatted.coverUrl as string,
      summary: formatted.summary as string,
      releaseDate: formatted.releaseDate as string,
      rating: formatted.rating as number | null,
      platforms: formatted.platforms as string[],
      genres: formatted.genres as string[],
      developers: formatted.developers as string[],
      publishers: formatted.publishers as string[],
      screenshots: formatted.screenshots as string[],
      source: "steam",
      hidden: false,
    });
    addedGames.push({
      title: formatted.title as string,
      igdbId: formatted.igdbId as number,
      steamAppId,
    });
  }

  return addedGames;
}

export async function syncUserSteamWishlist(userId: string) {
  let steamSyncFailures = 0;

  try {
    const user = await storage.getUser(userId);
    if (!user || !user.steamId64) return;

    const settings = await storage.getUserSettings(userId);
    steamSyncFailures = settings?.steamSyncFailures ?? 0;

    if (steamSyncFailures >= MAX_STEAM_SYNC_FAILURES) {
      const message =
        "Steam wishlist sync is temporarily disabled after repeated failures. " +
        "Please verify Steam profile visibility and try again later.";
      igdbLogger.warn({ userId, steamSyncFailures }, message);
      return { success: false, message };
    }

    igdbLogger.info({ userId, steamId: user.steamId64 }, "Syncing Steam Wishlist");

    const wishlistGames = await steamService.getWishlist(user.steamId64);

    if (steamSyncFailures > 0) {
      await storage.updateUserSettings(userId, { steamSyncFailures: 0 });
    }

    const currentGames = await storage.getUserGames(userId, true);
    const gameSet: SteamSyncGameSet = {
      currentGames,
      ownedIgdbIds: new Set(
        currentGames.filter((g) => g.igdbId != null).map((g) => g.igdbId as number)
      ),
      ownedSteamAppIds: new Set(
        currentGames.filter((g) => g.steamAppId != null).map((g) => g.steamAppId as number)
      ),
    };

    const pendingSteamAppIds = wishlistGames
      .filter((sg) => !gameSet.ownedSteamAppIds.has(sg.steamAppId))
      .map((sg) => sg.steamAppId);

    let addedGames: { title: string; igdbId: number; steamAppId: number }[] = [];

    if (pendingSteamAppIds.length > 0) {
      const steamToIgdbMap = await igdbClient.getGameIdsBySteamAppIds(pendingSteamAppIds);
      const newIgdbIds = await linkExistingGamesToSteam(
        pendingSteamAppIds,
        steamToIgdbMap,
        gameSet
      );

      if (newIgdbIds.size > 0) {
        addedGames = await addNewSteamWishlistGames(
          userId,
          pendingSteamAppIds,
          steamToIgdbMap,
          newIgdbIds,
          gameSet.ownedIgdbIds
        );
      }
    }

    if (addedGames.length > 0) {
      const notification = await storage.addNotification({
        userId,
        type: "success",
        title: "Steam Wishlist Synced",
        message: `Successfully added ${addedGames.length} games from your Steam Wishlist.`,
      });
      notifyUser("notification", notification);
    }

    return { success: true, addedCount: addedGames.length, games: addedGames };
  } catch (error) {
    const nextSteamSyncFailures = steamSyncFailures + 1;
    await storage.updateUserSettings(userId, { steamSyncFailures: nextSteamSyncFailures });
    igdbLogger.error({ userId, error }, "Steam Sync Failed");
    const errMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, message: errMessage };
  }
}
