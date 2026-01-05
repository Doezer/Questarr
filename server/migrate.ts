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
      await migrate(db, { migrationsFolder: "./migrations" });
      logger.info("Database migrations completed successfully");
      migrationsApplied = true;
    } catch (migrationError: unknown) {
      // Only ignore specific safe errors
      const errorCode = (migrationError as { cause?: { code?: string }; message?: string })?.cause
        ?.code;
      if (errorCode === "42P07") {
        // Table already exists - likely already migrated via db:push
        logger.info("Database schema is already current (tables exist)");
        migrationsApplied = true; // Mark as successful
      } else if (errorCode === "42710") {
        // Object already exists (index, constraint, etc.)
        logger.info("Database schema is already current (objects exist)");
        migrationsApplied = true; // Mark as successful
      } else {
        // Unexpected error - fail loudly
        logger.error({ error: migrationError, errorCode }, "Unexpected migration error");
        throw migrationError;
      }
    }

    if (migrationsApplied) {
      logger.info("✓ Database migrations check completed - schema is ready");
    }
  } catch (error) {
    logger.error({ error }, "Database migration failed");
    throw error;
  }
}

/**
 * Verify database connection and tables exist
 */
export async function ensureDatabase(): Promise<void> {
  try {
    logger.info("Checking database connection...");

    // Test connection
    await db.execute(sql`SELECT 1`);
    logger.info("Database connection successful");

    // Run migrations to ensure schema is up-to-date
    await runMigrations();
  } catch (error) {
    logger.error({ error }, "Database check failed");
    throw new Error("Failed to connect to database. Please check your DATABASE_URL configuration.");
  }
}

/**
 * Gracefully close database connection
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info("Database connection closed");
}
