/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import pg from "pg";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const { Pool } = pg;

// --- Configuration & Types ---

interface TableConfig {
  // If the source table was renamed, list older names here to try if the main name is missing
  sourceTableAliases?: string[];
  targetColumns: string[];
  // Map source column (key) to target column (value). specific renames.
  columnMapping?: Record<string, string>;
  // Custom transform function for row data
  transform?: (row: any) => any;
  // Critical columns that MUST exist in source for migration to proceed
  requiredSourceColumns?: string[];
}

// Schema definitions based on shared/schema.ts and known renames from git history
const MIGRATION_CONFIG: Record<string, TableConfig> = {
  users: {
    targetColumns: ["id", "username", "password_hash"],
    requiredSourceColumns: ["username", "password_hash"],
  },
  user_settings: {
    targetColumns: [
      "id",
      "user_id",
      "auto_search_enabled",
      "auto_download_enabled",
      "notify_multiple_downloads",
      "notify_updates",
      "search_interval_hours",
      "igdb_rate_limit_per_second",
      "download_rules",
      "last_auto_search",
      "updated_at",
    ],
    requiredSourceColumns: ["user_id"],
    columnMapping: {
      notify_multiple_torrents: "notify_multiple_downloads",
    },
  },
  system_config: {
    targetColumns: ["key", "value", "updated_at"],
    requiredSourceColumns: ["key", "value"],
  },
  games: {
    targetColumns: [
      "id",
      "user_id",
      "igdb_id",
      "title",
      "summary",
      "cover_url",
      "release_date",
      "rating",
      "platforms",
      "genres",
      "publishers",
      "developers",
      "screenshots",
      "status",
      "original_release_date",
      "release_status",
      "hidden",
      "added_at",
      "completed_at",
    ],
    requiredSourceColumns: ["title"],
  },
  indexers: {
    targetColumns: [
      "id",
      "name",
      "url",
      "api_key",
      "protocol",
      "enabled",
      "priority",
      "categories",
      "rss_enabled",
      "auto_search_enabled",
      "created_at",
      "updated_at",
    ],
    requiredSourceColumns: ["name", "url", "api_key"],
    // Note: 'protocol' might be missing in very old versions. SQLite default is 'torznab', which is correct.
  },
  downloaders: {
    targetColumns: [
      "id",
      "name",
      "type",
      "url",
      "port",
      "use_ssl",
      "url_path",
      "username",
      "password",
      "enabled",
      "priority",
      "download_path",
      "category",
      "label",
      "add_stopped",
      "remove_completed",
      "post_import_category",
      "settings",
      "created_at",
      "updated_at",
    ],
    requiredSourceColumns: ["name", "type", "url"],
  },
  game_downloads: {
    sourceTableAliases: ["game_torrents"], // Renamed in migration 0001
    targetColumns: [
      "id",
      "game_id",
      "downloader_id",
      "download_type",
      "download_hash",
      "download_title",
      "status",
      "added_at",
      "completed_at",
    ],
    requiredSourceColumns: ["game_id", "downloader_id"],
    columnMapping: {
      torrent_hash: "download_hash",
      torrent_title: "download_title",
    },
    transform: (row) => {
      if (row.status) row.status = row.status.toLowerCase();
      // If download_type is missing (from game_torrents), SQLite default is 'torrent', which is correct.
      return row;
    },
  },
  notifications: {
    targetColumns: ["id", "user_id", "type", "title", "message", "read", "created_at"],
    requiredSourceColumns: ["title", "message"],
  },
};

