import { logger } from "./logger.js";
import { db } from "./db.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

function getErrorText(error: unknown): string {
  const err = error as { message?: string; cause?: { message?: string } };
  const msg = String(err?.message ?? "");
  const causeMsg = String(err?.cause?.message ?? "");

  return `${msg} ${causeMsg}`.trim();
}

function isSkippableMigrationError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes("already exists") || text.includes("duplicate column name");
}

export async function runMigrations(): Promise<void> {
  try {
    logger.info("Running database migrations...");

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
      logger.debug(`Checking migration status: ${tag}`);

      if (appliedHashes.has(tag)) {
        continue;
      }

      logger.info(`Applying migration ${tag}...`);

      const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
      const sqlContent = fs.readFileSync(sqlPath, "utf-8");
      const statements = sqlContent.split("--> statement-breakpoint");

      try {
        db.transaction((tx) => {
          for (const statement of statements) {
            if (!statement.trim()) continue;
            try {
              tx.run(sql.raw(statement));
            } catch (e) {
              if (isSkippableMigrationError(e)) {
                logger.warn(
                  `Skipping statement in ${tag} due to existing object: ${getErrorText(e)}`
                );
              } else {
                throw e;
              }
            }
          }
        });

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

export async function ensureDatabase(): Promise<void> {
  try {
    logger.info(`Checking database connection...`);

    const result = db.get(sql`SELECT 1`);
    if (!result) {
      throw new Error("Database connection test failed");
    }
    logger.info("Database connection successful");

    await runMigrations();
  } catch (error) {
    logger.error({ err: error }, "Database check failed");
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  logger.info("Database connection closed (noop for sqlite)");
}
