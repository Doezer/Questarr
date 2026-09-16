import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  jsonb,
  customType,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type {
  GameFileCategory,
  ImportTaskItemResult,
  ImportTaskStatus,
  ImportTaskType,
} from "./schema.js";

/**
 * Postgres mirror of shared/schema.ts.
 *
 * This file is RUNTIME ONLY. shared/schema.ts remains the single source of
 * TypeScript types and Zod schemas for the whole codebase (the client imports
 * from it in 47 places); nothing here is re-exported as a type.
 *
 * Do not add Zod schemas, type exports, or helper types to this file. The two
 * schemas are kept structurally identical by shared/schema-parity.ts (compile
 * time) and shared/__tests__/schema-parity.test.ts (runtime) -- server/db/tables.ts
 * casts between them and is only sound because those guards exist.
 *
 * Type mapping rationale, where it is not a straight copy:
 *   integer({mode:"boolean"})      -> boolean       native; same TS type
 *   integer({mode:"timestamp_ms"}) -> timestampMs   see below
 *   text({mode:"json"})            -> jsonb         native; same TS type
 *   real                           -> doublePrecision  sqlite-core real is
 *                                     8-byte, pg real is 4-byte
 *   integer (byte counts)          -> bigint        pg integer is 32-bit, so
 *                                     file sizes and disk capacities overflow
 */

/**
 * Epoch-milliseconds stored as bigint, surfaced as Date.
 *
 * This is the same representation SQLite's integer({mode:"timestamp_ms"}) uses,
 * which is deliberate: raw SQL in storage.ts compares these columns against
 * Date.now(), and a native timestamptz column would reject an integer bind.
 * Keeping the storage representation identical keeps storage.ts free of
 * per-dialect branches.
 *
 * Switching to timestamptz later is a Postgres-only migration
 * (ALTER TABLE ... USING to_timestamp(col / 1000.0)) plus a new body for this
 * type; because the TypeScript type stays Date either way, no application code
 * would change. See docs/DATABASE.md.
 *
 * fromDriver must accept string: node-postgres returns int8 (OID 20) as a
 * string. Do not "fix" that with a global pg.types.setTypeParser(20, Number) --
 * that would change every bigint process-wide, including count(*).
 */
