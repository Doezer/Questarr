import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dialect } from "../db.js";
import { TABLE_ORDER } from "../db/table-order.js";
import { logger } from "../logger.js";
import {
  CONFIG_ENTRY,
  SCREENSHOTS_PREFIX,
  SQLITE_DB_ENTRY,
  createBackup,
  getBackupState,
  getBundledMigrationCount,
  readSqliteMigrations,
} from "./backup-service.js";
import { getRestoreDir } from "./paths.js";
import {
  applyAuxiliaryFiles,
  clearPendingRestore,
  readPendingRestore,
  writeRestoreResult,
  writePendingRestore,
} from "./restore-boot.js";
import { importTables, isNdjsonEntry } from "./table-io.js";
import { BACKUP_FORMAT_VERSION, type BackupManifest } from "./types.js";
import { extractZip, listZipEntries, readZipText } from "./zip-utils.js";
import { createHash } from "node:crypto";

/** A problem with the archive itself, safe to show to the user. */
export class RestoreError extends Error {}

function allowedEntry(name: string): boolean {
  return (
    name === SQLITE_DB_ENTRY ||
    name === CONFIG_ENTRY ||
    (name.startsWith(SCREENSHOTS_PREFIX) && name.length > SCREENSHOTS_PREFIX.length) ||
    isNdjsonEntry(name)
  );
}

function parseManifest(raw: string): BackupManifest {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw) as BackupManifest;
  } catch {
    throw new RestoreError("manifest.json is not valid JSON");
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION || !Array.isArray(manifest.files)) {
    throw new RestoreError("This is not a backup this version of Questarr can read");
  }
  if (manifest.dialect !== dialect) {
    throw new RestoreError(
      `This backup was made on ${manifest.dialect}, but Questarr is running on ${dialect}. ` +
        "Restoring across database engines is not supported."
    );
  }
  const bundled = getBundledMigrationCount();
  if (manifest.migrations?.applied > bundled) {
    throw new RestoreError(
      `This backup comes from a newer Questarr (${manifest.appVersion}). Update Questarr first.`
    );
  }
  // A SQLite file is migrated forward on start. A Postgres export is inserted into the
  // already-migrated schema, so data-moving migrations would never run on it.
  if (dialect === "postgres" && manifest.migrations?.applied !== bundled) {
    throw new RestoreError(
      `This Postgres backup was made by Questarr ${manifest.appVersion}, a different version. ` +
        "Restore it with that version, then update."
    );
  }
  for (const f of manifest.files) {
    if (!allowedEntry(f.path)) {
      throw new RestoreError(`Unexpected file in the backup: ${f.path}`);
    }
  }
  return manifest;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

/** Check an archive without extracting anything. */
export async function inspectBackup(zipPath: string): Promise<BackupManifest> {
  let manifest: BackupManifest;
  try {
    // listZipEntries rejects traversal, symlinks and absurd sizes up front.
    const entries = await listZipEntries(zipPath);
    if (!entries.some((e) => e.name === "manifest.json")) {
      throw new RestoreError("Not a Questarr backup: manifest.json is missing");
    }
    manifest = parseManifest(await readZipText(zipPath, "manifest.json"));
    const present = new Set(entries.map((e) => e.name));
    for (const f of manifest.files) {
      if (!present.has(f.path)) throw new RestoreError(`The backup is missing ${f.path}`);
    }
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`Cannot read the archive: ${(err as Error).message}`);
  }
  return manifest;
}

/**
 * Validate a backup, snapshot the current data, and stage the backup for the next start.
 * Nothing live is touched: the swap happens at boot (SQLite) or right after migrations
 * (Postgres).
 */
export async function stageRestore(zipPath: string, source: string): Promise<BackupManifest> {
  const manifest = await inspectBackup(zipPath);
  const staging = getRestoreDir();
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    const wanted = new Set(manifest.files.map((f) => f.path));
    try {
      await extractZip(zipPath, staging, (name) => wanted.has(name));
    } catch (err) {
      throw new RestoreError(`Cannot extract the archive: ${(err as Error).message}`);
    }
    for (const f of manifest.files) {
      const file = path.join(staging, f.path);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat || stat.size !== f.size || (await sha256(file)) !== f.sha256) {
        throw new RestoreError(`Checksum mismatch on ${f.path}: the backup is corrupt`);
      }
    }

    if (dialect === "sqlite") {
      let probe: Database.Database;
      try {
        probe = new Database(path.join(staging, SQLITE_DB_ENTRY), { readonly: true });
      } catch {
        throw new RestoreError("The database inside the backup cannot be opened");
      }
      try {
        const check = probe.pragma("integrity_check", { simple: true });
        if (check !== "ok") throw new RestoreError("The database inside the backup is corrupt");
        if (readSqliteMigrations(probe).applied > getBundledMigrationCount()) {
          throw new RestoreError("This backup comes from a newer Questarr. Update Questarr first.");
        }
        if (!probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get()) {
          throw new RestoreError("The database inside the backup is not a Questarr database");
        }
      } finally {
        probe.close();
      }
    }

    // Safety net before anything can be overwritten: if this fails, the restore stops here.
    try {
      await createBackup("pre-restore");
    } catch (err) {
      if (getBackupState().running) {
        throw new RestoreError("A backup is running. Try again when it finishes.");
      }
      throw err;
    }

    writePendingRestore({
      formatVersion: 1,
      dialect,
      stagedAt: new Date().toISOString(),
      source,
      manifest,
    });
  } catch (err) {
    await fs.promises.rm(staging, { recursive: true, force: true });
    throw err;
  }
  logger.info({ source }, "Restore staged; it applies at the next start");
  return manifest;
}

/** Postgres: replace the tables with the staged export. Call after migrations have run. */
export async function applyPendingPostgresRestore(): Promise<boolean> {
  const pending = readPendingRestore();
  if (!pending || pending.dialect !== "postgres" || dialect !== "postgres") return false;
  try {
    const counts = await importTables(getRestoreDir());
    applyAuxiliaryFiles();
    logger.info(
      {
        source: pending.source,
        tables: TABLE_ORDER.length,
        rows: Object.values(counts).reduce((a, b) => a + b, 0),
      },
      "Restored the database from a backup"
    );
    writeRestoreResult({ ok: true, at: new Date().toISOString(), source: pending.source });
    return true;
  } catch (err) {
    logger.error({ err }, "Restore failed; the transaction was rolled back");
    writeRestoreResult({
      ok: false,
      at: new Date().toISOString(),
      source: pending.source,
      error: (err as Error).message.slice(0, 300),
    });
    return false;
  } finally {
    clearPendingRestore();
  }
}
