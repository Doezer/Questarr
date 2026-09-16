import { sql } from "drizzle-orm";
import * as pgSchema from "../../shared/schema.pg.js";
import { logger } from "../logger.js";
import type { AppDatabase, DatabaseConnection } from "./types.js";

/**
 * In-process Postgres, for tests only.
 *
 * PGlite is a real Postgres compiled to WebAssembly, so it exercises the actual
 * Postgres parser and planner -- jsonb casts, string_agg, ILIKE, bigint-as-string,
 * boolean vs 0, async transactions -- without requiring a server. That keeps the
 * default test loop as fast and infra-free as it was when SQLite was the only
 * backend.
 *
 * It is NOT a substitute for a real server: PGlite is single-connection, so it
 * cannot surface pool exhaustion, lock contention or deadlock ordering. CI runs
 * the same suites against a real Postgres for that.
 *
 * Selected with QUESTARR_DB_DRIVER=pglite. @electric-sql/pglite is a
 * devDependency and is imported dynamically so that production installs, where
 * devDependencies are pruned, never try to resolve it.
 */
export async function connectPglite(): Promise<DatabaseConnection> {
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);

  const dataDir = process.env.PGLITE_DATA_DIR;
  logger.info(`Initializing PGlite database (${dataDir ?? "in-memory"})`);

  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema: pgSchema });

  return {
    db: db as unknown as AppDatabase,
    pool: client as unknown as import("better-sqlite3").Database,
    ping: async () => {
      await db.execute(sql`SELECT 1`);
    },
    close: async () => {
      await client.close();
    },
  };
}
