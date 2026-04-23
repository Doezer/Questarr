import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  notifyMultipleDownloads: integer("notify_multiple_downloads", { mode: "boolean" })
    .notNull()
    .default(true),
  notifyUpdates: integer("notify_updates", { mode: "boolean" }).notNull().default(true),
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
  preferredReleaseGroups: text("preferred_release_groups"),
  filterByPreferredGroups: integer("filter_by_preferred_groups", { mode: "boolean" })
    .notNull()
    .default(false),
  preferredPlatform: text("preferred_platform"),
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
  // RomM Settings
  rommEnabled: integer("romm_enabled", { mode: "boolean" }).notNull().default(false),
  rommLibraryRoot: text("romm_library_root").notNull().default("/data"),
  rommPlatformRoutingMode: text("romm_platform_routing_mode").notNull().default("slug-subfolder"),
  rommPlatformBindings: text("romm_platform_bindings", { mode: "json" })
    .$type<Record<string, string>>()
    .default({}),
  rommPlatformAliases: text("romm_platform_aliases", { mode: "json" })
    .$type<Record<string, string>>()
    .default({}),
  rommMoveMode: text("romm_move_mode").notNull().default("move"),
  rommConflictPolicy: text("romm_conflict_policy").notNull().default("rename"),
  rommFolderNamingTemplate: text("romm_folder_naming_template").notNull().default("{title}"),
  rommSingleFilePlacement: text("romm_single_file_placement").notNull().default("root"),
  rommMultiFilePlacement: text("romm_multi_file_placement").notNull().default("subfolder"),
  rommIncludeRegionLanguageTags: integer("romm_include_region_language_tags", { mode: "boolean" })
    .notNull()
    .default(false),
  rommAllowedSlugs: text("romm_allowed_slugs", { mode: "json" }).$type<string[] | null>(),
  rommAllowAbsoluteBindings: integer("romm_allow_absolute_bindings", { mode: "boolean" })
    .notNull()
    .default(false),
  rommBindingMissingBehavior: text("romm_binding_missing_behavior").notNull().default("fallback"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
});

// ... existing code ...

export const insertPathMappingSchema = createInsertSchema(pathMappings).omit({
  id: true,
});

export const insertPlatformMappingSchema = createInsertSchema(platformMappings).omit({
  id: true,
});

export type PathMapping = typeof pathMappings.$inferSelect;
export type InsertPathMapping = (typeof insertPathMappingSchema)["_output"];

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
}

export const IMPORT_TRANSFER_MODES = ["move", "copy", "hardlink"] as const;
export const ROMM_PLATFORM_ROUTING_MODES = ["slug-subfolder", "binding-map"] as const;
export const ROMM_MOVE_MODES = ["copy", "move", "hardlink", "symlink"] as const;
export const ROMM_CONFLICT_POLICIES = ["skip", "overwrite", "rename", "fail"] as const;
export const ROMM_SINGLE_FILE_PLACEMENTS = ["root", "subfolder"] as const;
export const ROMM_BINDING_MISSING_BEHAVIORS = ["fallback", "error"] as const;
export const ROMM_MULTI_FILE_PLACEMENT = "subfolder" as const;

export type ImportTransferMode = (typeof IMPORT_TRANSFER_MODES)[number];
export type RomMPlatformRoutingMode = (typeof ROMM_PLATFORM_ROUTING_MODES)[number];
export type RomMMoveMode = (typeof ROMM_MOVE_MODES)[number];
export type RomMConflictPolicy = (typeof ROMM_CONFLICT_POLICIES)[number];
export type RomMSingleFilePlacement = (typeof ROMM_SINGLE_FILE_PLACEMENTS)[number];
export type RomMMultiFilePlacement = typeof ROMM_MULTI_FILE_PLACEMENT;
export type RomMBindingMissingBehavior = (typeof ROMM_BINDING_MISSING_BEHAVIORS)[number];

export const importTransferModeSchema = z.enum(IMPORT_TRANSFER_MODES);
export const rommPlatformRoutingModeSchema = z.enum(ROMM_PLATFORM_ROUTING_MODES);
export const rommMoveModeSchema = z.enum(ROMM_MOVE_MODES);
export const rommConflictPolicySchema = z.enum(ROMM_CONFLICT_POLICIES);
export const rommSingleFilePlacementSchema = z.enum(ROMM_SINGLE_FILE_PLACEMENTS);
export const rommBindingMissingBehaviorSchema = z.enum(ROMM_BINDING_MISSING_BEHAVIORS);

