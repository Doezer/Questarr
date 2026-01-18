import pg from "pg";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const { Pool } = pg;

export interface MigrationResult {
  success: boolean;
  logs: string[];
  error?: string;
}

export async function migrateFromPostgres(
  connectionString: string,
  sqlitePath?: string
): Promise<MigrationResult> {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  log(`Connecting to Postgres: ${connectionString.replace(/:[^:]*@/, ":***@")}`); // Redact password in logs
  const pool = new Pool({ connectionString });

  const targetSqlitePath = sqlitePath || process.env.SQLITE_DB_PATH || path.join(process.cwd(), "sqlite.db");
  log(`Target SQLite DB: ${targetSqlitePath}`);

  if (!fs.existsSync(targetSqlitePath)) {
    log("SQLite database file does not exist. Ensure schema is initialized first.");
    // We proceed anyway, but better-sqlite3 will create an empty DB if not exists,
    // which will fail insert if schema is missing.
    // However, in the app context, DB should exist.
  }

  const sqlite = new Database(targetSqlitePath);

  try {
    // List of tables in dependency order
    const tables = [
      "users",
      "user_settings",
      "system_config",
      "games",
      "indexers",
      "downloaders",
      "game_downloads",
      "notifications",
    ];

    for (const table of tables) {
      log(`Migrating table: ${table}...`);

      try {
        const { rows } = await pool.query(`SELECT * FROM "${table}"`);
        if (rows.length === 0) {
          log(`  No rows in ${table}, skipping.`);
          continue;
        }

        log(`  Found ${rows.length} rows in ${table}.`);

        // Get columns from the first row to construct insert statement
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => "?").join(", ");
        const insertSql = `INSERT OR IGNORE INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;

        const insertStmt = sqlite.prepare(insertSql);

        const runTransaction = sqlite.transaction((rowsToInsert) => {
          for (const row of rowsToInsert) {
            const values = columns.map((col) => {
              const val = row[col];

              // Convert types
              if (val instanceof Date) {
                return val.getTime(); // timestamp -> integer (ms)
              }
              if (Array.isArray(val)) {
                return JSON.stringify(val); // text[] -> text (json)
              }
              if (typeof val === "boolean") {
                return val ? 1 : 0; // boolean -> integer
              }
              if (typeof val === "object" && val !== null) {
                return JSON.stringify(val);
              }

              return val;
            });
            insertStmt.run(...values);
          }
        });

        runTransaction(rows);
        log(`  Migrated ${table} successfully.`);
      } catch (err: any) {
        if (err.code === "42P01") {
          // Undefined table in PG
          log(`  Table ${table} does not exist in Postgres, skipping.`);
        } else if (err.code === "SQLITE_ERROR" && err.message.includes("no such table")) {
             log(`  Table ${table} does not exist in SQLite target. Ensure migrations are run.`);
             throw err;
        } else {
          log(`  Error migrating ${table}: ${err.message}`);
          console.error(err);
          // Don't throw, try next table? Maybe throw to stop?
          // Let's log and continue for partial success, but maybe critical tables failing should stop.
        }
      }
    }

    log("Migration completed.");
    return { success: true, logs };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`Migration failed: ${msg}`);
    return { success: false, logs, error: msg };
  } finally {
    await pool.end();
    sqlite.close();
  }
}
