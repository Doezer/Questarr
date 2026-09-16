import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "../db.js";
import { logger } from "../logger.js";

/**
 * Postgres migration runner.
 *
 * Thin on purpose. Drizzle's official migrator already applies migrations
 * transactionally under an advisory lock and tracks them by hash, so there is
 * nothing for us to hand-roll.
 *
 * Note what is deliberately absent: the schema-drift repair in
 * server/db/migrate-sqlite.ts is not ported here, and should not be. That code
 * exists to patch installs that ran an intermediate build before a migration
 * file existed -- a situation with no Postgres equivalent, because Postgres
 * support shipped with a single baseline migration and every Postgres install
 * is therefore greenfield.
 */
export async function runPgMigrations(): Promise<void> {
  logger.info("Running Postgres migrations...");
  await migrate(db as unknown as NodePgDatabase, { migrationsFolder: "migrations-pg" });
  logger.info("Postgres migrations completed successfully");
}
