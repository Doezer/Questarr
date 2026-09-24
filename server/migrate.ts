import { logger } from "./logger.js";
import { dialect, pingDatabase } from "./db.js";
import { runSqliteMigrations, repairSqliteSchemaForV1_3_0 } from "./db/migrate-sqlite.js";
import { runPgMigrations } from "./db/migrate-pg.js";

/**
 * Apply pending migrations for whichever backend is active.
 *
 * The two dialects keep separate migration histories: migrations/ for SQLite
 * (34 files, most encoding SQLite's table-rebuild workaround for its missing
 * ALTER COLUMN) and migrations-pg/ for Postgres (one generated baseline).
 */
export async function runMigrations(): Promise<void> {
  if (dialect === "postgres") {
    await runPgMigrations();
    return;
  }
  await runSqliteMigrations();
}

export async function ensureDatabase(): Promise<void> {
  try {
    logger.info(`Checking database connection...`);

    await pingDatabase();
    logger.info("Database connection successful");

    await runMigrations();

    // Repairing schema drift only applies to SQLite; see server/db/migrate-pg.ts.
    if (dialect !== "postgres") {
      await repairSqliteSchemaForV1_3_0();
    }
  } catch (error) {
    logger.error({ err: error }, "Database check failed");
    throw error;
  }
}
