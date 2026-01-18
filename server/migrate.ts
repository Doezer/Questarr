import { logger } from "./logger.js";
import { db } from "./db.js";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";

/**
 * Run database migrations from the migrations folder
 */
export async function runMigrations(): Promise<void> {
  try {
    logger.info("Running database migrations...");
    const migrationsFolder = path.resolve(process.cwd(), "migrations");

    // Use Drizzle's built-in migrator for SQLite
    migrate(db, { migrationsFolder });

    logger.info("Database migrations completed successfully");
  } catch (error) {
    logger.error({ err: error }, "Database migration failed");
    throw error;
  }
}

/**
 * Verify database connection and tables exist
 */
export async function ensureDatabase(): Promise<void> {
  try {
    logger.info(`Checking database connection...`);

    // Test connection
    const result = db.get(sql`SELECT 1`);
    if (!result) {
        throw new Error("Database connection test failed");
    }
    logger.info("Database connection successful");

    // Run migrations to ensure schema is up-to-date
    await runMigrations();
  } catch (error) {
    logger.error({ err: error }, "Database check failed");
    throw error;
  }
}

/**
 * Gracefully close database connection
 */
export async function closeDatabase(): Promise<void> {
    // Better-sqlite3 handles closing automatically on process exit mostly,
    // but explicit closing if needed would be on the sqlite instance which is not exported from db.ts currently.
    // Given the architecture, we can rely on process exit.
    logger.info("Database connection closed (noop for sqlite)");
}
