import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { FormatSpec, ReleaseProfile } from "./release-scoring.js";
import { resolveTargetPlatform } from "./title-utils.js";
import { hasReversedYearRange, isEmptyCollectionRules } from "./collection-rules.js";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  steamId64: text("steam_id_64"),
});

export const pathMappings = sqliteTable("path_mappings", {
  id: text("id").primaryKey(),
  remotePath: text("remote_path").notNull(),
  localPath: text("local_path").notNull(),
  remoteHost: text("remote_host"),
});

export const platformMappings = sqliteTable("platform_mappings", {
  id: text("id").primaryKey(),
  igdbPlatformId: integer("igdb_platform_id").notNull(),
  sourcePlatformName: text("source_platform_name").notNull(),
});

export const userSettings = sqliteTable("user_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  autoSearchEnabled: integer("auto_search_enabled", { mode: "boolean" }).notNull().default(true),
  autoDownloadEnabled: integer("auto_download_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  notificationPreferences: text("notification_preferences"),
  searchIntervalHours: integer("search_interval_hours").notNull().default(6),
  igdbRateLimitPerSecond: integer("igdb_rate_limit_per_second").notNull().default(3),
  downloadRules: text("download_rules"),
  lastAutoSearch: integer("last_auto_search", { mode: "timestamp_ms" }),
  xrelSceneReleases: integer("xrel_scene_releases", { mode: "boolean" }).notNull().default(true),
  xrelP2pReleases: integer("xrel_p2p_releases", { mode: "boolean" }).notNull().default(false),
  autoSearchUnreleased: integer("auto_search_unreleased", { mode: "boolean" })
    .notNull()
    .default(false),
  steamSyncFailures: integer("steam_sync_failures").notNull().default(0),
  steamSyncEnabled: integer("steam_sync_enabled", { mode: "boolean" }).notNull().default(false),
  steamSyncIntervalHours: integer("steam_sync_interval_hours").notNull().default(24),
  lastSteamSync: integer("last_steam_sync", { mode: "timestamp_ms" }),
  preferredReleaseGroups: text("preferred_release_groups"),
  filterByPreferredGroups: integer("filter_by_preferred_groups", { mode: "boolean" })
    .notNull()
    .default(false),
  // Global, case-insensitive substring blacklist for release names (e.g. "HYPERVISOR"),
  // stored as a JSON string array. Unlike releaseBlacklist (per-game, exact title match,
  // added from a specific search result), this applies across every game and every search
  // flow -- manual search, auto-search, and AI (Jev) enrichment/auto-download analysis --
  // so a matching release never reaches the user or the AI in the first place.
  releaseNameBlacklist: text("release_name_blacklist"),
  preferredPlatform: text("preferred_platform"),
  hideAdultContent: integer("hide_adult_content", { mode: "boolean" }).notNull().default(true),
  hideAgeRestrictedContent: integer("hide_age_restricted_content", { mode: "boolean" })
    .notNull()
    .default(true),
  hideShelvedByDefault: integer("hide_shelved_by_default", { mode: "boolean" })
    .notNull()
    .default(true),
  hideOwnedInHasResults: integer("hide_owned_in_has_results", { mode: "boolean" })
    .notNull()
    .default(true),
  // Import Engine Settings
  enablePostProcessing: integer("enable_post_processing", { mode: "boolean" })
    .notNull()
    .default(false),
  autoUnpack: integer("auto_unpack", { mode: "boolean" }).notNull().default(false),
  renamePattern: text("rename_pattern").notNull().default("{Title} ({Region})"),
  overwriteExisting: integer("overwrite_existing", { mode: "boolean" }).notNull().default(false),
  transferMode: text("transfer_mode").notNull().default("hardlink"),
  importPlatformIds: text("import_platform_ids", { mode: "json" }).$type<number[]>().default([]),
  ignoredExtensions: text("ignored_extensions", { mode: "json" }).$type<string[]>().default([]),
  minFileSize: integer("min_file_size").notNull().default(0),
  libraryRoot: text("library_root").notNull().default("/data"),
  autoDeleteAfterImport: integer("auto_delete_after_import", { mode: "boolean" })
    .notNull()
    .default(false),
  sortExtras: integer("sort_extras", { mode: "boolean" }).notNull().default(false),
  // Telemetry: opt-in, off by default. When enabled, automatically-detected server
  // errors are sent as a diagnostic report without prompting (see server/error-telemetry.ts).
  telemetryEnabled: integer("telemetry_enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// ... existing code ...

export const insertPathMappingSchema = z.object({
  remotePath: z.string().min(1),
  localPath: z.string().min(1),
  remoteHost: z.string().nullable().optional(),
});

export const updatePathMappingSchema = z.object({
  remotePath: z.string().min(1),
  localPath: z.string().min(1),
  remoteHost: z.string().min(1).nullable().optional(),
});

export const insertPlatformMappingSchema = z.object({
  igdbPlatformId: z.number().int(),
  sourcePlatformName: z.string().min(1),
});

export type PathMapping = typeof pathMappings.$inferSelect;
export type InsertPathMapping = (typeof insertPathMappingSchema)["_output"];
export type UpdatePathMapping = (typeof updatePathMappingSchema)["_output"];

export type PlatformMapping = typeof platformMappings.$inferSelect;
export type InsertPlatformMapping = (typeof insertPlatformMappingSchema)["_output"];

// ... existing code ...

export interface ImportConfig {
  enablePostProcessing: boolean;
  autoUnpack: boolean;
  renamePattern: string;
  overwriteExisting: boolean;
  transferMode: ImportTransferMode;
  importPlatformIds: number[];
  ignoredExtensions: string[];
  minFileSize: number;
  libraryRoot: string;
  autoDeleteAfterImport: boolean;
  sortExtras: boolean;
}

// gameDownloads.status value for a download whose linked game record can't be
// found. Kept as a shared constant (rather than the literal repeated across
// server and client) since it's the join key between ImportManager, the
// storage layer's getUnlinkedImportReviews/relinkGameDownload, the /link
// route, and the pending-imports UI that decides whether to open
// LinkGameModal or the regular ImportReviewModal.
export const GAME_LINK_REQUIRED_STATUS = "game_link_required";

// gameDownloads.status value set when a pre-import security scan (VirusTotal
// and/or ClamAV) flags the download. The file is moved to a quarantine
// directory rather than the library, and the reason is recorded in errorMessage.
export const QUARANTINED_STATUS = "quarantined";

export const IMPORT_TRANSFER_MODES = ["move", "copy", "hardlink", "symlink"] as const;

export type ImportTransferMode = (typeof IMPORT_TRANSFER_MODES)[number];

export const importTransferModeSchema = z.enum(IMPORT_TRANSFER_MODES);

export const importConfigSchema = z.object({
  enablePostProcessing: z.boolean(),
  autoUnpack: z.boolean(),
  renamePattern: z.string().min(1),
  overwriteExisting: z.boolean(),
  transferMode: importTransferModeSchema,
  importPlatformIds: z.array(z.number().int().min(1)),
  ignoredExtensions: z.array(z.string()),
  minFileSize: z.number().int().min(0),
  libraryRoot: z.string().min(1),
  autoDeleteAfterImport: z.boolean(),
  sortExtras: z.boolean(),
});

// A DLC/expansion IGDB reports as related to a game, carried through from
// IGDBClient.formatGameData for display; not a separately tracked entity.
export type CollectionType = "manual" | "smart";

/** Filter rules of a smart collection. Every set field must match (AND); the list fields match
 * when the game has at least one of the listed values (OR). */
export type CollectionRules = {
  statuses?: string[] | undefined;
  platforms?: string[] | undefined;
  genres?: string[] | undefined;
  /** Minimum IGDB rating (0-10, as stored on games). */
  minRating?: number | undefined;
  /** Minimum personal rating (0.5-10). */
  minUserRating?: number | undefined;
  releaseYearFrom?: number | undefined;
  releaseYearTo?: number | undefined;
  /** Case-insensitive substring of the title. */
  titleContains?: string | undefined;
};

export type GameExpansion = {
  id: number;
  name: string;
  coverUrl: string;
  releaseDate: string;
  category: "main" | "update" | "dlc" | "extra" | "packs";
  gameType?: number | undefined;
  igdbUrl?: string | undefined;
};

export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  igdbId: integer("igdb_id"),
  steamAppId: integer("steam_appid"),
  title: text("title").notNull(),
  summary: text("summary"),
  coverUrl: text("cover_url"),
  releaseDate: text("release_date"),
  rating: real("rating"),
  platforms: text("platforms", { mode: "json" }).$type<string[]>(),
  targetPlatformId: integer("target_platform_id"),
  targetPlatformName: text("target_platform_name"),
  genres: text("genres", { mode: "json" }).$type<string[]>(),
  themes: text("themes", { mode: "json" }).$type<string[]>(),
  publishers: text("publishers", { mode: "json" }).$type<string[]>(),
  developers: text("developers", { mode: "json" }).$type<string[]>(),
  screenshots: text("screenshots", { mode: "json" }).$type<string[]>(),
  // IGDB trailers/gameplay clips: `videoId` is the YouTube video id
  videos: text("videos", { mode: "json" }).$type<Array<{ name: string; videoId: string }>>(),
  source: text("source").default("manual"), // "manual" | "steam" | "api"
  igdbWebsites: text("igdb_websites", { mode: "json" }).$type<
    Array<{ category: number; url: string }>
  >(),
  expansions: text("expansions", { mode: "json" }).$type<GameExpansion[]>(),
  aggregatedRating: real("aggregated_rating"),
  timeToBeatHastily: real("time_to_beat_hastily"),
  timeToBeatNormally: real("time_to_beat_normally"),
  timeToBeatCompletely: real("time_to_beat_completely"),
  status: text("status").notNull().default("wanted"), // Enum validation handled by Zod
  originalReleaseDate: text("original_release_date"),
  releaseStatus: text("release_status").default("upcoming"), // Enum validation handled by Zod
  earlyAccess: integer("early_access", { mode: "boolean" }).notNull().default(false),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  isAdultContent: integer("is_adult_content", { mode: "boolean" }).notNull().default(false),
  isAgeRestricted: integer("is_age_restricted", { mode: "boolean" }).notNull().default(false),
  userRating: real("user_rating"),
  libraryPath: text("library_path"),
  installedVersion: text("installed_version"),
  searchResultsAvailable: integer("search_results_available", { mode: "boolean" })
    .default(false)
    .notNull(),
  searchResultsAvailableAt: integer("search_results_available_at", { mode: "timestamp_ms" }),
  updateSearchResultsAvailable: integer("update_search_results_available", { mode: "boolean" })
    .default(false)
    .notNull(),
  packsSearchResultsAvailable: integer("packs_search_results_available", { mode: "boolean" })
    .default(false)
    .notNull(),
  addedAt: integer("added_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export const indexers = sqliteTable("indexers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKey: text("api_key").notNull(),
  protocol: text("protocol").notNull().default("torznab"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1),
  categories: text("categories", { mode: "json" }).$type<string[]>().default([]),
  rssEnabled: integer("rss_enabled", { mode: "boolean" }).notNull().default(true),
  autoSearchEnabled: integer("auto_search_enabled", { mode: "boolean" }).notNull().default(true),
  // Opt-in per-indexer bypass allowing API keys to be sent over plain HTTP.
  // Off by default: API keys must not travel in clear text unless the user
  // explicitly acknowledges the risk (e.g. an indexer on a trusted LAN that
  // does not support TLS). When this flag is false and the indexer URL uses
  // HTTP, API keys are omitted from every outbound request.
  allowInsecureLan: integer("allow_insecure_lan", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const downloaders = sqliteTable("downloaders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // Enum validation handled by Zod
  url: text("url").notNull(),
  port: integer("port"),
  useSsl: integer("use_ssl", { mode: "boolean" }).default(false),
  urlPath: text("url_path"),
  // Opt-in per-downloader bypass for TLS certificate validation. Left off by
  // default: a hung/failed TLS handshake should surface as an error, not
  // silently fall back to an insecure connection unless the user explicitly
  // trusts this downloader's self-signed certificate.
  allowSelfSignedCertificate: integer("allow_self_signed_certificate", { mode: "boolean" })
    .notNull()
    .default(false),
  // Opt-in per-downloader bypass allowing credentials to be sent over plain
  // HTTP. Off by default: passwords and API keys must not travel in clear text
  // unless the user explicitly acknowledges the risk (e.g. a download client on
  // a trusted LAN that does not support TLS). Requires `useSsl` to be false
  // (otherwise the connection is already encrypted and this flag is irrelevant).
  allowInsecureLan: integer("allow_insecure_lan", { mode: "boolean" }).notNull().default(false),
  username: text("username"),
  password: text("password"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1),
  downloadPath: text("download_path"),
  category: text("category").default("games"),
  label: text("label").default("Questarr"),
  addStopped: integer("add_stopped", { mode: "boolean" }).default(false),
  removeCompleted: integer("remove_completed", { mode: "boolean" }).default(false),
  postImportCategory: text("post_import_category"),
  settings: text("settings"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// Track downloads associated with games for completion monitoring
export const gameDownloads = sqliteTable(
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
    fileSize: integer("file_size"),
    // The category the user picked when claiming the download (main, update, dlc...); null when
    // it was only ever inferred from the title.
    category: text("category"),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("game_downloads_downloader_hash_idx").on(t.downloaderId, t.downloadHash)]
);

// Legacy table name for backward compatibility during migration
export const legacy_gameDownloads = gameDownloads;

// Track xREL.to release notifications so we notify once per (game, release) and know which games have xREL listings
export const xrelNotifiedReleases = sqliteTable("xrel_notified_releases", {
  id: text("id").primaryKey(),
  gameId: text("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  xrelReleaseId: text("xrel_release_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// Track releases blacklisted by users to hide them from per-game search results
export const releaseBlacklist = sqliteTable(
  "release_blacklist",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    releaseTitle: text("release_title").notNull(),
    indexerName: text("indexer_name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [uniqueIndex("release_blacklist_game_title_idx").on(t.gameId, t.releaseTitle)]
);

// Release scoring (Questarr-mgmt #12). One profile per user holds the thresholds, the
// built-in rule overrides and the per-format scores; custom formats are rows of their own so
// they can be created, edited and deleted one at a time. The built-in rules themselves are
// code constants (shared/release-scoring.ts), not rows.
export const releaseProfiles = sqliteTable("release_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  minScore: integer("min_score").notNull().default(0),
  protocolPreference: text("protocol_preference").notNull().default("either"),
  requiredTerms: text("required_terms", { mode: "json" }).$type<string[]>().notNull().default([]),
  ignoredTerms: text("ignored_terms", { mode: "json" }).$type<string[]>().notNull().default([]),
  minSeeders: integer("min_seeders").notNull().default(0),
  maxSizeBytes: integer("max_size_bytes"),
  builtInOverrides: text("built_in_overrides", { mode: "json" })
    .$type<ReleaseProfile["builtInOverrides"]>()
    .notNull()
    .default({}),
  formatScores: text("format_scores", { mode: "json" })
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const customFormats = sqliteTable(
  "custom_formats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    specs: text("specs", { mode: "json" }).$type<FormatSpec[]>().notNull().default([]),
    score: integer("score").notNull().default(0),
    hardReject: integer("hard_reject", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("custom_formats_user_idx").on(t.userId)]
);

// Local-only journaling entries for a game (e.g. while playing it). Never
// synced externally — a personal log, replacing the old single-field notes.
export const gameJournalEntries = sqliteTable(
  "game_journal_entries",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("game_journal_entries_game_user_idx").on(t.gameId, t.userId)]
);

// User-defined "successes" checklist per game. Kept separate from any
// Steam-sourced achievements, which are fetched live rather than stored here.
export const gameMilestones = sqliteTable(
  "game_milestones",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("game_milestones_game_user_idx").on(t.gameId, t.userId)]
);

// User-uploaded screenshots for a game, stored on disk with the path recorded here.
export const gameScreenshots = sqliteTable(
  "game_screenshots",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    caption: text("caption"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("game_screenshots_game_user_idx").on(t.gameId, t.userId)]
);

// Tracks releases the TypeSafe AI auto-download check flagged for human review, so a
// later cron cycle can't silently auto-download one before anyone looked. Distinct from
// releaseBlacklist: a held release must stay visible in manual per-game search so the
// user can still choose to download it themselves.
export const aiAutoDownloadHolds = sqliteTable(
  "ai_auto_download_holds",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    releaseTitle: text("release_title").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [uniqueIndex("ai_auto_download_holds_game_title_idx").on(t.gameId, t.releaseTitle)]
);

// User-defined collections of games. "manual" collections hold an explicit list of games
// (collection_games); "smart" ones store filter rules and are evaluated against the library
// on read, so they never go stale.
export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull().default("manual"), // "manual" | "smart" — validated by Zod
    rules: text("rules", { mode: "json" }).$type<CollectionRules>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("collections_user_idx").on(t.userId)]
);

export const collectionGames = sqliteTable(
  "collection_games",
  {
    id: text("id").primaryKey(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [uniqueIndex("collection_games_collection_game_idx").on(t.collectionId, t.gameId)]
);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// Validation schemas using drizzle-zod for runtime validation
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  passwordHash: true,
});

export const insertGameSchema = createInsertSchema(games, {
  targetPlatformId: (schema) => schema.int().positive().nullable().optional(),
  targetPlatformName: (schema) => schema.trim().min(1).max(100).nullable().optional(),
  videos: () =>
    z
      .array(z.object({ name: z.string(), videoId: z.string().regex(/^[\w-]{11}$/) }))
      .nullable()
      .optional(),
  status: (schema) =>
    schema
      .nullable()
      .optional()
      .transform((val) => val ?? "wanted"),
  hidden: (schema) =>
    schema
      .nullable()
      .optional()
      .transform((val) => val ?? false),
  isAdultContent: (schema) =>
    schema
      .nullable()
      .optional()
      .transform((val) => val ?? false),
  isAgeRestricted: (schema) =>
    schema
      .nullable()
      .optional()
      .transform((val) => val ?? false),
})
  .omit({
    id: true,
    addedAt: true,
    completedAt: true,
  })
  .superRefine((game, ctx) => {
    const hasTargetId = game.targetPlatformId != null;
    const hasTargetName = game.targetPlatformName != null;
    if (hasTargetId !== hasTargetName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasTargetId ? "targetPlatformName" : "targetPlatformId"],
        message: "Target platform ID and name must be provided together",
      });
    } else if (
      hasTargetId &&
      !resolveTargetPlatform(game.targetPlatformId, game.targetPlatformName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPlatformName"],
        message: "Target platform ID and name must match a supported platform",
      });
    }
  });

export const updateGameTargetPlatformSchema = z
  .object({
    targetPlatformId: z.number().int().positive().nullable(),
    targetPlatformName: z.string().trim().min(1).max(100).nullable(),
  })
  .superRefine((target, ctx) => {
    const hasTargetId = target.targetPlatformId != null;
    const hasTargetName = target.targetPlatformName != null;
    if (hasTargetId !== hasTargetName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasTargetId ? "targetPlatformName" : "targetPlatformId"],
        message: "Target platform ID and name must be provided together",
      });
    } else if (
      hasTargetId &&
      !resolveTargetPlatform(target.targetPlatformId, target.targetPlatformName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPlatformName"],
        message: "Target platform ID and name must match a supported platform",
      });
    }
  });

