import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { db, pool } from "./db.js";
import { sql } from "drizzle-orm";

/**
 * Run database migrations from the migrations folder
 */
export async function runMigrations(): Promise<void> {
  try {
    logger.info("Running database migrations...");
    
    // Check if this is a fresh database or migrated from push
    const drizzleMigrationsTable = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
      );
    `);
    
    const hasMigrationsTable = drizzleMigrationsTable.rows[0]?.exists;
    
    if (!hasMigrationsTable) {
      // Check if tables already exist (migrated from push)
      const downloadersTable = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'downloaders'
        );
      `);
      
      const hasExistingTables = downloadersTable.rows[0]?.exists;
      
      if (hasExistingTables) {
        logger.info("Existing tables detected (migrated from drizzle-kit push). Creating migrations tracking table...");
        // Create the migrations table and mark initial migration as applied
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
          );
        `);
        // Mark the initial migration as applied
        await db.execute(sql`
          INSERT INTO "__drizzle_migrations" (hash, created_at)
          VALUES ('0000_complex_synch', ${Date.now()})
          ON CONFLICT DO NOTHING;
        `);
        logger.info("Migration tracking initialized for existing database");
        return;
      }
    }
    
    await migrate(db, { migrationsFolder: "./migrations" });
    logger.info("Database migrations completed successfully");
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
    
    // Check if users table exists
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    const tableExists = result.rows[0]?.exists;
    
    if (!tableExists) {
      logger.warn("Users table not found. Running migrations...");
    }
    
    // Always run migrations to ensure schema is up-to-date
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

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      logger.info("Migration script completed");
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, "Migration script failed");
      process.exit(1);
    });
}
