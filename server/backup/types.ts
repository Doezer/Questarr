export const BACKUP_FORMAT_VERSION = 1;

export type BackupKind = "manual" | "scheduled" | "pre-restore";
export type BackupDialect = "sqlite" | "postgres";

export interface BackupManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  dialect: BackupDialect;
  kind: BackupKind;
  /** How many migrations the backed-up database had applied, and the newest one's tag when known. */
  migrations: { applied: number; latest: string | null };
  /** Where the credential encryption key and JWT secret come from: only "db" ones are in the backup. */
  encryptionKeySource: "env" | "db";
  jwtSecretSource: "env" | "db";
  tables: Record<string, number>;
  includesConfig: boolean;
  includesScreenshots: boolean;
  files: BackupManifestFile[];
}

export interface BackupSettings {
  /** 0 turns scheduled backups off. */
  intervalDays: number;
  retentionDays: number;
  includeScreenshots: boolean;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  intervalDays: 7,
  retentionDays: 28,
  includeScreenshots: false,
};

export interface BackupSummary {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: number;
  /** Null when the archive cannot be read (corrupt or not a Questarr backup). */
  manifest: Pick<
    BackupManifest,
    | "appVersion"
    | "dialect"
    | "formatVersion"
    | "encryptionKeySource"
    | "includesScreenshots"
    | "migrations"
  > | null;
}

export const BACKUP_NAME_RE =
  /^questarr_backup_v[0-9A-Za-z.+-]+_\d{4}\.\d{2}\.\d{2}_\d{2}\.\d{2}\.\d{2}(?:-[0-9a-f]{6})?_(manual|scheduled|pre-restore)\.zip$/;

export function kindFromName(name: string): BackupKind | null {
  const match = BACKUP_NAME_RE.exec(name);
  return match ? (match[1] as BackupKind) : null;
}