export const timestampMs = customType<{ data: Date; driverData: string | number }>({
  dataType: () => "bigint",
  fromDriver: (v) => new Date(typeof v === "string" ? Number(v) : v),
  toDriver: (v) => v.getTime(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  steamId64: text("steam_id_64"),
});

export const pathMappings = pgTable("path_mappings", {
  id: text("id").primaryKey(),
  remotePath: text("remote_path").notNull(),
  localPath: text("local_path").notNull(),
  remoteHost: text("remote_host"),
});

export const platformMappings = pgTable("platform_mappings", {
  id: text("id").primaryKey(),
  igdbPlatformId: integer("igdb_platform_id").notNull(),
  sourcePlatformName: text("source_platform_name").notNull(),
});

export const userSettings = pgTable("user_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  autoSearchEnabled: boolean("auto_search_enabled").notNull().default(true),
  autoDownloadEnabled: boolean("auto_download_enabled").notNull().default(false),
  notificationPreferences: text("notification_preferences"),
  searchIntervalHours: integer("search_interval_hours").notNull().default(6),
  igdbRateLimitPerSecond: integer("igdb_rate_limit_per_second").notNull().default(3),
  downloadRules: text("download_rules"),
  lastAutoSearch: timestampMs("last_auto_search"),
  xrelSceneReleases: boolean("xrel_scene_releases").notNull().default(true),
  xrelP2pReleases: boolean("xrel_p2p_releases").notNull().default(false),
  autoSearchUnreleased: boolean("auto_search_unreleased").notNull().default(false),
  steamSyncFailures: integer("steam_sync_failures").notNull().default(0),
  steamSyncEnabled: boolean("steam_sync_enabled").notNull().default(false),
  steamSyncIntervalHours: integer("steam_sync_interval_hours").notNull().default(24),
  lastSteamSync: timestampMs("last_steam_sync"),
  preferredReleaseGroups: text("preferred_release_groups"),
  filterByPreferredGroups: boolean("filter_by_preferred_groups").notNull().default(false),
  preferredPlatform: text("preferred_platform"),
  hideAdultContent: boolean("hide_adult_content").notNull().default(true),
  hideAgeRestrictedContent: boolean("hide_age_restricted_content").notNull().default(true),
  // Import Engine Settings
  enablePostProcessing: boolean("enable_post_processing").notNull().default(false),
  autoUnpack: boolean("auto_unpack").notNull().default(false),
  renamePattern: text("rename_pattern").notNull().default("{Title} ({Region})"),
  overwriteExisting: boolean("overwrite_existing").notNull().default(false),
  transferMode: text("transfer_mode").notNull().default("hardlink"),
  importPlatformIds: jsonb("import_platform_ids").$type<number[]>().default([]),
  ignoredExtensions: jsonb("ignored_extensions").$type<string[]>().default([]),
  minFileSize: bigint("min_file_size", { mode: "number" }).notNull().default(0),
  libraryRoot: text("library_root").notNull().default("/data"),
  autoDeleteAfterImport: boolean("auto_delete_after_import").notNull().default(false),
  sortExtras: boolean("sort_extras").notNull().default(false),
  // Telemetry: opt-in, off by default. When enabled, automatically-detected server
  // errors are sent as a diagnostic report without prompting (see server/error-telemetry.ts).
  telemetryEnabled: boolean("telemetry_enabled").notNull().default(false),
  updatedAt: timestampMs("updated_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestampMs("updated_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const games = pgTable("games", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  igdbId: integer("igdb_id"),
  steamAppId: integer("steam_appid"),
  title: text("title").notNull(),
  summary: text("summary"),
  coverUrl: text("cover_url"),
  releaseDate: text("release_date"),
  rating: doublePrecision("rating"),
  platforms: jsonb("platforms").$type<string[]>(),
  genres: jsonb("genres").$type<string[]>(),
  themes: jsonb("themes").$type<string[]>(),
  publishers: jsonb("publishers").$type<string[]>(),
  developers: jsonb("developers").$type<string[]>(),
  screenshots: jsonb("screenshots").$type<string[]>(),
  source: text("source").default("manual"), // "manual" | "steam" | "api"
  igdbWebsites: jsonb("igdb_websites").$type<Array<{ category: number; url: string }>>(),
  aggregatedRating: doublePrecision("aggregated_rating"),
  status: text("status").notNull().default("wanted"), // Enum validation handled by Zod
  originalReleaseDate: text("original_release_date"),
  releaseStatus: text("release_status").default("upcoming"), // Enum validation handled by Zod
  earlyAccess: boolean("early_access").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  isAdultContent: boolean("is_adult_content").notNull().default(false),
  isAgeRestricted: boolean("is_age_restricted").notNull().default(false),
  userRating: doublePrecision("user_rating"),
  notes: text("notes"),
  libraryPath: text("library_path"),
  searchResultsAvailable: boolean("search_results_available").default(false).notNull(),
  searchResultsAvailableAt: timestampMs("search_results_available_at"),
  updateSearchResultsAvailable: boolean("update_search_results_available").default(false).notNull(),
  packsSearchResultsAvailable: boolean("packs_search_results_available").default(false).notNull(),
  addedAt: timestampMs("added_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  completedAt: timestampMs("completed_at"),
});

export const indexers = pgTable("indexers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKey: text("api_key").notNull(),
  protocol: text("protocol").notNull().default("torznab"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  categories: jsonb("categories").$type<string[]>().default([]),
  rssEnabled: boolean("rss_enabled").notNull().default(true),
  autoSearchEnabled: boolean("auto_search_enabled").notNull().default(true),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  updatedAt: timestampMs("updated_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const downloaders = pgTable("downloaders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // Enum validation handled by Zod
  url: text("url").notNull(),
  port: integer("port"),
  useSsl: boolean("use_ssl").default(false),
  urlPath: text("url_path"),
  // Opt-in per-downloader bypass for TLS certificate validation. Left off by
  // default: a hung/failed TLS handshake should surface as an error, not
  // silently fall back to an insecure connection unless the user explicitly
  // trusts this downloader's self-signed certificate.
  allowSelfSignedCertificate: boolean("allow_self_signed_certificate").notNull().default(false),
  username: text("username"),
  password: text("password"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(1),
  downloadPath: text("download_path"),
  category: text("category").default("games"),
  label: text("label").default("Questarr"),
  addStopped: boolean("add_stopped").default(false),
  removeCompleted: boolean("remove_completed").default(false),
  postImportCategory: text("post_import_category"),
  settings: text("settings"),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  updatedAt: timestampMs("updated_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const gameDownloads = pgTable(
  "game_downloads",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    downloaderId: text("downloader_id")
      .notNull()
      .references(() => downloaders.id, { onDelete: "cascade" }),
    downloadType: text("download_type").notNull().default("torrent"),
    downloadHash: text("download_hash").notNull(),
    downloadTitle: text("download_title").notNull(),
    status: text("status").notNull().default("downloading"),
    errorMessage: text("error_message"),
    fileSize: bigint("file_size", { mode: "number" }),
    addedAt: timestampMs("added_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
    completedAt: timestampMs("completed_at"),
  },
  (t) => [uniqueIndex("game_downloads_downloader_hash_idx").on(t.downloaderId, t.downloadHash)]
);

// Legacy table name for backward compatibility during migration
export const legacy_gameDownloads = gameDownloads;

export const xrelNotifiedReleases = pgTable("xrel_notified_releases", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  xrelReleaseId: text("xrel_release_id").notNull(),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const releaseBlacklist = pgTable(
  "release_blacklist",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    releaseTitle: text("release_title").notNull(),
    indexerName: text("indexer_name"),
    createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  },
  (t) => [uniqueIndex("release_blacklist_game_title_idx").on(t.gameId, t.releaseTitle)]
);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  read: boolean("read").notNull().default(false),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const rssFeeds = pgTable("rss_feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull().default("custom"), // 'preset' or 'custom'
  enabled: boolean("enabled").notNull().default(true),
  mapping: jsonb("mapping").$type<{ titleField?: string; linkField?: string }>(),
  lastCheck: timestampMs("last_check"),
  status: text("status").default("ok"), // 'ok' or 'error'
  errorMessage: text("error_message"),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  updatedAt: timestampMs("updated_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const rssFeedItems = pgTable("rss_feed_items", {
  id: text("id").primaryKey(),
  feedId: text("feed_id")
    .notNull()
    .references(() => rssFeeds.id, { onDelete: "cascade" }),
  guid: text("guid").notNull(),
  title: text("title").notNull(),
  link: text("link").notNull(),
  pubDate: timestampMs("pub_date"),
  sourceName: text("source_name"),
  igdbGameId: integer("igdb_game_id"),
  igdbGameName: text("igdb_game_name"),
  coverUrl: text("cover_url"),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const importTasks = pgTable("import_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull().$type<ImportTaskType>(),
  triggeredBy: text("triggered_by").notNull(), // "manual" | "system"
  status: text("status").notNull().default("pending").$type<ImportTaskStatus>(),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  startedAt: timestampMs("started_at"),
  completedAt: timestampMs("completed_at"),
  totalItems: integer("total_items").notNull().default(0),
  addedItems: integer("added_items").notNull().default(0),
  skippedItems: integer("skipped_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  errorMessage: text("error_message"),
});

export const importTaskItems = pgTable(
  "import_task_items",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => importTasks.id, { onDelete: "cascade" }),
    itemName: text("item_name").notNull(),
    result: text("result").notNull().$type<ImportTaskItemResult>(),
    gameId: text("game_id"),
    gameTitle: text("game_title"),
    errorMessage: text("error_message"),
    createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  },
  (t) => [index("import_task_items_task_id_idx").on(t.taskId)]
);

export const gameFiles = pgTable(
  "game_files",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    downloadId: text("download_id").references(() => gameDownloads.id, { onDelete: "set null" }),
    originalName: text("original_name").notNull(),
    storedName: text("stored_name").notNull(),
    category: text("category").notNull().$type<GameFileCategory>(),
    filePath: text("file_path").notNull(),
    fileSize: bigint("file_size", { mode: "number" }),
    createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
  },
  (t) => [
    index("game_files_game_id_idx").on(t.gameId),
    index("game_files_download_id_idx").on(t.downloadId),
  ]
);

export const rootFolders = pgTable("root_folders", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  name: text("name"),
  enabled: boolean("enabled").notNull().default(true),
  // Opt-in, off by default: whether Questarr's normal "delete game + files"
  // flow is allowed to remove files under this folder. Discovery on its own
  // never touches disk; this only affects the explicit delete flow, and only
  // for games whose libraryPath resolves inside this specific folder.
  allowDelete: boolean("allow_delete").notNull().default(false),
  accessible: boolean("accessible"),
  diskFreeBytes: bigint("disk_free_bytes", { mode: "number" }),
  diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }),
  lastScannedAt: timestampMs("last_scanned_at"),
  createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    // Leading characters of the raw key, kept so the UI can tell two keys apart
    // without being able to reconstruct either of them.
    prefix: text("prefix").notNull(),
    createdAt: timestampMs("created_at").default(sql`(EXTRACT(EPOCH FROM now()) * 1000)::bigint`),
    lastUsedAt: timestampMs("last_used_at"),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
    index("api_keys_user_id_idx").on(t.userId),
  ]
);
