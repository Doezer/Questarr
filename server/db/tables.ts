import * as sqliteSchema from "../../shared/schema.js";
import * as pgSchema from "../../shared/schema.pg.js";
import { dialect } from "../db.js";

/**
 * The table objects for the active dialect.
 *
 * Import table VALUES from here, never from shared/schema.ts directly -- a query
 * built against the SQLite table objects would emit SQLite-shaped SQL even when
 * Postgres is the active backend. Import TYPES from shared/schema.ts as usual;
 * this module deliberately exports no types.
 *
 * Runtime: the dialects are never mixed -- Postgres always gets Postgres tables,
 * SQLite always SQLite. Types: the whole application compiles against the SQLite
 * schema. The single cast below is sound only because shared/schema-parity.ts
 * (compile time) and shared/__tests__/schema-parity.test.ts (runtime) prove the
 * two schemas are structurally identical. Do not remove those guards.
 */
const active = dialect === "postgres" ? (pgSchema as unknown as typeof sqliteSchema) : sqliteSchema;

export const {
  apiKeys,
  downloaders,
  gameDownloads,
  gameFiles,
  games,
  importTaskItems,
  importTasks,
  indexers,
  notifications,
  pathMappings,
  platformMappings,
  releaseBlacklist,
  rootFolders,
  rssFeedItems,
  rssFeeds,
  systemConfig,
  userSettings,
  users,
  xrelNotifiedReleases,
} = active;
