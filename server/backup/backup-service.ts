import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { config } from "../config.js";
import { db, dialect, pool } from "../db.js";
import { TABLE_ORDER } from "../db/table-order.js";
import { routesLogger as logger } from "../logger.js";
import { storage } from "../storage.js";
import { getBackupDir, getConfigFilePath, getScreenshotsDir } from "./paths.js";
import { exportTables, ndjsonFileName, sqlTableName } from "./table-io.js";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_NAME_RE,
  DEFAULT_BACKUP_SETTINGS,
  kindFromName,
  type BackupKind,
  type BackupManifest,
  type BackupManifestFile,
  type BackupSettings,
  type BackupSummary,
} from "./types.js";
import { readZipText } from "./zip-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SETTINGS_KEY = {
  intervalDays: "backup.intervalDays",
  retentionDays: "backup.retentionDays",
  includeScreenshots: "backup.includeScreenshots",
} as const;

export const SQLITE_DB_ENTRY = "database/sqlite.db";
export const CONFIG_ENTRY = "config/config.yaml";
export const SCREENSHOTS_PREFIX = "screenshots/";

const { version: APP_VERSION } = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
) as { version: string };

export function getAppVersion(): string {
  return APP_VERSION;
}

// --- settings --------------------------------------------------------------

export async function getBackupSettings(): Promise<BackupSettings> {
  const [interval, retention, screenshots] = await Promise.all([
    storage.getSystemConfig(SETTINGS_KEY.intervalDays),
    storage.getSystemConfig(SETTINGS_KEY.retentionDays),
    storage.getSystemConfig(SETTINGS_KEY.includeScreenshots),
  ]);
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return raw !== undefined && Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  return {
    intervalDays: num(interval, DEFAULT_BACKUP_SETTINGS.intervalDays),
    retentionDays: Math.max(1, num(retention, DEFAULT_BACKUP_SETTINGS.retentionDays)),
    includeScreenshots:
      screenshots === undefined
        ? DEFAULT_BACKUP_SETTINGS.includeScreenshots
        : screenshots === "true",
  };
}

export async function saveBackupSettings(settings: BackupSettings): Promise<void> {
  await storage.setSystemConfigBatch([
    { key: SETTINGS_KEY.intervalDays, value: String(settings.intervalDays) },
    { key: SETTINGS_KEY.retentionDays, value: String(settings.retentionDays) },
    { key: SETTINGS_KEY.includeScreenshots, value: String(settings.includeScreenshots) },
  ]);
}

// --- environment -----------------------------------------------------------

export function getKeySources(): Pick<BackupManifest, "encryptionKeySource" | "jwtSecretSource"> {
  return {
    encryptionKeySource: config.credentials.encryptionKey ? "env" : "db",
    jwtSecretSource: process.env.JWT_SECRET ? "env" : "db",
  };
}

/** How many migrations this build ships for the active dialect. */
export function getBundledMigrationCount(): number {
  const folder = dialect === "postgres" ? "migrations-pg" : "migrations";
  const journal = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), folder, "meta", "_journal.json"), "utf-8")
  ) as { entries: unknown[] };
  return journal.entries.length;
}

async function readPostgresMigrations(): Promise<BackupManifest["migrations"]> {
  const result = (await (
    db as unknown as { execute(q: unknown): Promise<{ rows: Array<{ n: number | string }> }> }
  ).execute(sql`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`)) as {
    rows: Array<{ n: number | string }>;
  };
  return { applied: Number(result.rows[0]?.n ?? 0), latest: null };
}

export function readSqliteMigrations(file: Database.Database): BackupManifest["migrations"] {
  const hasTable = file
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!hasTable) return { applied: 0, latest: null };
  const rows = file.prepare('SELECT hash FROM "__drizzle_migrations" ORDER BY id').all() as Array<{
    hash: string;
  }>;
  return { applied: rows.length, latest: rows.at(-1)?.hash ?? null };
}