export const GAME_STATUSES = [
  "wanted",
  "owned",
  "playing",
  "shelved",
  "completed",
  "downloading",
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/**
 * Statuses only the user sets: they describe where the user is with a game
 * they already have, not where its download is. The download/import pipeline
 * must never overwrite them (e.g. an update download finishing must not turn
 * a "playing" game back into "owned").
 */
export const USER_CURATED_GAME_STATUSES = ["playing", "shelved", "completed"] as const;

export function isUserCuratedGameStatus(status: string | null | undefined): boolean {
  return (USER_CURATED_GAME_STATUSES as readonly string[]).includes(status ?? "");
}

/** Statuses meaning the user already has the game (as opposed to wanting it). */
export const ACQUIRED_GAME_STATUSES = ["owned", ...USER_CURATED_GAME_STATUSES] as const;

export const updateGameStatusSchema = z.object({
  status: z.enum(GAME_STATUSES),
  completedAt: z.date().optional(),
});

export const updateGameHiddenSchema = z.object({
  hidden: z.boolean(),
});

export const updateGameUserRatingSchema = z.object({
  userRating: z
    .number()
    .min(0.5, "userRating must be at least 0.5")
    .max(10, "userRating must be at most 10")
    .refine((v) => v * 2 === Math.round(v * 2), {
      message: "userRating must be in 0.5 increments",
    })
    .nullable(),
});

export const updateGameInstalledVersionSchema = z.object({
  // Free text ("v1.2.3", "Build 12345", "1.05 hotfix"...); blank clears it.
  installedVersion: z
    .string()
    .trim()
    .max(64, "installedVersion must be at most 64 characters")
    .nullable()
    .transform((v) => v || null),
});

const trimmedList = z.array(z.string().trim().min(1).max(100)).max(50);

export const collectionRulesSchema = z
  .object({
    statuses: z.array(z.enum(GAME_STATUSES)).max(GAME_STATUSES.length).optional(),
    platforms: trimmedList.optional(),
    genres: trimmedList.optional(),
    minRating: z.number().min(0).max(10).optional(),
    minUserRating: z.number().min(0).max(10).optional(),
    releaseYearFrom: z.number().int().min(1950).max(2100).optional(),
    releaseYearTo: z.number().int().min(1950).max(2100).optional(),
    titleContains: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const collectionBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => v?.trim() || null),
  type: z.enum(["manual", "smart"]),
  rules: collectionRulesSchema.nullish(),
});