const rommConfigBaseSchema = z.object({
  libraryRoot: z.string().min(1),
  platformRoutingMode: rommPlatformRoutingModeSchema,
  platformBindings: z.record(z.string(), z.string()),
  moveMode: rommMoveModeSchema,
  conflictPolicy: rommConflictPolicySchema,
  folderNamingTemplate: z.string().min(1),
  singleFilePlacement: rommSingleFilePlacementSchema,
  multiFilePlacement: z.literal(ROMM_MULTI_FILE_PLACEMENT),
  includeRegionLanguageTags: z.boolean(),
  allowedSlugs: z.array(z.string().trim().min(1)).optional(),
  bindingMissingBehavior: rommBindingMissingBehaviorSchema,
});

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
});

export const rommConfigSchema = rommConfigBaseSchema.extend({
  enabled: z.boolean(),
});

export type RomMConfig = z.infer<typeof rommConfigSchema>;

export interface RomMConfigInput {
  enabled: boolean;
  libraryRoot: string;
  platformRoutingMode: RomMPlatformRoutingMode;
  platformBindings: Record<string, string>;
  moveMode: RomMMoveMode;
  conflictPolicy: RomMConflictPolicy;
  folderNamingTemplate: string;
  singleFilePlacement: RomMSingleFilePlacement;
  multiFilePlacement: RomMMultiFilePlacement;
  includeRegionLanguageTags: boolean;
  allowedSlugs?: string[];
  bindingMissingBehavior: RomMBindingMissingBehavior;
}

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
  genres: text("genres", { mode: "json" }).$type<string[]>(),
  publishers: text("publishers", { mode: "json" }).$type<string[]>(),
  developers: text("developers", { mode: "json" }).$type<string[]>(),
  screenshots: text("screenshots", { mode: "json" }).$type<string[]>(),
  source: text("source").default("manual"), // "manual" | "steam" | "api"
  igdbWebsites: text("igdb_websites", { mode: "json" }).$type<
    Array<{ category: number; url: string }>
  >(),
  aggregatedRating: real("aggregated_rating"),
  status: text("status").notNull().default("wanted"), // Enum validation handled by Zod
  originalReleaseDate: text("original_release_date"),
  releaseStatus: text("release_status").default("upcoming"), // Enum validation handled by Zod
  earlyAccess: integer("early_access", { mode: "boolean" }).notNull().default(false),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  userRating: real("user_rating"),
  searchResultsAvailable: integer("search_results_available", { mode: "boolean" })
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
export const gameDownloads = sqliteTable("game_downloads", {
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
  fileSize: integer("file_size"), // bytes, stored at completion when available
  addedAt: integer("added_at", { mode: "timestamp_ms" }).default(
    sql`(strftime('%s', 'now') * 1000)`
  ),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

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
}).omit({
  id: true,
  addedAt: true,
  completedAt: true,
});

export const updateGameStatusSchema = z.object({
  status: z.enum(["wanted", "owned", "completed", "downloading"]),
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

export const insertIndexerSchema = createInsertSchema(indexers, {
  name: (schema) => schema.trim(),
  url: (schema) => schema.trim(),
  apiKey: (schema) => schema.trim(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Trim helper for nullable/optional string fields in Zod schemas.
const trimIfString = <T>(v: T): T => (typeof v === "string" ? (v.trim() as T) : v);

export const insertDownloaderSchema = createInsertSchema(downloaders, {
  name: (schema) => schema.trim(),
  url: (schema) => schema.trim(),
  username: (schema) => schema.transform(trimIfString),
  password: (schema) => schema.transform(trimIfString),
  urlPath: (schema) => schema.transform(trimIfString),
  downloadPath: (schema) => schema.transform(trimIfString),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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
  category: z.enum(["main", "update", "dlc", "extra"]),
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
  sortBy: z.enum(["seeders", "date", "size"]).default("seeders"),
  visibleCategories: z
    .array(z.enum(["main", "update", "dlc", "extra"]))
    .default(["main", "update", "dlc", "extra"]),
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

  if (
    value.rommPlatformRoutingMode &&
    !ROMM_PLATFORM_ROUTING_MODES.includes(value.rommPlatformRoutingMode as RomMPlatformRoutingMode)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rommPlatformRoutingMode"],
      message: "Invalid RomM platform routing mode",
    });
  }

  if (value.rommMoveMode && !ROMM_MOVE_MODES.includes(value.rommMoveMode as RomMMoveMode)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rommMoveMode"],
      message: "Invalid RomM move mode",
    });
  }

  if (
    value.rommConflictPolicy &&
    !ROMM_CONFLICT_POLICIES.includes(value.rommConflictPolicy as RomMConflictPolicy)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rommConflictPolicy"],
      message: "Invalid RomM conflict policy",
    });
  }

  if (
    value.rommSingleFilePlacement &&
    !ROMM_SINGLE_FILE_PLACEMENTS.includes(value.rommSingleFilePlacement as RomMSingleFilePlacement)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rommSingleFilePlacement"],
      message: "Invalid RomM single-file placement",
    });
  }

  if (value.rommMultiFilePlacement && value.rommMultiFilePlacement !== ROMM_MULTI_FILE_PLACEMENT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rommMultiFilePlacement"],
      message: "Invalid RomM multi-file placement",
    });
  }

  if (
    value.rommBindingMissingBehavior &&
    !ROMM_BINDING_MISSING_BEHAVIORS.includes(
      value.rommBindingMissingBehavior as RomMBindingMissingBehavior
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rommBindingMissingBehavior"],
      message: "Invalid RomM binding missing behavior",
    });
  }
}

