import fs from "node:fs/promises";
import path from "node:path";
import { backupDatabase, databaseStoragePath, dialect } from "./db.js";

export class DatabaseBackupUnsupportedError extends Error {
  constructor() {
    super(`Database backups are not supported for the ${dialect} backend`);
    this.name = "DatabaseBackupUnsupportedError";
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Creates a driver-consistent backup beside the active SQLite database.
 *
 * The prefix is intentionally controlled by callers; it is never derived from
 * request data. The returned path is absolute so logs and the UI identify the
 * exact artifact that was created.
 */
export async function createDatabaseBackup(prefix: string): Promise<string> {
  if (dialect !== "sqlite" || !databaseStoragePath) {
    throw new DatabaseBackupUnsupportedError();
  }

  const databasePath = path.resolve(databaseStoragePath);
  const backupPath = path.join(path.dirname(databasePath), `${prefix}-${timestamp()}.db`);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await backupDatabase(backupPath);

  // better-sqlite3 resolves its backup promise after the destination is
  // complete. Keep this guard so a driver implementation cannot report success
  // without leaving the artifact requested by the caller.
  await fs.access(backupPath);
  return backupPath;
}