type CollectionRulesInput = {
  type?: "manual" | "smart" | undefined;
  rules?: CollectionRules | null | undefined;
};

/** A smart collection needs at least one rule; a manual one never stores rules. */
function refineCollectionRules(value: CollectionRulesInput, ctx: z.RefinementCtx) {
  if (value.type === "smart" && isEmptyCollectionRules(value.rules)) {
    ctx.addIssue({
      code: "custom",
      path: ["rules"],
      message: "A smart collection needs at least one rule",
    });
  }
  refineReversedYears(value, ctx);
}

function refineReversedYears(value: CollectionRulesInput, ctx: z.RefinementCtx) {
  if (hasReversedYearRange(value.rules)) {
    ctx.addIssue({
      code: "custom",
      path: ["rules", "releaseYearTo"],
      message: "releaseYearTo must not be before releaseYearFrom",
    });
  }
}

export const insertCollectionSchema = collectionBaseSchema
  .superRefine(refineCollectionRules)
  .transform((v) => ({ ...v, rules: v.type === "smart" ? (v.rules ?? null) : null }));

export const updateCollectionSchema = collectionBaseSchema
  .partial()
  // The "smart needs a rule" check runs in the PATCH route, on the patch merged with the stored
  // collection, so a patch may omit rules that are already stored.
  .superRefine(refineReversedYears)
  .transform((v) => (v.type === "manual" ? { ...v, rules: null } : v));

