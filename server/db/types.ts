import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "../../shared/schema.js";

/**
 * The database handle as the rest of the application sees it.
 *
 * Every caller types against the SQLite schema even when Postgres is the active
 * backend. That is sound because the two schemas are proven interchangeable --
 * see shared/schema-parity.ts (compile time) and
 * shared/__tests__/schema-parity.test.ts (runtime) -- and because the dialects
 * are never mixed: the Postgres backend always gets Postgres tables from
 * server/db/tables.ts, and SQLite always gets SQLite tables.
 */
export type AppDatabase = BetterSQLite3Database<typeof sqliteSchema>;

/** Which backend is active. SQLite is the default. */
export type Dialect = "sqlite" | "postgres";

/** What a backend module must provide to server/db.ts. */
export interface DatabaseConnection {
  db: AppDatabase;
  /**
   * The underlying driver handle (better-sqlite3 Database or pg.Pool).
   * Declared as the SQLite handle for the same reason `db` is -- only
   * SQLite-pinned tests reach for it.
   */
  pool: import("better-sqlite3").Database;
  /** Round-trip the connection; throws if the database is unreachable. */
  ping: () => Promise<void>;
  /** Release driver resources. A no-op on SQLite. */
  close: () => Promise<void>;
}
