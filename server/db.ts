import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../shared/schema.js";
import path from "path";
import fs from "fs";
import { logger } from "./logger.js";

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
  logger.error(
    { err, dbPath, uid },
    `Cannot open SQLite database at ${dbPath}. ` +
      `Process is running as UID ${uid}. ` +
      `Ensure the directory ${dbDir} exists and is writable by that UID. ` +
      `In Docker: set PUID/PGID in your compose environment to match the host volume owner, ` +
      `or run: sudo chown -R <UID>:<GID> ./data on the host.`
  );
  process.exit(1);
}

// Apply pragmas for performance and compatibility
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

// Create the drizzle database instance
export const db = drizzle(sqlite, { schema });
export const pool = sqlite;
