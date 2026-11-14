import path from "node:path";
import { configLoader } from "../config-loader.js";

/**
 * Backups live next to config.yaml (the `data/` volume in Docker), never under the
 * working directory, so they survive the container being recreated.
 * BACKUP_DIR overrides it, e.g. to put them on another disk.
 */
export function getBackupDir(): string {
  const override = process.env.BACKUP_DIR?.trim();
  return override ? path.resolve(override) : path.join(configLoader.getConfigDir(), "backups");
}

/** Where a validated restore waits for the next start: on the same volume as the backups. */
export function getRestoreDir(): string {
  return path.join(getBackupDir(), ".restore-pending");
}

export function getScreenshotsDir(): string {
  return path.join(configLoader.getConfigDir(), "screenshots");
}

export function getConfigFilePath(): string {
  return path.join(configLoader.getConfigDir(), "config.yaml");
}
