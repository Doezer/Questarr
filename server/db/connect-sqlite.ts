import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import * as schema from "../../shared/schema.js";
import { logger } from "../logger.js";
import type { DatabaseConnection } from "./types.js";

/**
 * SQLite backend -- the default, and the zero-config path for self-hosters.
 *
 * This is the original contents of server/db.ts, moved verbatim when Postgres
 * support was added. The directory handling and the UID/GID/chown wording in the
 * error below are load-bearing for Docker support tickets; do not "tidy" them.
 */
export function connectSqlite(): DatabaseConnection {
  // In production, the database file should be in a persistent location
  // For development, it's in the project root
  let dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "sqlite.db");

  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dbDir)) {
      logger.info(`Creating database directory: ${dbDir}`);
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Verify permissions/status of the file if it exists
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      if (stats.isDirectory()) {
        logger.warn(`Database path ${dbPath} is a directory, appending /sqlite.db`);
        dbPath = path.join(dbPath, "sqlite.db");
      }
    }
  } catch (err) {
    logger.error({ err }, `Failed to verify/create database directory ${dbDir}`);
  }

  logger.info(`Initializing SQLite database at: ${dbPath}`);

  // Initialize the database connection
  let sqlite: Database.Database;
  try {
    sqlite = new Database(dbPath);
  } catch (err) {
    const uid = process.getuid?.() ?? "unknown";
    const gid = process.getgid?.() ?? "unknown";
    logger.error(
      { err, dbPath, uid, gid },
      `Cannot open SQLite database at ${dbPath}. ` +
        `Process is running as UID ${uid} GID ${gid}. ` +
        `Ensure the directory ${path.dirname(dbPath)} exists and is writable. ` +
        `In Docker: set PUID/PGID in your compose environment to match the host volume owner, ` +
        `or run: sudo chown -R <UID>:<GID> ./data on the host.`
    );
    process.exit(1);
  }

  // Apply pragmas for performance and compatibility
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return {
    db,
    pool: sqlite,
    ping: async () => {
      if (!db.get(sql`SELECT 1`)) {
        throw new Error("Database connection test failed");
      }
    },
    // better-sqlite3 holds a file handle, not a pool; the process exiting is
    // enough, so this stays a no-op as it always has been.
    close: async () => {},
  };
}
