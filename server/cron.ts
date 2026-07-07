import { storage } from "./storage.js";
import { igdbClient, IGDB_EARLY_ACCESS_STATUS } from "./igdb.js";
import { igdbLogger } from "./logger.js";
import { notifyUser } from "./socket.js";
import { DownloaderManager } from "./downloaders.js";
import { torznabClient } from "./torznab.js";
import { newznabClient } from "./newznab.js";
import { searchAllIndexers, filterBlacklistedReleases, type SearchItem } from "./search.js";
import { xrelClient, DEFAULT_XREL_BASE } from "./xrel.js";
import { steamService } from "./steam.js";
import { appriseClient } from "./apprise.js";
import { importManager } from "./services/index.js";
import {
  downloadRulesSchema,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type Game,
  type InsertNotification,
  type NotificationEvent,
  type NotificationPreferences,
} from "../shared/schema.js";
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
const CLIENT_VERSION_LOG_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const OWNED_STATUSES = new Set(["owned", "completed", "downloading"]);

const GAME_UPDATE_TITLE_TO_EVENT: Record<string, NotificationEvent> = {
  "Game Released": "gameReleased",
  "Game Delayed": "gameDelayed",
};

function resolvePrefs(
  settings: { notificationPreferences?: string | null } | null | undefined
): NotificationPreferences {
  if (!settings?.notificationPreferences) return DEFAULT_NOTIFICATION_PREFERENCES;
  try {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(settings.notificationPreferences) };
  } catch {
    igdbLogger.warn(
      { value: settings.notificationPreferences },
      "Failed to parse notification preferences, using defaults"
    );
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

function buildRemoteImportPath(downloadDir: string, name: string): string {
  const normalizedDir = downloadDir.replace(/[\\/]+$/, "");
  const normalizedName = name.replace(/^[\\/]+/, "");
  const lastSegment = normalizedDir.split(/[\\/]/).pop()?.toLowerCase();
  if (lastSegment && lastSegment === normalizedName.toLowerCase()) {
    return normalizedDir;
  }
  return `${normalizedDir}/${normalizedName}`;
}

type DownloadSortBy = "seeders" | "date" | "size";

interface AutoSearchRules {
  minSeeders: number;
  sortBy: DownloadSortBy;
  visibleCategoriesSet: Set<string>;
}

interface AutoSearchCategorizedItems {
  mainItems: SearchItem[];
  updateItems: SearchItem[];
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
  items: SearchItem[],
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
  items: SearchItem[],
  preferredGroups: string[],
  strict: boolean
): SearchItem[] {
  if (preferredGroups.length === 0) return items;
  const filtered = items.filter(
    (item) =>
      item.group && preferredGroups.some((g) => g.toLowerCase() === item.group!.toLowerCase())
  );
  if (filtered.length > 0) return filtered;
  // When strict filtering is enabled, return nothing rather than falling back to all items.
  // This respects the user's intent to only accept releases from preferred groups.
  return strict ? [] : items;
}

/**
 * De-duplicates search items that represent the same release (identical normalized title).
 * When duplicates exist (e.g. the same torrent listed by multiple indexers), the item
 * from the highest-priority indexer (lowest priority number) is kept.
 */
function deduplicateByTitle(
  items: SearchItem[],
  indexerPriorityMap: Map<string, number>
): SearchItem[] {
  const seen = new Map<string, SearchItem>();
  for (const item of items) {
    const key = `${normalizeTitle(item.title)}:${item.downloadType}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else {
      // Keep the item from the higher-priority indexer (lower number = higher priority)
      const itemPriority = indexerPriorityMap.get(item.indexerId) ?? Infinity;
      const existingPriority = indexerPriorityMap.get(existing.indexerId) ?? Infinity;
      if (itemPriority < existingPriority) {
        seen.set(key, item);
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Applies a strict preferred platform filter to search items.
 * PC is special: matches releases with no detected platform as well as explicit PC detections.
 * Returns the input unchanged when no preferred platform is configured.
 */
function applyPreferredPlatformFilter(
  items: SearchItem[],
  preferredPlatform: string | null | undefined
): SearchItem[] {
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
    logClientVersions().catch((err) => igdbLogger.warn({ err }, "Error in logClientVersions"));
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

  setInterval(() => {
    logClientVersions().catch((err) => igdbLogger.warn({ err }, "Error in logClientVersions"));
  }, CLIENT_VERSION_LOG_INTERVAL_MS);

  const IMPORT_TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const runImportTaskCleanup = () => {
    const cutoff = Date.now() - IMPORT_TASK_RETENTION_MS;
    storage
      .deleteImportTasksOlderThan(cutoff)
      .catch((err) => igdbLogger.warn({ err }, "Import task cleanup failed"));
  };
  setInterval(runImportTaskCleanup, 24 * 60 * 60 * 1000);
}

async function logClientVersions(): Promise<void> {
  const [downloaders, indexers] = await Promise.all([
    storage.getEnabledDownloaders(),
    storage.getEnabledIndexers(),
  ]);

  if (downloaders.length === 0 && indexers.length === 0) {
    return;
  }

  igdbLogger.debug(
    { downloaderCount: downloaders.length, indexerCount: indexers.length },
    "Running periodic client version probes"
  );

  await Promise.allSettled([
    ...downloaders.map((downloader) => DownloaderManager.logVersionInfo(downloader)),
    ...indexers.map((indexer) =>
      indexer.protocol === "newznab"
        ? newznabClient.logVersionInfo(indexer)
        : torznabClient.logVersionInfo(indexer)
    ),
  ]);
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
  const gameUpdatePrefsCache = new Map<string, NotificationPreferences>();
  const getGameUpdatePrefs = async (userId: string): Promise<NotificationPreferences> => {
    if (!gameUpdatePrefsCache.has(userId)) {
      const s = await storage.getUserSettings(userId);
      gameUpdatePrefsCache.set(userId, resolvePrefs(s));
    }
    return gameUpdatePrefsCache.get(userId)!;
  };

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
      const prefs = await getGameUpdatePrefs(game.userId!);
      if (prefs.gameReleased.inApp) {
        notificationsToSend.push({
          type: "success",
          title: "Game Released" satisfies keyof typeof GAME_UPDATE_TITLE_TO_EVENT,
          message,
          link: "/",
          userId: game.userId!,
        });
      }
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
        const prefs = await getGameUpdatePrefs(game.userId!);
        if (prefs.gameDelayed.inApp) {
          notificationsToSend.push({
            type: "delayed",
            title: "Game Delayed" satisfies keyof typeof GAME_UPDATE_TITLE_TO_EVENT,
            message,
            link: "/wishlist",
            userId: game.userId!,
          });
        }
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
        const prefs =
          gameUpdatePrefsCache.get(notification.userId ?? "") ?? DEFAULT_NOTIFICATION_PREFERENCES;
        const eventKey = GAME_UPDATE_TITLE_TO_EVENT[notification.title];
        if (eventKey && prefs[eventKey].apprise) appriseClient.send(notification);
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

  // Prune stale entries from downloadMissCount (e.g. downloads removed from DB while still downloading)
  const activeDownloadIds = new Set(downloadingDownloads.map((d) => d.id));
  downloadMissCount.forEach((_, key) => {
    if (!activeDownloadIds.has(key)) {
      downloadMissCount.delete(key);
    }
  });

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

          // Check for completion — exclude post-processing statuses so usenet
          // downloads in "moving"/"unpacking" phase don't trigger import early.
          const isComplete =
            remoteDownload.status === "completed" ||
            remoteDownload.status === "seeding" ||
            (remoteDownload.progress >= 100 &&
              remoteDownload.status !== "unpacking" &&
              remoteDownload.status !== "repairing");

          if (isComplete) {
            igdbLogger.info(
              {
                item: download.downloadTitle,
                status: remoteDownload.status,
                progress: remoteDownload.progress,
              },
              "Download completed"
            );

            // Fetch game title for notification
            const game = await storage.getGame(download.gameId);
            const gameTitle = game ? game.title : download.downloadTitle;
            const importConfig = await storage.getImportConfig(game?.userId ?? undefined);

            let shouldSendCompletionNotification = true;

            if (importConfig.enablePostProcessing) {
              const details = await DownloaderManager.getDownloadDetails(
                downloader,
                download.downloadHash
              );
              if (details?.downloadDir) {
                const remoteImportPath = buildRemoteImportPath(details.downloadDir, details.name);
                try {
                  await importManager.processImport(download.id, remoteImportPath);
                } catch (error) {
                  igdbLogger.error(
                    { error, downloadId: download.id, remoteImportPath },
                    "Failed to start import pipeline after download completion"
                  );
                }
              } else {
                shouldSendCompletionNotification = false;
                await storage.updateGameDownloadStatus(download.id, "manual_review_required");
                igdbLogger.warn(
                  { downloadId: download.id, downloadHash: download.downloadHash, downloaderId },
                  "Download completed but no remote path was available for import"
                );
              }
            } else {
              // Update DB - mark as completed
              await storage.updateGameDownloadStatus(download.id, "completed");

              // Update Game status to 'owned' (which means we have the files)
              await storage.updateGameStatus(download.gameId, { status: "owned" });

              igdbLogger.info(
                { gameId: download.gameId, downloadId: download.id },
                "Updated game status to 'owned' after completion"
              );
            }

            // Notify frontend to refresh downloads for this game.
            // TODO: scope this to a per-user socket room once multi-user socket auth is wired up.
            notifyUser("downloadUpdate", download.gameId);

            // Send notification
            const message = `Download finished for ${gameTitle}`;
            const dlSettings = await storage.getUserSettings(game?.userId ?? "");
            const dlPrefs = resolvePrefs(dlSettings);
            if (shouldSendCompletionNotification && dlPrefs.downloadCompleted.inApp) {
              const notification = await storage.addNotification({
                type: "success",
                title: "Download Completed",
                message,
                link: "/",
                userId: game?.userId ?? undefined,
              });
              notifyUser("notification", notification);
              if (dlPrefs.downloadCompleted.apprise) appriseClient.send(notification);
            }
          } else {
            // Sync download status with actual status from downloader
            let newDownloadStatus: "downloading" | "paused" | "failed" | "completed" =
              "downloading";
            let newGameStatus: "wanted" | "downloading" | "owned" = "downloading";
            let newErrorMessage: string | null = null;
            let isDefinitiveError = false;

            if (remoteDownload.status === "error") {
              newDownloadStatus = "failed";
              newGameStatus = "wanted"; // Reset to wanted on error
              newErrorMessage =
                remoteDownload.error?.trim() || "Aborted by downloader (no details provided)";
              isDefinitiveError = true;
              igdbLogger.warn(
                { title: download.downloadTitle, error: newErrorMessage },
                "Download error detected"
              );
            } else if (remoteDownload.status === "paused") {
              newDownloadStatus = "paused";
              newGameStatus = "downloading"; // Still consider it downloading (user can resume)
            } else if (remoteDownload.status === "downloading") {
              newDownloadStatus = "downloading";
              newGameStatus = "downloading";
            }

            const previousErrorMessage = download.errorMessage ?? null;
            const shouldUpdateStatus = download.status !== newDownloadStatus;
            const shouldUpdateErrorMessage = previousErrorMessage !== newErrorMessage;
            const shouldPersistDownloadUpdate = shouldUpdateStatus || shouldUpdateErrorMessage;

            // Only update if tracked status or error details changed.
            if (shouldPersistDownloadUpdate) {
              await storage.updateGameDownloadStatus(
                download.id,
                newDownloadStatus,
                newErrorMessage
              );
              igdbLogger.debug(
                {
                  title: download.downloadTitle,
                  oldStatus: download.status,
                  newStatus: newDownloadStatus,
                  oldErrorMessage: previousErrorMessage,
                  newErrorMessage,
                },
                "Updated download status"
              );
              // Notify frontend to refresh downloads for this game.
              // TODO: scope this to a per-user socket room once multi-user socket auth is wired up.
              notifyUser("downloadUpdate", download.gameId);
            }

            if (isDefinitiveError && shouldPersistDownloadUpdate) {
              const game = await storage.getGame(download.gameId);
              const gameTitle = game?.title ?? download.downloadTitle;
              const settings = await storage.getUserSettings(game?.userId ?? "");
              const prefs = resolvePrefs(settings);
              const message = `Download aborted for "${gameTitle}": ${newErrorMessage}`;

              if (prefs.downloadFailed.inApp) {
                const notification = await storage.addNotification({
                  type: "error",
                  title: "Download Aborted",
                  message,
                  link: `modal:game:${download.gameId}`,
                  userId: game?.userId ?? undefined,
                });
                notifyUser("notification", notification);
                if (prefs.downloadFailed.apprise) appriseClient.send(notification);
              }
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
          await storage.updateGameDownloadStatus(download.id, "completed", null);

          // Update game status to owned (assumption)
          await storage.updateGameStatus(download.gameId, { status: "owned" });

          // Send notification to user about this automatic status change
          const missedSettings = await storage.getUserSettings(game?.userId ?? "");
          const missedPrefs = resolvePrefs(missedSettings);
          if (missedPrefs.downloadCompleted.inApp) {
            const notification = await storage.addNotification({
              type: "info",
              title: "Download Status Changed",
              message: `Download for "${gameTitle}" was not found in the downloader and has been marked as completed. If this was removed due to an error, you may need to re-download it.`,
              link: "/",
              userId: game?.userId ?? undefined,
            });
            notifyUser("notification", notification);
            if (missedPrefs.downloadCompleted.apprise) appriseClient.send(notification);
          }

          igdbLogger.info(
            { gameId: download.gameId, gameTitle },
            "Automatically updated game status to 'owned' after download not found in downloader"
          );
        }
      }
    } catch (error) {
      igdbLogger.error({ error, downloaderId }, "Error checking downloader status");
      for (const dl of downloads) {
        downloadMissCount.delete(dl.id);
      }
    }
  }
}

export async function checkAutoSearch() {
  igdbLogger.debug("Checking auto-search for wanted games...");

  try {
    // Get wanted games grouped by user directly from storage (optimized)
    const gamesByUser = await storage.getWantedGamesGroupedByUser();

    // Build an indexer-priority map once for the whole run so duplicate releases from
    // multiple indexers can be de-duplicated using the user-configured indexer order.
    const enabledIndexers = await storage.getEnabledIndexers();
    const indexerPriorityMap = new Map(enabledIndexers.map((idx) => [idx.id, idx.priority]));

    for (const [userId, userGames] of Array.from(gamesByUser.entries())) {
      try {
        const settings = await storage.getUserSettings(userId);

        // Skip if auto-search is disabled
        if (!settings || !settings.autoSearchEnabled) {
          continue;
        }

        const prefs = resolvePrefs(settings);

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

            // Snapshot pre-cycle availability (fetched before any writes this cycle) to gate
            // notifications on the false→true transition instead of firing every cycle.
            const wasAvailable = game.searchResultsAvailable;

            // Apply platform filter first (strict), then preferred groups filter, then
            // de-duplicate releases that appear on multiple indexers (keep highest-priority indexer).
            const platformFilteredMain = applyPreferredPlatformFilter(
              searchResult.mainItems,
              preferredPlatform
            );
            const groupFilteredMain = applyPreferredGroupsFilter(
              platformFilteredMain,
              preferredGroups,
              settings.filterByPreferredGroups ?? false
            );
            const mainItems = deduplicateByTitle(groupFilteredMain, indexerPriorityMap);

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
                      if (prefs.autoDownload.inApp) {
                        const notification = await storage.addNotification({
                          userId,
                          type: "success",
                          title: "Download Started",
                          message: `Started downloading ${game.title}${groupSuffix} via ${item.downloadType === "usenet" ? "Usenet" : "Torrent"}`,
                          link: "/",
                        });
                        notifyUser("notification", notification);
                        if (prefs.autoDownload.apprise) appriseClient.send(notification);
                      }

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
                // Just notify about availability (only on the false→true transition)
                if (!wasAvailable && prefs.gameAvailable.inApp) {
                  const notification = await storage.addNotification({
                    userId,
                    type: "success",
                    title: "Game Available",
                    message: `${game.title} is now available for download`,
                    link: `modal:game:${game.id}`,
                  });
                  notifyUser("notification", notification);
                  if (prefs.gameAvailable.apprise) appriseClient.send(notification);
                }
              }
            } else if (mainItems.length > 1 && !wasAvailable && prefs.multipleResults.inApp) {
              // Multiple results found, notify user to choose
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Multiple Results Found",
                message: `${mainItems.length} result(s) found for ${game.title}. Please review and choose.`,
                link: `modal:game:${game.id}`,
              });
              notifyUser("notification", notification);
              if (prefs.multipleResults.apprise) appriseClient.send(notification);
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

            const wasUpdateAvailable = game.searchResultsAvailable;

            const platformFilteredUpdate = applyPreferredPlatformFilter(
              searchResult.updateItems,
              preferredPlatform
            );
            const groupFilteredUpdate = applyPreferredGroupsFilter(
              platformFilteredUpdate,
              preferredGroups,
              settings.filterByPreferredGroups ?? false
            );
            const updateItems = deduplicateByTitle(groupFilteredUpdate, indexerPriorityMap);

            await storage.updateGameSearchResultsAvailable(game.id, updateItems.length > 0);

            if (updateItems.length > 0 && !wasUpdateAvailable && prefs.gameUpdates.inApp) {
              const notification = await storage.addNotification({
                userId,
                type: "info",
                title: "Game Updates Available",
                message: `${updateItems.length} update(s) found for ${game.title}`,
                link: `modal:game:${game.id}`,
              });
              notifyUser("notification", notification);
              if (prefs.gameUpdates.apprise) appriseClient.send(notification);
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
          const xrelPrefs = resolvePrefs(userSettingsCache.get(userId));
          if (xrelPrefs.xrelRelease.inApp) {
            const notification = await storage.addNotification({
              userId,
              type: "info",
              title: "Available on xREL.to",
              message,
              link: `modal:game:${game.id}`,
            });
            notifyUser("notification", notification);
            if (xrelPrefs.xrelRelease.apprise) appriseClient.send(notification);
          }
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
  const addedGames: { title: string; igdbId: number; steamAppId: number; gameId: string }[] = [];

  const gameDetailsList = await igdbClient.getGamesByIds(Array.from(newIgdbIds));
  const gameDetailsMap = new Map(gameDetailsList.map((g) => [g.id, g]));

  for (const steamAppId of pendingSteamAppIds) {
    const igdbId = steamToIgdbMap.get(steamAppId);
    if (igdbId == null || ownedIgdbIds.has(igdbId)) continue;

    const gameDetails = gameDetailsMap.get(igdbId);
    if (!gameDetails) continue;

    const formatted = igdbClient.formatGameData(gameDetails);
    const game = await storage.addGame({
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
      gameId: game.id,
    });
  }

  return addedGames;
}

export async function syncUserSteamWishlist(
  userId: string,
  triggeredBy: "manual" | "system" = "system"
) {
  let steamSyncFailures = 0;
  let taskId: string | undefined;

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

    const task = await storage.createImportTask({
      userId,
      taskType: "steam_wishlist",
      triggeredBy,
    });
    taskId = task.id;
    await storage.startImportTask(taskId);
    notifyUser("importTaskUpdate", { taskId, status: "in_progress" });

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

    const skippedCount = wishlistGames.length - pendingSteamAppIds.length;

    let addedGames: { title: string; igdbId: number; steamAppId: number; gameId: string }[] = [];
    let failedSteamAppIds: number[] = [];

    if (pendingSteamAppIds.length > 0) {
      const steamToIgdbMap = await igdbClient.getGameIdsBySteamAppIds(pendingSteamAppIds);
      failedSteamAppIds = pendingSteamAppIds.filter((id) => !steamToIgdbMap.has(id));

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

    const importItems = [
      ...addedGames.map((g) => ({
        taskId: taskId!,
        itemName: `Steam App ${g.steamAppId}`,
        result: "added" as const,
        gameId: g.gameId,
        gameTitle: g.title,
      })),
      ...failedSteamAppIds.map((id) => ({
        taskId: taskId!,
        itemName: `Steam App ${id}`,
        result: "failed" as const,
        errorMessage: "No IGDB match found",
      })),
    ];
    if (importItems.length > 0) {
      await storage.addImportTaskItemsBatch(importItems);
    }

    const finalStatus = failedSteamAppIds.length > 0 ? "completed_with_errors" : "completed";

    await storage.updateImportTask(taskId, {
      status: finalStatus,
      completedAt: new Date(),
      totalItems: wishlistGames.length,
      addedItems: addedGames.length,
      skippedItems: skippedCount,
      failedItems: failedSteamAppIds.length,
    });
    notifyUser("importTaskUpdate", { taskId, status: finalStatus });

    const steamPrefs = resolvePrefs(settings);
    if (addedGames.length > 0 && steamPrefs.steamSync.inApp) {
      const notification = await storage.addNotification({
        userId,
        type: "success",
        title: "Steam Wishlist Synced",
        message: `Successfully added ${addedGames.length} games from your Steam Wishlist.`,
      });
      notifyUser("notification", notification);
      if (steamPrefs.steamSync.apprise) appriseClient.send(notification);
    }

    return { success: true, addedCount: addedGames.length, games: addedGames };
  } catch (error) {
    const nextSteamSyncFailures = steamSyncFailures + 1;
    await storage.updateUserSettings(userId, { steamSyncFailures: nextSteamSyncFailures });
    igdbLogger.error({ userId, error }, "Steam Sync Failed");
    const errMessage = error instanceof Error ? error.message : "Unknown error";

    if (taskId) {
      await storage
        .updateImportTask(taskId, {
          status: "failed",
          completedAt: new Date(),
          errorMessage: errMessage,
        })
        .catch(() => undefined);
      notifyUser("importTaskUpdate", { taskId, status: "failed" });
    }

    return { success: false, message: errMessage };
  }
}
