import { logger } from "./logger.js";
import { db, pool } from "./db.js";
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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint
      );
    `);

    const migrationsFolder = path.resolve(process.cwd(), "migrations");
    const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

    if (!fs.existsSync(journalPath)) {
      throw new Error(`Migrations journal not found at: ${journalPath}`);
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const appliedRows = await db.execute(sql`SELECT hash FROM "__drizzle_migrations"`);
    const appliedHashes = new Set(appliedRows.rows.map((r) => r.hash));

    for (const entry of journal.entries) {
      const tag = entry.tag;
      if (appliedHashes.has(tag)) {
        continue;
      }

      logger.info(`Applying migration ${tag}...`);

      const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
      const sqlContent = fs.readFileSync(sqlPath, "utf-8");
      const statements = sqlContent.split("--> statement-breakpoint");

      try {
        await db.transaction(async (tx) => {
          for (const statement of statements) {
            if (!statement.trim()) continue;

            // Use SAVEPOINT to allow ignoring specific errors without aborting the transaction
            await tx.execute(sql.raw("SAVEPOINT stmt"));
            try {
              await tx.execute(sql.raw(statement));
              await tx.execute(sql.raw("RELEASE SAVEPOINT stmt"));
            } catch (e: unknown) {
              await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT stmt"));

              const code =
                (e as { code?: string })?.code || (e as { cause?: { code?: string } })?.cause?.code;
              // Ignore "relation/object already exists" errors
              if (["42P07", "42701", "42710", "42703"].includes(code || "")) {
                logger.warn(
                  `Skipping statement in ${tag} due to existing object: ${(e as Error).message}`
                );
              } else {
                throw e;
              }
            }
          }

          await tx.execute(sql`
            INSERT INTO "__drizzle_migrations" (hash, created_at)
            VALUES (${tag}, ${Date.now()})
          `);
        });

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
  // Allow skipping DB check for testing environments without DB
  if (process.env.SKIP_DB_CHECK === "true") {
    logger.warn("Skipping database check due to SKIP_DB_CHECK=true");
    return;
  }

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
        // Display user-friendly message for DB connection issues
        console.error(
          "\n\x1b[31m[ERROR]\x1b[0m Unable to contact the database. Please verify that your DATABASE_URL is correct and that your database server is online and accessible.\n"
        );
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