// --- helpers ---------------------------------------------------------------

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function listFilesRecursive(root: string, base = root): Promise<string[]> {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    // Symlinks are skipped: a backup must never follow a link out of the data directory.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function backupFileName(kind: BackupKind, at = new Date(), unique = false): string {
  const stamp =
    `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())}_` +
    `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  // Two backups finishing in the same second get a random suffix instead of overwriting.
  const suffix = unique ? `-${crypto.randomBytes(3).toString("hex")}` : "";
  return `questarr_backup_v${APP_VERSION}_${stamp}${suffix}_${kind}.zip`;
}

/** Resolve a client-supplied backup name to a file inside the backup directory, or null. */
export function resolveBackupPath(name: string): string | null {
  if (!BACKUP_NAME_RE.test(name)) return null;
  const dir = getBackupDir();
  const full = path.resolve(dir, name);
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

// --- creation --------------------------------------------------------------

export interface BackupState {
  running: boolean;
  lastError: string | null;
}
const state: BackupState = { running: false, lastError: null };

export function getBackupState(): BackupState {
  return { ...state };
}

export interface CreatedBackup {
  name: string;
  size: number;
  manifest: BackupManifest;
}

/**
 * Create a backup archive. Only one runs at a time (a second call rejects), so two
 * clicks or a click during the scheduled run cannot interleave.
 */
export async function createBackup(kind: BackupKind): Promise<CreatedBackup> {
  if (state.running) throw new Error("A backup is already running");
  state.running = true;
  state.lastError = null;
  const backupDir = getBackupDir();
  const work = path.join(backupDir, `.work-${crypto.randomBytes(6).toString("hex")}`);
  // Only this call's own partial archive is cleaned up, never another call's.
  let partial: string | null = null;
  try {
    await fs.promises.mkdir(work, { recursive: true, mode: 0o700 });
    const settings = await getBackupSettings();

    const files: Array<{ entry: string; source: string }> = [];
    let tables: Record<string, number>;
    let migrations: BackupManifest["migrations"];

    if (dialect === "postgres") {
      migrations = await readPostgresMigrations();
      tables = await exportTables(work);
      for (const name of TABLE_ORDER) {
        files.push({
          entry: ndjsonFileName(name),
          source: path.join(work, ndjsonFileName(name)),
        });
      }
    } else {
      // The online backup API, not a file copy: the database runs in WAL mode, so a
      // copied .db file can miss everything still sitting in the -wal file.
      const copy = path.join(work, "sqlite.db");
      await pool.backup(copy);
      const snapshot = new Database(copy, { readonly: true });
      try {
        migrations = readSqliteMigrations(snapshot);
        tables = {};
        for (const name of TABLE_ORDER) {
          const row = snapshot
            .prepare(`SELECT count(*) AS n FROM "${sqlTableName(name)}"`)
            .get() as { n: number } | undefined;
          tables[name] = row?.n ?? 0;
        }
      } finally {
        snapshot.close();
      }
      files.push({ entry: SQLITE_DB_ENTRY, source: copy });
    }

    // Config and screenshots are copied into the work dir first, then hashed and archived
    // from those copies, so a file changing mid-backup cannot break its own checksum.
    const configFile = getConfigFilePath();
    const includesConfig = fs.existsSync(configFile);
    if (includesConfig) {
      const copy = path.join(work, "config.yaml");
      await fs.promises.copyFile(configFile, copy);
      files.push({ entry: CONFIG_ENTRY, source: copy });
    }

    let includesScreenshots = false;
    if (settings.includeScreenshots) {
      const root = getScreenshotsDir();
      let index = 0;
      for (const rel of await listFilesRecursive(root)) {
        const copy = path.join(work, "screenshots", String(index++));
        await fs.promises.mkdir(path.dirname(copy), { recursive: true });
        try {
          await fs.promises.copyFile(path.join(root, rel), copy);
        } catch {
          continue; // removed since the listing
        }
        files.push({ entry: SCREENSHOTS_PREFIX + rel, source: copy });
        includesScreenshots = true;
      }
    }

    const manifestFiles: BackupManifestFile[] = await Promise.all(
      files.map(async (f) => ({
        path: f.entry,
        size: (await fs.promises.stat(f.source)).size,
        sha256: await sha256(f.source),
      }))
    );

    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      dialect,
      kind,
      migrations,
      ...getKeySources(),
      tables,
      includesConfig,
      includesScreenshots,
      files: manifestFiles,
    };

    let name = backupFileName(kind);
    if (fs.existsSync(path.join(backupDir, name))) name = backupFileName(kind, new Date(), true);
    const finalPath = path.join(backupDir, name);
    const partialPath = `${finalPath}.partial`;
    partial = partialPath;
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(partialPath, { mode: 0o600 });
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
      for (const f of files) archive.file(f.source, { name: f.entry });
      void archive.finalize();
    });
    await fs.promises.rename(partialPath, finalPath);
    const { size } = await fs.promises.stat(finalPath);
    logger.info({ name, kind, size }, "Backup created");
    return { name, size, manifest };
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // The guard is released only after cleanup, so a new run cannot start mid-cleanup.
    try {
      await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      // A failed run can leave its half-written archive behind (gone after a rename).
      if (partial) await fs.promises.rm(partial, { force: true }).catch(() => {});
    } finally {
      state.running = false;
    }
  }
}

// --- listing, deletion, retention ------------------------------------------

export async function listBackups(): Promise<BackupSummary[]> {
  const dir = getBackupDir();
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const out: BackupSummary[] = [];
  for (const name of names) {
    const kind = kindFromName(name);
    if (!kind) continue;
    const full = path.join(dir, name);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;
    let manifest: BackupSummary["manifest"] = null;
    try {
      const parsed = JSON.parse(await readZipText(full, "manifest.json")) as BackupManifest;
      manifest = {
        appVersion: parsed.appVersion,
        dialect: parsed.dialect,
        formatVersion: parsed.formatVersion,
        encryptionKeySource: parsed.encryptionKeySource,
        includesScreenshots: Boolean(parsed.includesScreenshots),
        migrations: parsed.migrations,
      };
    } catch {
      // Listed anyway so a corrupt file can be seen and deleted.
    }
    out.push({ name, kind, size: stat.size, createdAt: stat.mtimeMs, manifest });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteBackup(name: string): Promise<boolean> {
  const full = resolveBackupPath(name);
  if (!full || !fs.existsSync(full)) return false;
  await fs.promises.rm(full, { force: true });
  return true;
}

/**
 * Delete scheduled backups older than the retention window. Manual and pre-restore
 * backups are never pruned, and the newest scheduled one is always kept.
 */
export async function applyRetention(retentionDays: number): Promise<string[]> {
  const scheduled = (await listBackups()).filter((b) => b.kind === "scheduled");
  const cutoff = Date.now() - retentionDays * DAY_MS;
  const removed: string[] = [];
  for (const backup of scheduled.slice(1)) {
    if (backup.createdAt < cutoff && (await deleteBackup(backup.name))) removed.push(backup.name);
  }
  return removed;
}

/** The scheduled task: back up when the interval has elapsed, then prune. */
export async function runScheduledBackup(): Promise<void> {
  const settings = await getBackupSettings();
  if (settings.intervalDays > 0) {
    const last = (await listBackups()).find((b) => b.kind === "scheduled");
    // A little slack so an hourly check does not skip a backup that is a minute early.
    const due = !last || Date.now() - last.createdAt >= settings.intervalDays * DAY_MS - 5 * 60_000;
    if (due) await createBackup("scheduled");
  }
  await applyRetention(settings.retentionDays);
}
