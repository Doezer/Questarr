import { logger } from "./logger.js";
import { db } from "./db.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

// ─── Schema repair types ──────────────────────────────────────────────────────

interface ColumnRepair {
  name: string;
  /** SQL fragment after the column name, e.g. "text" or "integer NOT NULL DEFAULT 0" */
  definition: string;
}

interface TableRepair {
  columns: ColumnRepair[];
}

interface NewTableSpec {
  createSql: string;
  /**
   * SQL to run immediately before indexSql (e.g. a DELETE to remove duplicate
   * rows before a UNIQUE index is enforced on a table that may already exist
   * in a drifted database without that index).
   */
  dedupSql?: string;
  indexSql?: string;
}

// ─── v1.2.2 → v1.3.0 repair spec ────────────────────────────────────────────
// Lists every column and table added between v1.2.2 (migrations 0000–0003) and
// v1.3.0 (migrations 0004–0013). Covers users who ran an intermediate dev image
// where some migrations ran but others were not yet committed.

const REPAIRS_V1_3_0: Record<string, TableRepair> = {
  user_settings: {
    columns: [
      // 0004 – auto_search_unreleased
      { name: "auto_search_unreleased", definition: "integer NOT NULL DEFAULT 0" },
      // 0005 – steam integration
      { name: "steam_sync_failures", definition: "integer NOT NULL DEFAULT 0" },
      // 0011 – preferred release groups
      { name: "preferred_release_groups", definition: "text" },
      { name: "filter_by_preferred_groups", definition: "integer NOT NULL DEFAULT 0" },
      // 0013 – preferred platform
      { name: "preferred_platform", definition: "text" },
    ],
  },
  users: {
    columns: [
      // 0005 – steam integration
      { name: "steam_id_64", definition: "text" },
    ],
  },
  games: {
    columns: [
      // 0005 – steam integration
      { name: "steam_appid", definition: "integer" },
      // 0007 – search_results_available (table rebuild; ADD COLUMN handles drift)
      { name: "search_results_available", definition: "integer NOT NULL DEFAULT 0" },
      // 0009 – early access flag
      { name: "early_access", definition: "integer NOT NULL DEFAULT 0" },
      // 0010 – game metadata fields
      { name: "source", definition: "text DEFAULT 'manual'" },
      { name: "igdb_websites", definition: "text" },
      { name: "aggregated_rating", definition: "real" },
      // 0012 – user rating
      { name: "user_rating", definition: "real" },
    ],
  },
  game_downloads: {
    columns: [
      // 0010 – file size tracking
      { name: "file_size", definition: "integer" },
    ],
  },
};

// New tables added in v1.3.0 that must exist (CREATE TABLE IF NOT EXISTS is safe).
const NEW_TABLES_V1_3_0: Array<NewTableSpec> = [
  {
    // 0008 – release blacklist
    createSql: `
      CREATE TABLE IF NOT EXISTS \`release_blacklist\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`game_id\` text NOT NULL,
        \`release_title\` text NOT NULL,
        \`indexer_name\` text,
        \`created_at\` integer DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (\`game_id\`) REFERENCES \`games\`(\`id\`) ON UPDATE no action ON DELETE cascade
      )
    `,
    // A drifted database may already contain the table without the unique index,
    // and may have accumulated duplicate (game_id, release_title) pairs.  Remove
    // duplicates (keeping the oldest rowid) before enforcing uniqueness so that
    // CREATE UNIQUE INDEX does not hard-fail and abort startup.
    dedupSql: `
      DELETE FROM \`release_blacklist\`
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM \`release_blacklist\`
        GROUP BY \`game_id\`, \`release_title\`
      )
    `,
    indexSql: `
      CREATE UNIQUE INDEX IF NOT EXISTS \`release_blacklist_game_title_idx\`
      ON \`release_blacklist\` (\`game_id\`, \`release_title\`)
    `,
  },
];

/**
 * Idempotent schema repair for the v1.2.2 → v1.3.0 upgrade.
 *
 * Runs after runMigrations(). Uses PRAGMA table_info() to detect columns that
 * are missing from the live database (e.g. because an intermediate dev image
 * was used before the migration file existed) and adds them with safe defaults.
 */
async function repairSchemaForV1_3_0(): Promise<void> {
  logger.info("Running schema repair check for v1.2.2 → v1.3.0...");
  let repairedColumns = 0;

  // Wrap column repairs in a single transaction for atomicity and performance.
  db.transaction((tx) => {
    for (const [table, spec] of Object.entries(REPAIRS_V1_3_0)) {
      const rows = tx.all<{ name: string }>(sql.raw(`PRAGMA table_info(\`${table}\`)`));
      const existing = new Set(rows.map((r) => r.name));

      for (const col of spec.columns) {
        if (!existing.has(col.name)) {
          logger.warn(`Schema repair: \`${table}\`.\`${col.name}\` is missing — adding it now`);
          tx.run(sql.raw(`ALTER TABLE \`${table}\` ADD COLUMN \`${col.name}\` ${col.definition}`));
          repairedColumns++;
        }
      }
    }
  });

  for (const { createSql, dedupSql, indexSql } of NEW_TABLES_V1_3_0) {
    db.run(sql.raw(createSql));
    if (dedupSql) db.run(sql.raw(dedupSql));
    if (indexSql) db.run(sql.raw(indexSql));
  }

  if (repairedColumns > 0) {
    logger.warn(`Schema repair: patched ${repairedColumns} missing column(s)`);
  } else {
    logger.info("Schema repair: database is up to date, no columns added");
  }
}

function getErrorText(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const err = error as { message?: string; cause?: { message?: string } };
    const msg = String(err?.message ?? "");
    const causeMsg = String(err?.cause?.message ?? "");
    const result = `${msg} ${causeMsg}`.trim();
    if (result) return result;
  }
  return String(error ?? "");
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
    await repairSchemaForV1_3_0();
  } catch (error) {
    logger.error({ err: error }, "Database check failed");
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  logger.info("Database connection closed (noop for sqlite)");
}
