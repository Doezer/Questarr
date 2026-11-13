import fs from "fs";
import path from "path";

/**
 * Where the SQLite database file lives. Shared by the connection code and the
 * restore-at-boot step, which both have to agree on the file they are touching.
 * A directory in SQLITE_DB_PATH means "sqlite.db inside it".
 */
export function resolveSqliteDbPath(): string {
  const dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "sqlite.db");
  try {
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory()) {
      return path.join(dbPath, "sqlite.db");
    }
  } catch {
    // Unreadable path: let the caller hit the real error when it opens the file.
  }
  return dbPath;
}