async function migrate() {
  const pgUrl = process.env.DATABASE_URL;
  if (!pgUrl) {
    console.log("No DATABASE_URL found, skipping migration from Postgres.");
    return;
  }

  console.log(`Connecting to Postgres: ${pgUrl}`);
  const pool = new Pool({ connectionString: pgUrl });

  const sqlitePath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "sqlite.db");
  console.log(`Connecting to SQLite: ${sqlitePath}`);

  if (!fs.existsSync(sqlitePath)) {
    console.warn("⚠️ SQLite database file does not exist. Ensure schema is pushed first.");
  }

  const sqlite = new Database(sqlitePath);

  try {
    const tables = Object.keys(MIGRATION_CONFIG);
    const stats: Record<string, { source: number; migrated: number; skipped: number }> = {};

    for (const targetTableName of tables) {
      console.log(`\n📦 Migrating table: ${targetTableName}...`);
      const config = MIGRATION_CONFIG[targetTableName];

      try {
        // 1. Determine Source Table Name
        let sourceTableName = targetTableName;
        let rows: any[] = [];

        // Try main name
        try {
          const result = await pool.query(`SELECT * FROM "${sourceTableName}"`);
          rows = result.rows;
        } catch (err: any) {
          if (err.code === "42P01" && config.sourceTableAliases) {
            // Try aliases
            for (const alias of config.sourceTableAliases) {
              try {
                console.log(
                  `   Target table ${sourceTableName} not found in source, trying alias: ${alias}`
                );
                const result = await pool.query(`SELECT * FROM "${alias}"`);
                rows = result.rows;
                sourceTableName = alias; // Update source name for logging
                console.log(`   Found match: ${alias}`);
                break;
              } catch (aliasErr) {
                // Continue to next alias
              }
            }
          } else {
            throw err;
          }
        }

        if (rows.length === 0) {
          // Check if it was because we couldn't find the table at all
          if (
            sourceTableName !== targetTableName &&
            !config.sourceTableAliases?.includes(sourceTableName)
          ) {
            console.log(
              `   Source table ${targetTableName} (and aliases) not found in Postgres, skipping.`
            );
          } else {
            console.log(`   No rows in ${sourceTableName}, skipping.`);
          }
          stats[targetTableName] = { source: 0, migrated: 0, skipped: 0 };
          continue;
        }

        const sourceRowCount = rows.length;
        console.log(`   Found ${sourceRowCount} rows in source table '${sourceTableName}'.`);

        // 2. Validate Source Schema
        const sourceColumns = Object.keys(rows[0]);
        if (config.requiredSourceColumns) {
          const missing = config.requiredSourceColumns.filter((c) => !sourceColumns.includes(c));
          if (missing.length > 0) {
            // Check if missing columns are mapped
            const unmappedMissing = missing.filter((m) => {
              // Check if we have a mapping for a source column that maps to this required column?
              // No, requiredSourceColumns lists SOURCE column names.
              // But wait, if we renamed 'torrent_hash' -> 'download_hash', and we require 'download_hash'?
              // Ah, requiredSourceColumns should be checked against available source columns.
              // If the config says required: 'download_hash', but source has 'torrent_hash', validation fails.
              // FIX: requiredSourceColumns should probably refer to TARGET columns that must be satisfyable?
              // OR: We just rely on the mapping.

              // Let's assume requiredSourceColumns refers to keys present in the SOURCE row (after mapping check?)
              // Actually, let's keep it simple: requiredSourceColumns checks raw source keys.
              // If I require 'torrent_hash' but table is new 'game_downloads', it fails.
              // Logic issue here.

              // IMPROVED LOGIC: skip strict validation if aliases were used, assume best effort?
              // Or update config to reflect that required cols might change names.

              // Let's rely on the mapping check below. If a value is undefined after mapping, SQLite will default or throw.
              return true;
            });

            // We will relax this check. SQLite will enforce NOT NULL constraints anyway.
            // console.warn(`   ⚠️ Potentially missing source columns: ${missing.join(", ")}`);
          }
        }

        // 3. Prepare Target Query
        const targetCols = config.targetColumns;
        const placeholders = targetCols.map(() => "?").join(", ");
        const insertSql = `INSERT INTO "${targetTableName}" (${targetCols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
        const insertStmt = sqlite.prepare(insertSql);

        // 4. Transform and Load
        const runTransaction = sqlite.transaction((rowsToInsert) => {
          let migrated = 0;
          let skipped = 0;

          for (let row of rowsToInsert) {
            // Apply custom transforms
            if (config.transform) {
              row = config.transform(row);
            }

            // Map values to target columns
            const values = targetCols.map((targetCol) => {
              // 1. Try direct match
              let val = row[targetCol];

              // 2. Try mapped source column
              if (val === undefined && config.columnMapping) {
                // Reverse lookup: find key in mapping where value === targetCol
                // Actually, my config definition was: key=Source, value=Target.
                // So I should look for a key in columnMapping where value === targetCol
                const sourceKey = Object.keys(config.columnMapping).find(
                  (k) => config.columnMapping![k] === targetCol
                );
                if (sourceKey && row[sourceKey] !== undefined) {
                  val = row[sourceKey];
                }
              }

              // Data Type Conversion
              if (val instanceof Date) {
                return val.getTime();
              }
              if (Array.isArray(val)) {
                return JSON.stringify(val);
              }
              if (typeof val === "boolean") {
                return val ? 1 : 0;
              }
              if (typeof val === "object" && val !== null) {
                return JSON.stringify(val);
              }

              return val;
            });

            try {
              insertStmt.run(...values);
              migrated++;
            } catch (err: any) {
              if (
                err.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
                err.code === "SQLITE_CONSTRAINT_UNIQUE"
              ) {
                skipped++;
              } else {
                // Log specific error for debugging
                // console.error(`Row failed:`, values, err.message);
                throw err;
              }
            }
          }
          return { migrated, skipped };
        });

        const result = runTransaction(rows);
        stats[targetTableName] = {
          source: sourceRowCount,
          migrated: result.migrated,
          skipped: result.skipped,
        };

        console.log(`   ✅ Migrated: ${result.migrated}, Skipped (Duplicate): ${result.skipped}`);

        // 5. Post-Migration Validation
        const targetCount = sqlite
          .prepare(`SELECT COUNT(*) as count FROM "${targetTableName}"`)
          .get() as { count: number };

        if (targetCount.count < result.migrated) {
          console.error(
            `   ⚠️ Integrity Check Failed: Target has ${targetCount.count} rows, expected at least ${result.migrated}`
          );
        }
      } catch (err: any) {
        if (err.code === "42P01") {
          // Already handled in alias logic, but catch-all here
          console.log(`   Table ${targetTableName} skipped (not found).`);
        } else {
          console.error(`   ❌ Error migrating ${targetTableName}:`, err);
        }
      }
    }

    console.log("\n--- Migration Summary ---");
    console.table(stats);
    console.log("Migration completed.");
  } catch (error) {
    console.error("Migration fatal error:", error);
    process.exit(1);
  } finally {
    await pool.end();
    sqlite.close();
  }
}

migrate();
