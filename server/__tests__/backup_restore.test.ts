import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

let tmp: string;

vi.mock("../config-loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config-loader.js")>();
  return {
    ...actual,
    configLoader: new Proxy(actual.configLoader, {
      get: (target, prop, receiver) =>
        prop === "getConfigDir"
          ? () => process.env.TEST_CONFIG_DIR
          : Reflect.get(target, prop, receiver),
    }),
  };
});
vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-backup-"));
  process.env.TEST_CONFIG_DIR = path.join(tmp, "data");
  process.env.BACKUP_DIR = path.join(tmp, "data", "backups");
  fs.mkdirSync(process.env.TEST_CONFIG_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.BACKUP_DIR;
  delete process.env.TEST_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function zipOf(file: string, entries: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const archive = new ZipArchive();
    out.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(out);
    for (const [name, body] of Object.entries(entries)) archive.append(body, { name });
    void archive.finalize();
  });
}

describe("zip safety helpers", () => {
  it("rejects names that could escape the extraction directory", async () => {
    const { isSafeEntryName } = await import("../backup/zip-utils.js");
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "./a", "a\0b"]) {
      expect(isSafeEntryName(bad), bad).toBe(false);
    }
    for (const good of ["manifest.json", "database/sqlite.db", "screenshots/g1/a.png"]) {
      expect(isSafeEntryName(good), good).toBe(true);
    }
  });

  it("resolves only well-formed backup names", async () => {
    vi.resetModules();
    process.env.QUESTARR_DB_DRIVER = "pglite";
    const { resolveBackupPath } = await import("../backup/backup-service.js");
    expect(resolveBackupPath("../../etc/passwd")).toBeNull();
    expect(
      resolveBackupPath("questarr_backup_v1.6.0_2026.11.13_10.00.00_manual.zip/../x")
    ).toBeNull();
    expect(resolveBackupPath("questarr_backup_v1.6.0_2026.11.13_10.00.00_manual.zip")).toContain(
      "backups"
    );
  });
});