export const addCollectionGameSchema = z.object({
  gameId: z.string().trim().min(1),
});

export const insertGameJournalEntrySchema = createInsertSchema(gameJournalEntries, {
  note: (schema) => schema.trim().min(1, "Note cannot be empty").max(10000),
}).omit({
  id: true,
  createdAt: true,
});

export const insertGameMilestoneSchema = createInsertSchema(gameMilestones, {
  label: (schema) => schema.trim().min(1, "Label is required").max(200),
}).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const updateGameMilestoneSchema = z.object({
  completed: z.boolean(),
});

export const updateGameScreenshotSchema = z.object({
  caption: z
    .string()
    .max(300)
    .nullable()
    .transform((val) => val?.trim() || null),
});

export const insertIndexerSchema = createInsertSchema(indexers, {
  name: (schema) => schema.trim().min(1, "Name is required"),
  url: (schema) => schema.trim().min(1, "URL is required"),
  apiKey: (schema) => schema.trim().min(1, "API key is required"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Trim helper for nullable/optional string fields in Zod schemas.
const trimIfString = <T>(v: T): T => (typeof v === "string" ? (v.trim() as T) : v);

export const insertDownloaderSchema = createInsertSchema(downloaders, {
  name: (schema) => schema.trim().min(1, "Name is required"),
  type: (schema) => schema.trim().min(1, "Type is required"),
  url: (schema) => schema.trim().min(1, "Host is required"),
  username: (schema) => schema.transform(trimIfString),
  password: (schema) => schema.transform(trimIfString),
  urlPath: (schema) => schema.transform(trimIfString),
  downloadPath: (schema) => schema.transform(trimIfString),
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine((data) => !(data.type === "sabnzbd" && !data.username), {
    message: "API key is required for SABnzbd",
    path: ["username"],
  });

export const insertGameDownloadSchema = createInsertSchema(gameDownloads).omit({
  id: true,
  addedAt: true,
  completedAt: true,
});

// Legacy schema name for backward compatibility
export const insertGameDownloadLegacySchema = insertGameDownloadSchema;

// Request body schema for the claim-download endpoint
export const claimDownloadRequestSchema = z.object({
  downloaderId: z.string().min(1),
  downloadHash: z.string().min(1),
  downloadTitle: z.string().min(1),
  currentStatus: z.string().min(1),
  category: z.enum(["main", "update", "dlc", "extra", "packs"]),
  gameId: z.string().optional(),
  newGame: z
    .object({
      igdbId: z.number().int().optional(),
      title: z.string().min(1),
      coverUrl: z.string().optional(),
      summary: z.string().optional(),
      releaseDate: z.string().optional(),
      platforms: z.array(z.string()).optional(),
      genres: z.array(z.string()).optional(),
      rating: z.number().optional(),
      aggregatedRating: z.number().optional(),
      screenshots: z.array(z.string()).optional(),
      videos: z.array(z.object({ name: z.string(), videoId: z.string() })).optional(),
      igdbWebsites: z.array(z.object({ category: z.number(), url: z.string() })).optional(),
    })
    .optional(),
});
export type ClaimDownloadRequest = z.infer<typeof claimDownloadRequestSchema>;

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  read: true,
});

// Download rules schema for auto-download filtering
export const downloadRulesSchema = z.object({
  minSeeders: z.number().int().min(0).default(0),
  sortBy: z.enum(["score", "seeders", "date", "size", "priority"]).default("seeders"),
  visibleCategories: z
    .array(z.enum(["main", "update", "dlc", "extra", "packs"]))
    .default(["main", "update", "dlc", "extra", "packs"]),
  // releases the scoring profile rejects (wrong title, nuked, below the minimum score) stay out
  // of the manual download dialog unless the user turns this off
  hideRejected: z.boolean().default(true),
});

export type DownloadRules = z.infer<typeof downloadRulesSchema>;

export const insertXrelNotifiedReleaseSchema = createInsertSchema(xrelNotifiedReleases).omit({
  id: true,
  createdAt: true,
});

function validateUserSettingsEnums(
  value: Record<string, unknown>,
  ctx: {
    addIssue: (issue: { code: "custom"; path: string[]; message: string }) => void;
  }
) {
  if (
    value.transferMode &&
    !IMPORT_TRANSFER_MODES.includes(value.transferMode as ImportTransferMode)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferMode"],
      message: "Invalid transfer mode",
    });
  }

  // JSON array columns round-trip through the client, so a malformed payload
  // (
  // "oops", 42, {...}) would be persisted verbatim and later crash consumers
  // that iterate or spread it. Reject anything that is not an array of the
  // declared element type.
  const arrayFields: Array<{ key: string; element: "string" | "number" }> = [
    { key: "importPlatformIds", element: "number" },
    { key: "ignoredExtensions", element: "string" },
  ];
  for (const { key, element } of arrayFields) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    const typeOk =
      Array.isArray(raw) &&
      raw.every((item) =>
        element === "number"
          ? typeof item === "number" && Number.isSafeInteger(item) && item > 0
          : typeof item === "string"
      );
    if (!typeOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be an array of ${element}s`,
      });
    }
  }

  // Text columns holding a JSON-encoded string array are parsed on every search, so a
  // non-array or non-string element must be rejected at write time rather than at read.
  const jsonStringArrayTextFields = ["releaseNameBlacklist"];
  for (const key of jsonStringArrayTextFields) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (!isJsonStringArray(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be a JSON-encoded array of strings`,
      });
    }
  }
}

