import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "./logger.js";
import { db, pool } from "./db.js";
import { sql } from "drizzle-orm";

/**
 * Run database migrations from the migrations folder
 */
export async function runMigrations(): Promise<void> {
  try {
    logger.info("Running database migrations...");

    // First, check if tables already exist (migrated from push)
    logger.info("Checking for existing tables (downloaders)...");
    const downloadersTable = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'downloaders'
      );
    `);

    const hasExistingTables = downloadersTable.rows[0]?.exists;
    logger.info(`Existing tables detected: ${hasExistingTables}`);

    // Check if migrations table exists
    logger.info("Checking for __drizzle_migrations table...");
    const drizzleMigrationsTable = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
      );
    `);

    const hasMigrationsTable = drizzleMigrationsTable.rows[0]?.exists;
    logger.info(`Migrations table exists: ${hasMigrationsTable}`);

    // If tables exist but no proper migration tracking, initialize it
    if (hasExistingTables) {
      if (!hasMigrationsTable) {
        logger.info("Creating migrations tracking table for existing database...");
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL UNIQUE,
            created_at bigint
          );
        `);
      }

      // Check which migrations are already applied
      const appliedMigrations = await db.execute(sql`
        SELECT hash FROM "__drizzle_migrations"
      `);
      const appliedHashes = new Set(appliedMigrations.rows.map((r) => r.hash));
      logger.info(`Applied migrations: ${Array.from(appliedHashes).join(", ") || "none"}`);

      // Mark initial migration as applied if not already
      if (!appliedHashes.has("0000_complex_synch")) {
        logger.info("Marking initial migration as applied for existing database...");
        await db.execute(sql`
          INSERT INTO "__drizzle_migrations" (hash, created_at)
          VALUES ('0000_complex_synch', ${Date.now()})
          ON CONFLICT (hash) DO NOTHING;
        `);
        appliedHashes.add("0000_complex_synch");
      }

      // Check if we need to mark the second migration (game_torrents -> game_downloads rename)
      const gameTorrentsCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'game_torrents'
        );
      `);
      const hasGameTorrents = gameTorrentsCheck.rows[0]?.exists;

      const gameDownloadsCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'game_downloads'
        );
      `);
      const hasGameDownloads = gameDownloadsCheck.rows[0]?.exists;

      // Only mark migration 0001 as applied if new table exists and old one doesn't (rename completed)
      if (hasGameDownloads && !hasGameTorrents && !appliedHashes.has("0001_adorable_silvermane")) {
        logger.info("Table rename already completed - marking migration 0001 as applied...");
        await db.execute(sql`
          INSERT INTO "__drizzle_migrations" (hash, created_at)
          VALUES ('0001_adorable_silvermane', ${Date.now()})
          ON CONFLICT (hash) DO NOTHING;
        `);
      } else if (hasGameTorrents) {
        logger.info(
          "Old game_torrents table detected - migration 0001 will rename it to game_downloads"
        );
      }

      logger.info("Migration tracking initialized for existing database");
    }

    // Run migrations (will skip already-applied ones)
    logger.info("Checking for pending migrations...");
    let migrationsApplied = false;
    try {
      const path = await import("path");
      const fs = await import("fs");
      const migrationsFolder = path.resolve(process.cwd(), "migrations");

      logger.info(`Using migrations folder: ${migrationsFolder}`);

      if (!fs.existsSync(migrationsFolder)) {
        throw new Error(`Migrations folder not found at: ${migrationsFolder}`);
      }

      await migrate(db, { migrationsFolder });
      logger.info("Database migrations completed successfully");
      migrationsApplied = true;
    } catch (migrationError: unknown) {
      // Only ignore specific safe errors
      const errorCode = (migrationError as { cause?: { code?: string }; message?: string })?.cause
        ?.code;
      if (errorCode === "42P07") {
        // Table already exists - likely already migrated via db:push
        logger.info("Database schema is already current (tables exist)");
      } else if (errorCode === "42710") {
        // Object already exists (index, constraint, etc.)
        logger.info("Database schema is already current (objects exist)");
      } else {
        // Unexpected error - fail loudly
        logger.error({ err: migrationError, errorCode }, "Unexpected migration error");
        throw migrationError;
      }
      // If we reach here, migrations were not applied but schema is current
      migrationsApplied = false;
    }

    if (migrationsApplied) {
      logger.info("✓ Database migrations check completed - schema is ready");
    } else {
      logger.info("✓ Database schema is already current - no migrations applied");
    }
  } catch (error) {
    logger.error({ err: error }, "Database migration failed");
    throw error;
  }
}

/**
 * Verify database connection and tables exist
 */
export async function ensureDatabase(): Promise<void> {
  const maxRetries = 10;
  const retryDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Checking database connection (attempt ${attempt}/${maxRetries})...`);

      // Test connection
      await db.execute(sql`SELECT 1`);
      logger.info("Database connection successful");

      // Run migrations to ensure schema is up-to-date
      await runMigrations();
      return; // Success
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorCode = (error as { code?: string })?.code;

      if (isLastAttempt) {
        logger.error({ err: error }, "Database check failed after multiple attempts");
        throw new Error(
          `Failed to connect to database after ${maxRetries} attempts. Last error: ${errorMessage} (${errorCode})`
        );
      }

      logger.warn(
        { err: error },
        `Database connection failed (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelay}ms...`
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

/**
 * Gracefully close database connection
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info("Database connection closed");
}
