/**
 * Compile-time proof that the SQLite and Postgres schemas are interchangeable.
 *
 * shared/schema.ts is the single source of types for the codebase;
 * shared/schema.pg.ts is a runtime-only mirror. server/db/tables.ts casts
 * between the two, and that cast is sound only while every table infers the
 * same row and insert shapes on both sides.
 *
 * These assertions are checked by `npm run check` (tsc) and cost nothing at
 * runtime. Adding a column to one schema and not the other breaks the build
 * here, which is the point -- parallel schema files drift silently otherwise.
 *
 * Column NAMES, nullability and defaults are not visible to these type-level
 * checks; shared/__tests__/schema-parity.test.ts covers that at runtime.
 *
 * The assertions are exported purely to satisfy noUnusedLocals: each one exists
 * to be checked by the compiler, never to be referenced.
 */
import type * as sqliteSchema from "./schema.js";
import type * as pgSchema from "./schema.pg.js";

/**
 * Invariant type equality. The two-function-signature trick is the standard way
 * to get TypeScript to compare types nominally rather than with assignability,
 * so a widened or optional field is caught instead of being silently accepted.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Expect<T extends true> = T;

export type _SelectUsers = Expect<
  Equal<typeof sqliteSchema.users.$inferSelect, typeof pgSchema.users.$inferSelect>
>;
export type _InsertUsers = Expect<
  Equal<typeof sqliteSchema.users.$inferInsert, typeof pgSchema.users.$inferInsert>
>;
export type _SelectPathMappings = Expect<
  Equal<typeof sqliteSchema.pathMappings.$inferSelect, typeof pgSchema.pathMappings.$inferSelect>
>;
export type _InsertPathMappings = Expect<
  Equal<typeof sqliteSchema.pathMappings.$inferInsert, typeof pgSchema.pathMappings.$inferInsert>
>;
export type _SelectPlatformMappings = Expect<
  Equal<
    typeof sqliteSchema.platformMappings.$inferSelect,
    typeof pgSchema.platformMappings.$inferSelect
  >
>;
export type _InsertPlatformMappings = Expect<
  Equal<
    typeof sqliteSchema.platformMappings.$inferInsert,
    typeof pgSchema.platformMappings.$inferInsert
  >
>;
export type _SelectUserSettings = Expect<
  Equal<typeof sqliteSchema.userSettings.$inferSelect, typeof pgSchema.userSettings.$inferSelect>
>;
export type _InsertUserSettings = Expect<
  Equal<typeof sqliteSchema.userSettings.$inferInsert, typeof pgSchema.userSettings.$inferInsert>
>;
export type _SelectSystemConfig = Expect<
  Equal<typeof sqliteSchema.systemConfig.$inferSelect, typeof pgSchema.systemConfig.$inferSelect>
>;
export type _InsertSystemConfig = Expect<
  Equal<typeof sqliteSchema.systemConfig.$inferInsert, typeof pgSchema.systemConfig.$inferInsert>
>;
export type _SelectGames = Expect<
  Equal<typeof sqliteSchema.games.$inferSelect, typeof pgSchema.games.$inferSelect>
>;
export type _InsertGames = Expect<
  Equal<typeof sqliteSchema.games.$inferInsert, typeof pgSchema.games.$inferInsert>
>;
export type _SelectIndexers = Expect<
  Equal<typeof sqliteSchema.indexers.$inferSelect, typeof pgSchema.indexers.$inferSelect>
>;
export type _InsertIndexers = Expect<
  Equal<typeof sqliteSchema.indexers.$inferInsert, typeof pgSchema.indexers.$inferInsert>
>;
export type _SelectDownloaders = Expect<
  Equal<typeof sqliteSchema.downloaders.$inferSelect, typeof pgSchema.downloaders.$inferSelect>
>;
export type _InsertDownloaders = Expect<
  Equal<typeof sqliteSchema.downloaders.$inferInsert, typeof pgSchema.downloaders.$inferInsert>
>;
export type _SelectGameDownloads = Expect<
  Equal<typeof sqliteSchema.gameDownloads.$inferSelect, typeof pgSchema.gameDownloads.$inferSelect>
>;
export type _InsertGameDownloads = Expect<
  Equal<typeof sqliteSchema.gameDownloads.$inferInsert, typeof pgSchema.gameDownloads.$inferInsert>
>;
export type _SelectXrelNotifiedReleases = Expect<
  Equal<
    typeof sqliteSchema.xrelNotifiedReleases.$inferSelect,
    typeof pgSchema.xrelNotifiedReleases.$inferSelect
  >
>;
export type _InsertXrelNotifiedReleases = Expect<
  Equal<
    typeof sqliteSchema.xrelNotifiedReleases.$inferInsert,
    typeof pgSchema.xrelNotifiedReleases.$inferInsert
  >
>;
export type _SelectReleaseBlacklist = Expect<
  Equal<
    typeof sqliteSchema.releaseBlacklist.$inferSelect,
    typeof pgSchema.releaseBlacklist.$inferSelect
  >
>;
export type _InsertReleaseBlacklist = Expect<
  Equal<
    typeof sqliteSchema.releaseBlacklist.$inferInsert,
    typeof pgSchema.releaseBlacklist.$inferInsert
  >
>;
export type _SelectNotifications = Expect<
  Equal<typeof sqliteSchema.notifications.$inferSelect, typeof pgSchema.notifications.$inferSelect>
>;
export type _InsertNotifications = Expect<
  Equal<typeof sqliteSchema.notifications.$inferInsert, typeof pgSchema.notifications.$inferInsert>
>;
export type _SelectRssFeeds = Expect<
  Equal<typeof sqliteSchema.rssFeeds.$inferSelect, typeof pgSchema.rssFeeds.$inferSelect>
>;
export type _InsertRssFeeds = Expect<
  Equal<typeof sqliteSchema.rssFeeds.$inferInsert, typeof pgSchema.rssFeeds.$inferInsert>
>;
export type _SelectRssFeedItems = Expect<
  Equal<typeof sqliteSchema.rssFeedItems.$inferSelect, typeof pgSchema.rssFeedItems.$inferSelect>
>;
export type _InsertRssFeedItems = Expect<
  Equal<typeof sqliteSchema.rssFeedItems.$inferInsert, typeof pgSchema.rssFeedItems.$inferInsert>
>;
export type _SelectImportTasks = Expect<
  Equal<typeof sqliteSchema.importTasks.$inferSelect, typeof pgSchema.importTasks.$inferSelect>
>;
export type _InsertImportTasks = Expect<
  Equal<typeof sqliteSchema.importTasks.$inferInsert, typeof pgSchema.importTasks.$inferInsert>
>;
export type _SelectImportTaskItems = Expect<
  Equal<
    typeof sqliteSchema.importTaskItems.$inferSelect,
    typeof pgSchema.importTaskItems.$inferSelect
  >
>;
export type _InsertImportTaskItems = Expect<
  Equal<
    typeof sqliteSchema.importTaskItems.$inferInsert,
    typeof pgSchema.importTaskItems.$inferInsert
  >
>;
export type _SelectGameFiles = Expect<
  Equal<typeof sqliteSchema.gameFiles.$inferSelect, typeof pgSchema.gameFiles.$inferSelect>
>;
export type _InsertGameFiles = Expect<
  Equal<typeof sqliteSchema.gameFiles.$inferInsert, typeof pgSchema.gameFiles.$inferInsert>
>;
export type _SelectRootFolders = Expect<
  Equal<typeof sqliteSchema.rootFolders.$inferSelect, typeof pgSchema.rootFolders.$inferSelect>
>;
export type _InsertRootFolders = Expect<
  Equal<typeof sqliteSchema.rootFolders.$inferInsert, typeof pgSchema.rootFolders.$inferInsert>
>;
export type _SelectApiKeys = Expect<
  Equal<typeof sqliteSchema.apiKeys.$inferSelect, typeof pgSchema.apiKeys.$inferSelect>
>;
export type _InsertApiKeys = Expect<
  Equal<typeof sqliteSchema.apiKeys.$inferInsert, typeof pgSchema.apiKeys.$inferInsert>
>;