/** Returns true when `raw` is a string containing a JSON array whose elements are all strings. */
function isJsonStringArray(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string");
  } catch {
    return false;
  }
}

export type ReleaseProfileRow = typeof releaseProfiles.$inferSelect;
export type CustomFormatRow = typeof customFormats.$inferSelect;

const formatSpecInputSchema = z.object({
  field: z.enum(["title", "group", "uploader", "category", "protocol", "indexer"]),
  mode: z.enum(["contains", "exact", "regex"]),
  value: z.string().trim().min(1).max(200),
  negate: z.boolean().optional(),
  required: z.boolean().optional(),
});

/** Body of POST /api/custom-formats and PATCH (every field optional there). */
export const customFormatInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  specs: z.array(formatSpecInputSchema).min(1).max(20),
  score: z.number().int().min(-10000).max(10000),
  hardReject: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type ParsedCustomFormatInput = z.infer<typeof customFormatInputSchema>;
export type CustomFormatInput = Omit<ParsedCustomFormatInput, "specs"> & { specs: FormatSpec[] };

export type CustomFormatUpdate = {
  [K in keyof CustomFormatInput]?: CustomFormatInput[K] | undefined;
};

/** Drops the undefined flags zod leaves on optional keys (exactOptionalPropertyTypes). */
export function toFormatSpecs(specs: ParsedCustomFormatInput["specs"]): FormatSpec[] {
  return specs.map(({ negate, required, ...spec }) => ({
    ...spec,
    ...(negate !== undefined ? { negate } : {}),
    ...(required !== undefined ? { required } : {}),
  }));
}

const builtInOverrideSchema = z.object({
  points: z.number().int().min(-10000).max(10000).optional(),
  enabled: z.boolean().optional(),
});

/** Body of PUT /api/release-profile. */
export const releaseProfileInputSchema = z.object({
  minScore: z.number().int().min(-10000).max(10000),
  protocolPreference: z.enum(["torrent", "usenet", "either"]),
  requiredTerms: z.array(z.string().trim().min(1).max(200)).max(50),
  ignoredTerms: z.array(z.string().trim().min(1).max(200)).max(50),
  minSeeders: z.number().int().min(0).max(100000),
  maxSizeBytes: z.number().int().positive().nullable(),
  builtInOverrides: z.record(z.string().max(64), builtInOverrideSchema),
  formatScores: z.record(z.string().max(64), z.number().int().min(-10000).max(10000)),
});
export type ReleaseProfileInput = z.infer<typeof releaseProfileInputSchema>;

export const insertReleaseBlacklistSchema = createInsertSchema(releaseBlacklist).omit({
  id: true,
  createdAt: true,
});
export type InsertReleaseBlacklist = (typeof insertReleaseBlacklistSchema)["_output"];
export type ReleaseBlacklist = typeof releaseBlacklist.$inferSelect;

export const insertAiAutoDownloadHoldSchema = createInsertSchema(aiAutoDownloadHolds).omit({
  id: true,
  createdAt: true,
});
export type InsertAiAutoDownloadHold = (typeof insertAiAutoDownloadHoldSchema)["_output"];
export type AiAutoDownloadHold = typeof aiAutoDownloadHolds.$inferSelect;

export const insertUserSettingsSchema = createInsertSchema(userSettings)
  .omit({
    id: true,
    updatedAt: true,
  })
  .superRefine(validateUserSettingsEnums);

export const updateUserSettingsSchema = createInsertSchema(userSettings)
  .omit({
    id: true,
    userId: true,
    updatedAt: true,
  })
  .partial()
  .extend({
    igdbRateLimitPerSecond: z.number().int().min(1).max(4).optional(),
  })
  .superRefine(validateUserSettingsEnums);

// Shared password policy: minimum length plus a mix of letters and digits,
// used for both account setup and password changes (client and server).
export const PASSWORD_MIN_LENGTH = 8;