describe.each(activeTestDialects())("backup and restore on %s", (name) => {
  let t: TestDb;

  beforeEach(async () => {
    if (name === "sqlite") {
      // A real file, so the restore can swap it the way it does at boot.
      process.env.TEST_DB_FILE = path.join(tmp, "data", "sqlite.db");
    }
    t = await setupTestDb(name, process.env.TEST_DB_FILE);
  });

  afterEach(async () => {
    await t?.teardown();
    delete process.env.TEST_DB_FILE;
  });

  async function seed() {
    const { db } = await import("../db.js");
    const tables = await import("../db/tables.js");
    await db
      .insert(tables.users)
      .values({ id: "u1", username: "alice", passwordHash: "hash" } as never);
    await db.insert(tables.games).values({
      id: "g1",
      userId: "u1",
      igdbId: 7346,
      title: "Zelda Breath",
      status: "wanted",
      hidden: true,
      platforms: ["Switch"],
      rating: 97.25,
      addedAt: new Date("2026-01-02T03:04:05.000Z"),
    } as never);
    return { db, tables };
  }

  it("creates an archive with a manifest, checksums and row counts, and lists it", async () => {
    await seed();
    const svc = await import("../backup/backup-service.js");
    const created = await svc.createBackup("manual");

    expect(created.manifest.dialect).toBe(t.dialect === "sqlite" ? "sqlite" : "postgres");
    expect(created.manifest.tables.users).toBe(1);
    expect(created.manifest.tables.games).toBe(1);
    expect(created.manifest.migrations.applied).toBeGreaterThan(0);
    expect(created.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(fs.statSync(path.join(process.env.BACKUP_DIR!, created.name)).mode & 0o077).toBe(0);

    const list = await svc.listBackups();
    expect(list).toHaveLength(1);
    expect(list[0]!.manifest?.appVersion).toBe(svc.getAppVersion());
    expect(await svc.deleteBackup(created.name)).toBe(true);
    expect(await svc.listBackups()).toHaveLength(0);
  });

  it("does not leave work directories behind and refuses concurrent runs", async () => {
    const svc = await import("../backup/backup-service.js");
    const first = svc.createBackup("manual");
    await expect(svc.createBackup("manual")).rejects.toThrow(/already running/);
    await first;
    const leftovers = fs.readdirSync(process.env.BACKUP_DIR!).filter((f) => f.startsWith(".work"));
    expect(leftovers).toEqual([]);
  });

  it("prunes old scheduled backups but keeps manual ones and the newest scheduled", async () => {
    const svc = await import("../backup/backup-service.js");
    const dir = process.env.BACKUP_DIR!;
    fs.mkdirSync(dir, { recursive: true });
    const old = Date.now() - 40 * 86_400_000;
    const mk = (stamp: string, kind: string, mtime: number) => {
      const f = path.join(dir, `questarr_backup_v1.0.0_${stamp}_${kind}.zip`);
      fs.writeFileSync(f, "x");
      fs.utimesSync(f, mtime / 1000, mtime / 1000);
      return path.basename(f);
    };
    const oldScheduled = mk("2026.01.01_00.00.00", "scheduled", old);
    const oldestScheduled = mk("2025.12.01_00.00.00", "scheduled", old - 86_400_000);
    const oldManual = mk("2026.01.02_00.00.00", "manual", old);
    const removed = await svc.applyRetention(28);
    expect(removed).toEqual([oldestScheduled]);
    expect(fs.existsSync(path.join(dir, oldScheduled))).toBe(true);
    expect(fs.existsSync(path.join(dir, oldManual))).toBe(true);
  });

  it("round-trips the data through a staged restore", async () => {
    const { db, tables } = await seed();
    const svc = await import("../backup/backup-service.js");
    const restore = await import("../backup/restore.js");
    const { eq } = await import("drizzle-orm");
    const created = await svc.createBackup("manual");
    const before = await db.select().from(tables.games);

    // Change the data after the backup.
    await db.delete(tables.games).where(eq(tables.games.id, "g1"));
    await db.delete(tables.users).where(eq(tables.users.id, "u1"));

    await restore.stageRestore(path.join(process.env.BACKUP_DIR!, created.name), created.name);
    // The safety copy of the state being replaced.
    expect((await svc.listBackups()).some((b) => b.kind === "pre-restore")).toBe(true);

    if (name === "sqlite") {
      const { pool } = await import("../db.js");
      pool.close();
      vi.resetModules();
      const boot = await import("../backup/restore-boot.js");
      expect(boot.applyPendingSqliteRestore()).toBe(true);
      const file = new Database(process.env.TEST_DB_FILE!, { readonly: true });
      const rows = file.prepare("SELECT id, title, hidden FROM games").all();
      file.close();
      expect(rows).toEqual([{ id: "g1", title: "Zelda Breath", hidden: 1 }]);
      expect(fs.existsSync(`${process.env.TEST_DB_FILE}.pre-restore`)).toBe(true);
      expect(boot.readPendingRestore()).toBeNull();
    } else {
      expect(await restore.applyPendingPostgresRestore()).toBe(true);
      const after = await db.select().from(tables.games);
      expect(after).toEqual(before);
      expect(after[0]!.addedAt).toBeInstanceOf(Date);
    }
  });

  it("refuses a backup from a newer Questarr and a tampered one", async () => {
    await seed();
    const svc = await import("../backup/backup-service.js");
    const restore = await import("../backup/restore.js");
    const created = await svc.createBackup("manual");
    const good = path.join(process.env.BACKUP_DIR!, created.name);

    const manifest = { ...created.manifest, migrations: { applied: 9999, latest: null } };
    const newer = path.join(tmp, "newer.zip");
    await zipOf(newer, { "manifest.json": JSON.stringify(manifest) });
    await expect(restore.stageRestore(newer, "t")).rejects.toThrow(/newer Questarr/);

    const crossDialect = path.join(tmp, "cross.zip");
    await zipOf(crossDialect, {
      "manifest.json": JSON.stringify({
        ...created.manifest,
        dialect: name === "sqlite" ? "postgres" : "sqlite",
      }),
    });
    await expect(restore.stageRestore(crossDialect, "t")).rejects.toThrow(
      /across database engines/
    );

    const tampered = path.join(tmp, "tampered.zip");
    const entry = created.manifest.files[0]!;
    await zipOf(tampered, {
      "manifest.json": JSON.stringify(created.manifest),
      [entry.path]: "not the original bytes",
    });
    // The other entries are missing and the one present has a different hash.
    await expect(restore.stageRestore(tampered, "t")).rejects.toThrow(/missing|corrupt/);

    const notABackup = path.join(tmp, "plain.zip");
    await zipOf(notABackup, { "readme.txt": "hi" });
    await expect(restore.stageRestore(notABackup, "t")).rejects.toThrow(/manifest.json/);

    // Nothing was staged by any of the failures, and the good archive still stages.
    expect(fs.existsSync(path.join(process.env.BACKUP_DIR!, ".restore-pending"))).toBe(false);
    await restore.stageRestore(good, "t");
  });
});
