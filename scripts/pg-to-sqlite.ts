import pg from "pg";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const { Pool } = pg;

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

  // Ensure SQLite DB exists (it should be created by db:push before this runs, but good to check)
  if (!fs.existsSync(sqlitePath)) {
      console.warn("SQLite database file does not exist. Ensure schema is pushed first.");
  }

  const sqlite = new Database(sqlitePath);

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
      console.log(`Migrating table: ${table}...`);

      try {
        const { rows } = await pool.query(`SELECT * FROM "${table}"`);
        if (rows.length === 0) {
            console.log(`  No rows in ${table}, skipping.`);
            continue;
        }

        console.log(`  Found ${rows.length} rows in ${table}.`);

        // Get columns from the first row to construct insert statement
        // Note: this assumes all rows have same structure, which is true for SQL
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => "?").join(", ");

        // We use plain INSERT to catch schema mismatches (e.g. missing non-null columns)
        // but catch unique constraint violations to support idempotency.
        const insertSql = `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`;

        const insertStmt = sqlite.prepare(insertSql);

        const runTransaction = sqlite.transaction((rowsToInsert) => {
            let skipped = 0;
            for (const row of rowsToInsert) {
                const values = columns.map(col => {
                    let val = row[col];

                    // Convert types
                    if (val instanceof Date) {
                        return val.getTime(); // timestamp -> integer (ms)
                    }
                    if (Array.isArray(val)) {
                        return JSON.stringify(val); // text[] -> text (json)
                    }
                    if (typeof val === 'boolean') {
                        return val ? 1 : 0; // boolean -> integer
                    }
                    if (typeof val === 'object' && val !== null) {
                        // Handle generic objects (json columns) if any, though schema seems to use text for json
                        return JSON.stringify(val);
                    }

                    return val;
                });

                try {
                    insertStmt.run(...values);
                } catch (err: any) {
                    // Ignore unique constraint violations (already exists)
                    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                        skipped++;
                    } else {
                        // Rethrow other errors (e.g. NOT NULL constraint) so user knows schema is incompatible
                        throw err;
                    }
                }
            }
            if (skipped > 0) {
                console.log(`    Skipped ${skipped} existing rows.`);
            }
        });

        runTransaction(rows);
        console.log(`  Migrated ${table} successfully.`);

      } catch (err: any) {
          if (err.code === "42P01") { // Undefined table in PG
              console.log(`  Table ${table} does not exist in Postgres, skipping.`);
          } else {
              console.error(`  Error migrating ${table}:`, err);
              console.error(`  ^ This error might be due to a schema mismatch.`);
              console.error(`    Please ensure your source PostgreSQL database is fully migrated using the previous version of the application.`);
              // Don't throw, try next table
          }
      }
    }

    console.log("Migration completed.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await pool.end();
    sqlite.close();
  }
}

migrate();
