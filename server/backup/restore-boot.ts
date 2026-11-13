import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { configLoader } from "../config-loader.js";
import { resolveSqliteDbPath } from "../db/sqlite-path.js";
import { logger } from "../logger.js";
import { getBackupDir, getConfigFilePath, getRestoreDir, getScreenshotsDir } from "./paths.js";
import type { BackupDialect, BackupManifest } from "./types.js";

/**
 * The part of a restore that has to run before the database is opened. It imports
 * nothing that connects to the database, so server/index.ts can load it first.
 *
 * A restore is applied at the next start rather than live: the running process holds
 * the SQLite file (and its -wal), and replacing it underneath open connections would
 * corrupt it.
 */

export interface PendingRestore {
  formatVersion: 1;
  dialect: BackupDialect;
  stagedAt: string;
  source: string;
  manifest: BackupManifest;
}

const MARKER = "restore.json";
export const STAGED_SQLITE = "database/sqlite.db";
export const STAGED_CONFIG = "config/config.yaml";
export const STAGED_SCREENSHOTS = "screenshots";

export function currentDialect(): BackupDialect {
  const dialect = (process.env.DB_DIALECT ?? "").trim().toLowerCase();
  const driver = process.env.QUESTARR_DB_DRIVER;
  if (driver === "pglite" || driver === "node-postgres") return "postgres";
  if (driver === "better-sqlite3") return "sqlite";
  return dialect === "postgres" || dialect === "postgresql" ? "postgres" : "sqlite";
}

export function readPendingRestore(): PendingRestore | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(getRestoreDir(), MARKER), "utf-8")
    ) as PendingRestore;
  } catch {
    return null;
  }
}

/** Written last, so a half-staged restore (no marker) is never applied. */
export function writePendingRestore(marker: PendingRestore): void {
  const dir = getRestoreDir();
  const tmp = path.join(dir, `${MARKER}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(marker, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, MARKER));
}

export interface RestoreResult {
  ok: boolean;
  at: string;
  source: string;
  error?: string;
}

/** Outcome of the last restore, kept so the Backups page can show what happened at boot. */
export function writeRestoreResult(result: RestoreResult): void {
  try {
    const dir = getBackupDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "last-restore.json"), JSON.stringify(result), { mode: 0o600 });
  } catch (err) {
    logger.warn({ err }, "Could not record the restore result");
  }
}

export function readRestoreResult(): RestoreResult | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(getBackupDir(), "last-restore.json"), "utf-8")
    ) as RestoreResult;
  } catch {
    return null;
  }
}

export function clearRestoreResult(): void {
  fs.rmSync(path.join(getBackupDir(), "last-restore.json"), { force: true });
}

export function clearPendingRestore(): void {
  fs.rmSync(getRestoreDir(), { recursive: true, force: true });
}

/**
 * Config file and screenshots, shared by both dialects. Returns an `undo` that puts the
 * previous config.yaml back, for a caller whose database step fails afterwards. A failure
 * inside this function undoes itself before throwing.
 */
export function applyAuxiliaryFiles(): () => void {
  const dir = getRestoreDir();
  const target = getConfigFilePath();
  const previous = `${target}.pre-restore`;
  let touchedConfig = false;
  let hadConfig = false;

  const undo = (): void => {
    if (!touchedConfig) return;
    try {
      if (hadConfig) fs.copyFileSync(previous, target);
      else fs.rmSync(target, { force: true });
      configLoader.reload();
    } catch (err) {
      logger.error({ err }, "Could not put the previous config.yaml back");
    }
  };

  try {
    const stagedConfig = path.join(dir, STAGED_CONFIG);
    if (fs.existsSync(stagedConfig)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      hadConfig = fs.existsSync(target);
      if (hadConfig) fs.copyFileSync(target, previous);
      touchedConfig = true;
      fs.copyFileSync(stagedConfig, target);
      // The loader read the old file when it was created; the SSL settings come from here.
      configLoader.reload();
    }
    const stagedShots = path.join(dir, STAGED_SCREENSHOTS);
    if (fs.existsSync(stagedShots)) {
      fs.cpSync(stagedShots, getScreenshotsDir(), { recursive: true, force: true });
    }
  } catch (err) {
    undo();
    throw err;
  }
  return undo;
}

/**
 * Swap the staged SQLite file in. Returns true when a restore was applied. The
 * previous database stays next to the new one as `<name>.pre-restore`.
 */
export function applyPendingSqliteRestore(): boolean {
  const pending = readPendingRestore();
  if (!pending) return false;
  if (pending.dialect !== currentDialect()) {
    logger.warn(
      { pending: pending.dialect, current: currentDialect() },
      "Ignoring a staged restore made for the other database engine"
    );
    clearPendingRestore();
    return false;
  }
  if (pending.dialect !== "sqlite") return false; // Postgres: applied after migrations

  const staged = path.join(getRestoreDir(), STAGED_SQLITE);
  const dbPath = resolveSqliteDbPath();
  let movedOriginal = false;
  try {
    const probe = new Database(staged, { readonly: true });
    try {
      const result = probe.pragma("integrity_check", { simple: true });
      if (result !== "ok") throw new Error(`integrity_check reported: ${String(result)}`);
    } finally {
      probe.close();
    }

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (fs.existsSync(dbPath)) {
      // The old process may have exited with writes still in the -wal file: fold them
      // into the main file so the kept copy is complete.
      try {
        const old = new Database(dbPath);
        try {
          old.pragma("wal_checkpoint(TRUNCATE)");
        } finally {
          old.close();
        }
      } catch (err) {
        logger.warn({ err }, "Could not checkpoint the old database before the restore");
      }
      fs.renameSync(dbPath, `${dbPath}.pre-restore`);
      movedOriginal = true;
    }
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
    fs.copyFileSync(staged, dbPath);
    applyAuxiliaryFiles();
    logger.info({ source: pending.source }, "Restored the database from a backup");
    clearPendingRestore();
    writeRestoreResult({ ok: true, at: new Date().toISOString(), source: pending.source });
    return true;
  } catch (err) {
    logger.error({ err }, "Restore failed; keeping the current database");
    clearPendingRestore();
    writeRestoreResult({
      ok: false,
      at: new Date().toISOString(),
      source: pending.source,
      error: (err as Error).message.slice(0, 300),
    });
    // Put the old file back if the swap got as far as moving it away, even when the new
    // file was already copied in (a later step, such as the config, failed).
    if (movedOriginal) {
      try {
        for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
        fs.renameSync(`${dbPath}.pre-restore`, dbPath);
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, "Could not put the previous database back");
      }
    }
    return false;
  } finally {
    // Whatever happened, do not retry on every start.
    clearPendingRestore();
  }
}