export const passwordPolicySchema = z
  .string()
  .trim()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const updatePasswordSchema = z
  .object({
    currentPassword: z.string().trim().min(1, "Current password is required"),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().trim().min(1, "Confirm password is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type UpdatePassword = z.infer<typeof updatePasswordSchema>;

// Type definitions - using Drizzle's table inference for select types
export type User = typeof users.$inferSelect;
export type InsertUser = (typeof insertUserSchema)["_output"];

export type Game = typeof games.$inferSelect & {
  // Additional fields for Discovery games
  isReleased?: boolean;
  releaseYear?: number | null;
};

export type InsertGame = (typeof insertGameSchema)["_output"];

export type UpdateGameStatus = z.infer<typeof updateGameStatusSchema>;

export type Indexer = typeof indexers.$inferSelect;
export type InsertIndexer = (typeof insertIndexerSchema)["_output"];

export type Downloader = typeof downloaders.$inferSelect;
export type InsertDownloader = (typeof insertDownloaderSchema)["_output"];

export type GameDownload = typeof gameDownloads.$inferSelect;
export type InsertGameDownload = (typeof insertGameDownloadSchema)["_output"];

export type Collection = typeof collections.$inferSelect;
export type InsertCollection = {
  userId: string;
  name: string;
  description: string | null;
  type: CollectionType;
  rules: CollectionRules | null;
};
export type CollectionGame = typeof collectionGames.$inferSelect;
export type GameJournalEntry = typeof gameJournalEntries.$inferSelect;
export type InsertGameJournalEntry = (typeof insertGameJournalEntrySchema)["_output"];

export type GameMilestone = typeof gameMilestones.$inferSelect;
export type InsertGameMilestone = (typeof insertGameMilestoneSchema)["_output"];

export type GameScreenshot = typeof gameScreenshots.$inferSelect;

export type XrelNotifiedRelease = typeof xrelNotifiedReleases.$inferSelect;
export type InsertXrelNotifiedRelease = (typeof insertXrelNotifiedReleaseSchema)["_output"];

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = (typeof insertNotificationSchema)["_output"];

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = (typeof insertUserSettingsSchema)["_output"];
export type UpdateUserSettings = (typeof updateUserSettingsSchema)["_output"];

export type NotificationEvent =
  | "gameReleased"
  | "gameDelayed"
  | "downloadCompleted"
  | "downloadFailed"
  | "autoDownload"
  | "gameAvailable"
  | "multipleResults"
  | "gameUpdates"
  | "xrelRelease"
  | "steamSync"
  | "errorDetected"
  | "securityAlert";

export type NotificationPreferences = Record<
  NotificationEvent,
  { inApp: boolean; apprise: boolean }
> & {
  gameUpdates: {
    inApp: boolean;
    apprise: boolean;
    // Optional so preferences saved before these controls retain notifications.
    includeShelved?: boolean;
    includeCompleted?: boolean;
  };
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  gameReleased: { inApp: true, apprise: true },
  gameDelayed: { inApp: true, apprise: true },
  downloadCompleted: { inApp: true, apprise: true },
  downloadFailed: { inApp: true, apprise: true },
  autoDownload: { inApp: true, apprise: true },
  gameAvailable: { inApp: true, apprise: true },
  multipleResults: { inApp: true, apprise: true },
  gameUpdates: { inApp: true, apprise: true, includeShelved: true, includeCompleted: true },
  xrelRelease: { inApp: true, apprise: true },
  steamSync: { inApp: true, apprise: false },
  errorDetected: { inApp: true, apprise: false },
  securityAlert: { inApp: true, apprise: true },
};

export interface DownloadSummary {
  topStatus: "downloading" | "paused" | "failed" | "completed";
  count: number;
  downloadTypes: ("torrent" | "usenet")[];
  hasUpdateDownload: boolean;
}

// Lightweight stats surfaced via /api/status for external dashboards (Homepage, Homarr, etc.)
export interface DashboardStatus {
  totalGames: number;
  pendingWishlist: number;
  activeDownloads: number;
  recentImports: {
    count: number;
    items: Array<{
      gameId: string;
      title: string;
      completedAt: string | null;
    }>;
  };
}

// Application configuration type
export interface Config {
  igdb: {
    configured: boolean;
    source?: "env" | "database" | undefined;
    clientId?: string;
  };
  xrel?: {
    apiBase: string;
  };
  discord?: {
    webhookConfigured: boolean;
  };
}

// Download-related types shared between frontend and backend
export interface DownloadFile {
  name: string;
  size: number;
  progress: number; // 0-100
  priority: "off" | "low" | "normal" | "high";
  wanted: boolean;
}

export interface DownloadTracker {
  url: string;
  tier: number;
  status: "working" | "updating" | "error" | "inactive";
  seeders?: number | undefined;
  leechers?: number | undefined;
  lastAnnounce?: string | undefined;
  nextAnnounce?: string | undefined;
  error?: string | undefined;
}

export interface DownloadStatus {
  id: string;
  name: string;
  downloadType?: "torrent" | "usenet"; // Type of download
  status:
    | "downloading"
    | "seeding"
    | "completed"
    | "paused"
    | "error"
    | "repairing"
    | "unpacking"
    | "completed_pending_import"
    | "manual_review_required"
    | "imported";
  progress: number; // 0-100
  downloadSpeed?: number | undefined; // bytes per second
  uploadSpeed?: number | undefined; // bytes per second (torrents only)
  eta?: number | undefined; // seconds
  size?: number | undefined; // total bytes
  downloaded?: number | undefined; // bytes downloaded
  // Protocol-specific fields
  seeders?: number | undefined;
  leechers?: number | undefined;
  ratio?: number | undefined;
  // Usenet-specific fields
  repairStatus?: "good" | "repairing" | "failed" | undefined; // Par2 repair status
  unpackStatus?: "unpacking" | "completed" | "failed" | undefined; // Extract/unpack status
  age?: number | undefined; // Age in days
  // Common fields
  error?: string | undefined;
  category?: string | undefined;
  // Questarr tracking fields
  trackedByQuestarr?: boolean; // True if the download was initiated through Questarr
  downloaderCategory?: string; // The category configured on the downloader (for display purposes)
}

export interface DownloadDetails extends DownloadStatus {
  hash?: string | undefined;
  addedDate?: string | undefined;
  completedDate?: string | undefined;
  downloadDir?: string | undefined;
  /**
   * Full path of the download's content root, set only when the client reports it
   * unambiguously (rTorrent multi-file torrents, whose file paths are relative to it).
   */
  contentPath?: string | undefined;
  comment?: string | undefined;
  creator?: string | undefined;
  files: DownloadFile[];
  filesSupport?: "supported" | "unsupported";
  filesSupportReason?: string;
  trackers: DownloadTracker[];
  totalPeers?: number | undefined;
  connectedPeers?: number | undefined;
}

export interface SearchResultItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  category?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  guid?: string;
  comments?: string;
  attributes?: { [key: string]: string };
  indexerId?: string;
  indexerName?: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  total?: number;
  offset?: number;
  errors?: string[];
}

export const rssFeeds = sqliteTable("rss_feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull().default("custom"), // 'preset' or 'custom'
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  mapping: text("mapping", { mode: "json" }).$type<{ titleField?: string; linkField?: string }>(),
  lastCheck: integer("last_check", { mode: "timestamp_ms" }),
  status: text("status").default("ok"), // 'ok' or 'error'
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const rssFeedItems = sqliteTable("rss_feed_items", {
  id: text("id").primaryKey(),
  feedId: text("feed_id")
    .notNull()
    .references(() => rssFeeds.id, { onDelete: "cascade" }),
  guid: text("guid").notNull(),
  title: text("title").notNull(),
  link: text("link").notNull(),
  pubDate: integer("pub_date", { mode: "timestamp_ms" }),
  sourceName: text("source_name"),
  igdbGameId: integer("igdb_game_id"),
  igdbGameName: text("igdb_game_name"),
  coverUrl: text("cover_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const insertRssFeedSchema = createInsertSchema(rssFeeds).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastCheck: true,
  status: true,
  errorMessage: true,
});

export const insertRssFeedItemSchema = createInsertSchema(rssFeedItems).omit({
  id: true,
  createdAt: true,
});

export type RssFeed = typeof rssFeeds.$inferSelect;
export type InsertRssFeed = (typeof insertRssFeedSchema)["_output"];

export type RssFeedItem = typeof rssFeedItems.$inferSelect;
export type InsertRssFeedItem = (typeof insertRssFeedItemSchema)["_output"];

// Import task history
export const IMPORT_TASK_TYPES = ["steam_wishlist", "file_import", "bulk_add"] as const;
export type ImportTaskType = (typeof IMPORT_TASK_TYPES)[number];

export const IMPORT_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "completed_with_errors",
  "failed",
] as const;
export type ImportTaskStatus = (typeof IMPORT_TASK_STATUSES)[number];

export const IMPORT_TASK_ITEM_RESULTS = ["added", "skipped", "failed", "fuzzy_match"] as const;
export type ImportTaskItemResult = (typeof IMPORT_TASK_ITEM_RESULTS)[number];

export const importTasks = sqliteTable("import_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull().$type<ImportTaskType>(),
  triggeredBy: text("triggered_by").notNull(), // "manual" | "system"
  status: text("status").notNull().default("pending").$type<ImportTaskStatus>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  totalItems: integer("total_items").notNull().default(0),
  addedItems: integer("added_items").notNull().default(0),
  skippedItems: integer("skipped_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  errorMessage: text("error_message"),
});

export const importTaskItems = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("import_task_items_task_id_idx").on(t.taskId)]
);

export const insertImportTaskSchema = createInsertSchema(importTasks).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertImportTaskItemSchema = createInsertSchema(importTaskItems).omit({
  id: true,
  createdAt: true,
});

export type ImportTask = typeof importTasks.$inferSelect;
export type InsertImportTask = (typeof insertImportTaskSchema)["_output"];

export type ImportTaskItem = typeof importTaskItems.$inferSelect;
export type InsertImportTaskItem = (typeof insertImportTaskItemSchema)["_output"];

export const DOWNLOAD_EVENT_TYPES = [
  "grabbed",
  "completed",
  "imported",
  "failed",
  "needs_review",
  "removed",
  "blocklisted",
] as const;
export type DownloadEventType = (typeof DOWNLOAD_EVENT_TYPES)[number];

// Append-only log of what happened to a game's downloads. gameId survives the game being
// deleted as null; gameTitle is a snapshot so the entry still reads sensibly afterwards.
export const downloadEvents = sqliteTable(
  "download_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id").references(() => games.id, { onDelete: "set null" }),
    gameTitle: text("game_title").notNull(),
    eventType: text("event_type").notNull().$type<DownloadEventType>(),
    releaseTitle: text("release_title").notNull(),
    downloaderName: text("downloader_name"),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [index("download_events_user_created_idx").on(t.userId, t.createdAt)]
);