export const insertReleaseBlacklistSchema = createInsertSchema(releaseBlacklist).omit({
  id: true,
  createdAt: true,
});
export type InsertReleaseBlacklist = (typeof insertReleaseBlacklistSchema)["_output"];
export type ReleaseBlacklist = typeof releaseBlacklist.$inferSelect;

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
  .superRefine(validateUserSettingsEnums);

export const updatePasswordSchema = z
  .object({
    currentPassword: z.string().trim().min(1, "Current password is required"),
    newPassword: z.string().trim().min(6, "New password must be at least 6 characters"),
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

export type UpdateGameStatus = (typeof updateGameStatusSchema)["_output"];

export type Indexer = typeof indexers.$inferSelect;
export type InsertIndexer = (typeof insertIndexerSchema)["_output"];

export type Downloader = typeof downloaders.$inferSelect;
export type InsertDownloader = (typeof insertDownloaderSchema)["_output"];

export type GameDownload = typeof gameDownloads.$inferSelect;
export type InsertGameDownload = (typeof insertGameDownloadSchema)["_output"];

export type XrelNotifiedRelease = typeof xrelNotifiedReleases.$inferSelect;
export type InsertXrelNotifiedRelease = (typeof insertXrelNotifiedReleaseSchema)["_output"];

// Legacy type names for backward compatibility
export type GameDownloadLegacy = GameDownload;
export type InsertGameDownloadLegacy = InsertGameDownload;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = (typeof insertNotificationSchema)["_output"];

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = (typeof insertUserSettingsSchema)["_output"];
export type UpdateUserSettings = (typeof updateUserSettingsSchema)["_output"];

export interface DownloadSummary {
  topStatus: "downloading" | "paused" | "failed" | "completed";
  count: number;
  downloadTypes: ("torrent" | "usenet")[];
  hasUpdateDownload: boolean;
}

// Application configuration type
export interface Config {
  igdb: {
    configured: boolean;
    source?: "env" | "database";
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
  seeders?: number;
  leechers?: number;
  lastAnnounce?: string;
  nextAnnounce?: string;
  error?: string;
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
  downloadSpeed?: number; // bytes per second
  uploadSpeed?: number; // bytes per second (torrents only)
  eta?: number; // seconds
  size?: number; // total bytes
  downloaded?: number; // bytes downloaded
  // Protocol-specific fields
  seeders?: number;
  leechers?: number;
  ratio?: number;
  // Usenet-specific fields
  repairStatus?: "good" | "repairing" | "failed"; // Par2 repair status
  unpackStatus?: "unpacking" | "completed" | "failed"; // Extract/unpack status
  age?: number; // Age in days
  // Common fields
  error?: string;
  category?: string;
  // Questarr tracking fields
  trackedByQuestarr?: boolean; // True if the download was initiated through Questarr
  downloaderCategory?: string; // The category configured on the downloader (for display purposes)
}

export interface DownloadDetails extends DownloadStatus {
  hash?: string;
  addedDate?: string;
  completedDate?: string;
  downloadDir?: string;
  comment?: string;
  creator?: string;
  files: DownloadFile[];
  trackers: DownloadTracker[];
  totalPeers?: number;
  connectedPeers?: number;
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
