import { logger } from "./logger.js";
import { db } from "./db.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

/**
 * Run database migrations from the migrations folder
 */
export async function runMigrations(): Promise<void> {
  try {
    logger.info("Running database migrations...");

    // Create migrations table if it doesn't exist
    // SQLite syntax for table creation
    db.run(sql`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL UNIQUE,
        created_at integer
      );
    `);

    const migrationsFolder = path.resolve(process.cwd(), "migrations");
    const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

    if (!fs.existsSync(journalPath)) {
      throw new Error(`Migrations journal not found at: ${journalPath}`);
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const appliedRows = db.all<{ hash: string }>(sql`SELECT hash FROM "__drizzle_migrations"`);
    const appliedHashes = new Set(appliedRows.map((r) => r.hash));

    for (const entry of journal.entries) {
      const tag = entry.tag;
      if (appliedHashes.has(tag)) {
        continue;
      }

      logger.info(`Applying migration ${tag}...`);

      const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
      const sqlContent = fs.readFileSync(sqlPath, "utf-8");

      // SQLite doesn't strictly need statement splitting like pg if using exec() on the driver directly,
      // but drizzle's .run() might be single-statement.
      // Better-sqlite3's exec() handles multiple statements.
      // However, we want transaction safety.

      // We will assume the file content is a valid SQL script.
      // Drizzle-kit generated files often use `--> statement-breakpoint` separator.
      const statements = sqlContent.split("--> statement-breakpoint");

      try {
        // Run statements individually to allow skipping "already exists" errors.
        // SQLite transactions enter an error state if a statement fails, preventing further execution.
        for (const statement of statements) {
          const rawSql = statement.trim();
          if (!rawSql) continue;
          try {
            db.run(sql.raw(rawSql));
          } catch (e: any) {
            const msg = String(e);
            const isAlreadyExists =
              msg.toLowerCase().includes("already exists") ||
              (e.cause && String(e.cause).toLowerCase().includes("already exists"));

            if (isAlreadyExists) {
              logger.warn(`Skipping statement in ${tag} due to existing object`);
            } else {
              throw e;
            }
          }
        }

        db.run(sql`
          INSERT INTO "__drizzle_migrations" (hash, created_at)
          VALUES (${tag}, ${Date.now()})
        `);

        logger.info(`Migration ${tag} applied successfully`);
      } catch (err) {
        logger.error(`Migration ${tag} failed: ${err}`);
        throw err;
      }
    }

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
  logger.info("Database connection closed (noop for sqlite)");
}