export type DownloadEvent = typeof downloadEvents.$inferSelect;
export type InsertDownloadEvent = Omit<typeof downloadEvents.$inferInsert, "id" | "createdAt">;

export const gameFileCategorySchema = z.enum(["main", "dlc", "update", "extra"]);
export type GameFileCategory = z.infer<typeof gameFileCategorySchema>;

export const gameFiles = sqliteTable(
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
    // True once the user picked the category by hand; a library scan then keeps it
    // instead of re-deriving it from the folder or file name.
    categoryOverridden: integer("category_overridden", { mode: "boolean" })
      .notNull()
      .default(false),
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [
    index("game_files_game_id_idx").on(t.gameId),
    index("game_files_download_id_idx").on(t.downloadId),
  ]
);

export const insertGameFileSchema = createInsertSchema(gameFiles, {
  category: gameFileCategorySchema,
}).omit({
  id: true,
  // Only set through PATCH /api/games/:gameId/files/category.
  categoryOverridden: true,
  createdAt: true,
});

export type GameFile = typeof gameFiles.$inferSelect;
export type InsertGameFile = (typeof insertGameFileSchema)["_output"];

// Additional folders scanned for games already present on disk outside the
// configured library root (e.g. an older library, a secondary drive). Purely
// a discovery source — importing still goes through the normal library root.
export const rootFolders = sqliteTable("root_folders", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  name: text("name"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // Opt-in, off by default: whether Questarr's normal "delete game + files"
  // flow is allowed to remove files under this folder. Discovery on its own
  // never touches disk; this only affects the explicit delete flow, and only
  // for games whose libraryPath resolves inside this specific folder.
  allowDelete: integer("allow_delete", { mode: "boolean" }).notNull().default(false),
  accessible: integer("accessible", { mode: "boolean" }),
  diskFreeBytes: integer("disk_free_bytes"),
  diskTotalBytes: integer("disk_total_bytes"),
  lastScannedAt: integer("last_scanned_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

export const insertRootFolderSchema = createInsertSchema(rootFolders, {
  path: (schema) => schema.trim().min(1, "Path is required"),
  name: (schema) => schema.trim().max(200).optional(),
}).omit({
  id: true,
  accessible: true,
  diskFreeBytes: true,
  diskTotalBytes: true,
  lastScannedAt: true,
  createdAt: true,
});

export const updateRootFolderSchema = z.object({
  path: z.string().trim().min(1).optional(),
  name: z.string().trim().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
  allowDelete: z.boolean().optional(),
});

// Folders the user told the library scan to skip for good (e.g. Proton builds
// next to games in a Steam folder). Matched by folder name within a root
// folder, so they stay ignored across rescans and path edits of the root.
export const libraryScanIgnored = sqliteTable(
  "library_scan_ignored",
  {
    id: text("id").primaryKey(),
    rootFolderId: text("root_folder_id")
      .notNull()
      .references(() => rootFolders.id, { onDelete: "cascade" }),
    folderName: text("folder_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [uniqueIndex("library_scan_ignored_root_name_idx").on(t.rootFolderId, t.folderName)]
);

export type LibraryScanIgnored = typeof libraryScanIgnored.$inferSelect;

export type RootFolder = typeof rootFolders.$inferSelect;
export type InsertRootFolder = (typeof insertRootFolderSchema)["_output"];
export type UpdateRootFolder = z.infer<typeof updateRootFolderSchema>;

// A file discovered by scanning a game's library folder on disk, as returned by
// GET /api/games/:gameId/files. Distinct from GameFile (a persisted game_files row):
// this reflects the live filesystem scan, not an imported/tracked file. The scan only
// walks into subdirectories to find files within them — it never lists a directory
// itself as an entry.
export interface ScannedGameFile {
  name: string;
  path: string;
  category: GameFileCategory;
  size: number;
}

// Response contract for GET/PUT /api/downloaders/debug-logging, shared so the
// client can validate the payload at runtime instead of trusting a local
// TypeScript annotation.
export const downloaderDebugLoggingResponseSchema = z.object({
  enabled: z.boolean(),
});
export type DownloaderDebugLoggingResponse = z.infer<typeof downloaderDebugLoggingResponseSchema>;

// ── Integration API keys ─────────────────────────────────────────────────────
// Long-lived credentials for machine clients that cannot run the interactive
// login flow (the Playnite extension, scripts, other self-hosted tools). Only a
// SHA-256 hash of the key is stored, so a database leak never yields a usable
// credential; the raw key is shown to the user once, at creation.
// What a key may call. One scope per key; stored as plain text (no CHECK) and
// validated here, so adding a scope never needs a migration.
export const API_KEY_SCOPES = ["all", "library:write", "read", "requests"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const DEFAULT_API_KEY_SCOPE: ApiKeyScope = "all";

export const apiKeys = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    // Existing keys migrate to all with no expiry.
    scope: text("scope").$type<ApiKeyScope>().notNull().default("all"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
    index("api_keys_user_id_idx").on(t.userId),
  ]
);

export const insertApiKeySchema = createInsertSchema(apiKeys, {
  name: (schema) => schema.trim().min(1, "Name is required").max(100, "Name is too long"),
}).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export type ApiKey = typeof apiKeys.$inferSelect;

/** Input to storage.addApiKey: omitted scope/expiresAt mean "all routes, never expires". */
export type NewApiKeyInput = {
  userId: string;
  name: string;
  keyHash: string;
  prefix: string;
  scope?: ApiKeyScope;
  expiresAt?: Date | null;
};
export type InsertApiKey = (typeof insertApiKeySchema)["_output"];

// An API key as returned to the client: never includes the hash.
export type ApiKeyPublic = Omit<ApiKey, "keyHash">;

// Response contracts for the /api/api-keys endpoints, shared so the client
// can validate the payload at runtime instead of trusting a local TypeScript
// annotation. Timestamps come back as JSON (ISO strings or null), not the
// `Date` that ApiKey/ApiKeyPublic type as server-side.
export const apiKeyPublicResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  scope: z.enum(API_KEY_SCOPES),
  expiresAt: z.string().nullable(),
});
export type ApiKeyPublicResponse = z.infer<typeof apiKeyPublicResponseSchema>;

export const apiKeyListResponseSchema = z.array(apiKeyPublicResponseSchema);

// POST /api/api-keys additionally returns the raw key — shown to the user
// exactly once, since the server only ever persists its hash.
export const apiKeyCreatedResponseSchema = apiKeyPublicResponseSchema.extend({
  key: z.string(),
});
export type ApiKeyCreatedResponse = z.infer<typeof apiKeyCreatedResponseSchema>;

// ── External requests ledger ─────────────────────────────────────────────────
// Durable record of a request made by an external request app (SeerrNG). The
// app owns users, approvals and quotas; Questarr only remembers which of its
// own games answers which external request id, so a replayed POST is
// idempotent and status can be read back after either service restarts.
export const INTEGRATION_REQUEST_PROVIDERS = ["seerrng"] as const;
export type IntegrationRequestProvider = (typeof INTEGRATION_REQUEST_PROVIDERS)[number];
export const INTEGRATION_REQUEST_STATUSES = [
  "accepted",
  "searching",
  "failed",
  "cancelled",
] as const;
export type IntegrationRequestStatus = (typeof INTEGRATION_REQUEST_STATUSES)[number];
export const SEERRNG_OPERATING_SYSTEMS = ["windows", "linux", "macos"] as const;
export const SEERRNG_ARCHITECTURES = ["x64", "arm64", "x86", "universal"] as const;
export type SeerrngOperatingSystem = (typeof SEERRNG_OPERATING_SYSTEMS)[number];
export type SeerrngArchitecture = (typeof SEERRNG_ARCHITECTURES)[number];

export const integrationRequests = sqliteTable(
  "integration_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationRequestProvider>().notNull().default("seerrng"),
    externalRequestId: text("external_request_id").notNull(),
    // Exact IGDB identity supplied by the request app; null when it sent a title only.
    igdbId: integer("igdb_id"),
    // The game answering the request. Set null if the game is deleted, so the
    // request stays readable (and retryable) instead of vanishing.
    gameId: text("game_id").references(() => games.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    operatingSystem: text("operating_system").$type<SeerrngOperatingSystem>(),
    architecture: text("architecture").$type<SeerrngArchitecture>(),
    status: text("status").$type<IntegrationRequestStatus>().notNull().default("accepted"),
    errorMessage: text("error_message"),
    // JSON of the edition or add-ons the request app selected (contract v2.1); null for a plain game.
    selection: text("selection"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
      sql`(strftime('%s', 'now') * 1000)`
    ),
  },
  (t) => [
    uniqueIndex("integration_requests_user_provider_external_idx").on(
      t.userId,
      t.provider,
      t.externalRequestId
    ),
    index("integration_requests_game_id_idx").on(t.gameId),
    // One live request per game; a cancelled request keeps its gameId until a new one takes over.
    uniqueIndex("integration_requests_live_game_idx")
      .on(t.userId, t.provider, t.gameId)
      .where(sql`${t.gameId} is not null and ${t.status} <> 'cancelled'`),
  ]
);

export type IntegrationRequest = typeof integrationRequests.$inferSelect;

/** What a request asked for beyond the base game: a whole edition, or the missing add-ons. */
export type IntegrationRequestSelection =
  | { kind: "game-content"; mode: "edition"; editionId: number }
  | { kind: "game-content"; mode: "missing-selected"; addonIds: number[] };
export type NewIntegrationRequest = Pick<
  IntegrationRequest,
  "userId" | "externalRequestId" | "title"
> &
  Partial<
    Pick<
      IntegrationRequest,
      "provider" | "igdbId" | "gameId" | "operatingSystem" | "architecture" | "selection"
    >
  >;
export type IntegrationRequestUpdate = Partial<
  Pick<IntegrationRequest, "gameId" | "status" | "errorMessage" | "selection">
>;
