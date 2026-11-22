/**
 * Tables in foreign-key-safe order: a table never appears before something it
 * references. Hard-coded rather than derived so the order is reviewable.
 */
export const TABLE_ORDER = [
  // No foreign keys.
  "users",
  "pathMappings",
  "platformMappings",
  "systemConfig",
  "rootFolders",
  "indexers",
  "downloaders",
  "rssFeeds",
  // Reference the above.
  "userSettings",
  "games",
  "notifications",
  "apiKeys",
  "importTasks",
  "rssFeedItems",
  "releaseProfiles",
  "customFormats",
  // Reference games / downloaders / importTasks.
  "gameDownloads",
  "ddlJobs",
  "xrelNotifiedReleases",
  "releaseBlacklist",
  "downloadEvents",
  "aiAutoDownloadHolds",
  "importTaskItems",
  "collections",
  "collectionGames",
  "tags",
  "gameTags",
  "gameJournalEntries",
  "gameMilestones",
  "gamePlaySessions",
  "gameStatusEvents",
  "quests",
  "gameScreenshots",
  // References games and gameDownloads, so it goes last.
  "gameFiles",
  // References rootFolders; nothing references it.
  "libraryScanIgnored",
  // Nothing references it.
  "classificationCandidates",
  // Nothing references it.
  "classificationCache",
  // References users and games; nothing references it.
  "integrationRequests",
  // Reference users / webhookSubscriptions; deliveries come after their subscription.
  "webhookSubscriptions",
  "webhookDeliveries",
] as const;

export type TableName = (typeof TABLE_ORDER)[number];
