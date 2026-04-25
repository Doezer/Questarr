import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../shared/schema";

// ─── Shared in-memory database ────────────────────────────────────────────────
// A single in-memory instance is reused across tests; each beforeEach wipes and
// re-creates the relevant tables so every test starts from a known state.

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = OFF");
const db = drizzle(sqlite, { schema });

vi.mock("../db.js", () => ({ db, pool: sqlite }));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Provide a minimal empty migrations journal so runMigrations() is a no-op.
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockImplementation((p: string) => {
      if (String(p).includes("_journal")) {
        return JSON.stringify({ entries: [] });
      }
      return "";
    }),
  },
}));

vi.mock("path", () => ({
  default: {
    resolve: vi.fn((...args: string[]) => args.join("/")),
    join: vi.fn((...args: string[]) => args.join("/")),
    dirname: vi.fn((p: string) => p.split("/").slice(0, -1).join("/")),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dropTable(name: string) {
  sqlite.exec(`DROP TABLE IF EXISTS \`${name}\``);
}

function dropIndex(name: string) {
  sqlite.exec(`DROP INDEX IF EXISTS \`${name}\``);
}

/** Create the minimal v1.2.2 tables that REPAIRS_V1_3_0 inspects. */
function createBaseTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS \`__drizzle_migrations\` (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL UNIQUE,
      created_at integer
    );
    CREATE TABLE IF NOT EXISTS \`users\` (
      id text PRIMARY KEY NOT NULL,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS \`user_settings\` (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS \`games\` (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS \`game_downloads\` (
      id text PRIMARY KEY NOT NULL,
      game_id text NOT NULL
    );
  `);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("repairSchemaForV1_3_0 (via ensureDatabase)", () => {
  beforeEach(() => {
    // Reset each test to a clean slate
    for (const table of [
      "release_blacklist",
      "game_downloads",
      "games",
      "user_settings",
      "users",
      "__drizzle_migrations",
    ]) {
      dropTable(table);
    }
    dropIndex("release_blacklist_game_title_idx");
    createBaseTables();
  });

  it("adds missing columns to drifted tables", async () => {
    vi.resetModules();
    const { ensureDatabase } = await import("../migrate.js");
    await ensureDatabase();

    const userCols = sqlite
      .prepare("PRAGMA table_info(`users`)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(userCols).toContain("steam_id_64");

    const settingsCols = sqlite
      .prepare("PRAGMA table_info(`user_settings`)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(settingsCols).toContain("auto_search_unreleased");
    expect(settingsCols).toContain("preferred_platform");

    const gamesCols = sqlite
      .prepare("PRAGMA table_info(`games`)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(gamesCols).toContain("user_rating");
    expect(gamesCols).toContain("early_access");

    const dlCols = sqlite
      .prepare("PRAGMA table_info(`game_downloads`)")
      .all()
      .map((r: { name: string }) => r.name);
    expect(dlCols).toContain("file_size");
  });

  it("creates the release_blacklist table and unique index when missing", async () => {
    vi.resetModules();
    const { ensureDatabase } = await import("../migrate.js");
    await ensureDatabase();

    const tableExists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='release_blacklist'")
      .get();
    expect(tableExists).toBeDefined();

    const indexExists = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='release_blacklist_game_title_idx'"
      )
      .get();
    expect(indexExists).toBeDefined();
  });

  it("de-duplicates existing release_blacklist rows before creating the unique index", async () => {
    // Simulate a drifted database: the table already exists (from an intermediate
    // dev image) without the unique index, and has accumulated duplicate rows.
    sqlite.exec(`
      CREATE TABLE \`release_blacklist\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`game_id\` text NOT NULL,
        \`release_title\` text NOT NULL,
        \`indexer_name\` text,
        \`created_at\` integer
      );
      INSERT INTO \`release_blacklist\` VALUES ('id1', 'game-a', 'Game.Title-GRP', null, 1000);
      INSERT INTO \`release_blacklist\` VALUES ('id2', 'game-a', 'Game.Title-GRP', null, 2000);
      INSERT INTO \`release_blacklist\` VALUES ('id3', 'game-a', 'Other.Title-GRP', null, 3000);
    `);

    vi.resetModules();
    const { ensureDatabase } = await import("../migrate.js");

    // Should NOT throw despite duplicate (game_id, release_title) pairs.
    await expect(ensureDatabase()).resolves.toBeUndefined();

    const rows = sqlite.prepare("SELECT * FROM `release_blacklist`").all();
    // Two distinct (game_id, release_title) pairs remain; the duplicate is removed.
    expect(rows).toHaveLength(2);

    // The unique index must now exist.
    const indexExists = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='release_blacklist_game_title_idx'"
      )
      .get();
    expect(indexExists).toBeDefined();
  });

  it("keeps the oldest duplicate row when de-duplicating (lowest rowid)", async () => {
    sqlite.exec(`
      CREATE TABLE \`release_blacklist\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`game_id\` text NOT NULL,
        \`release_title\` text NOT NULL,
        \`indexer_name\` text,
        \`created_at\` integer
      );
      INSERT INTO \`release_blacklist\` VALUES ('keep', 'game-x', 'Dupe.Title', null, 100);
      INSERT INTO \`release_blacklist\` VALUES ('drop', 'game-x', 'Dupe.Title', null, 200);
    `);

    vi.resetModules();
    const { ensureDatabase } = await import("../migrate.js");
    await ensureDatabase();

    const remaining = sqlite.prepare("SELECT id FROM `release_blacklist`").all() as Array<{
      id: string;
    }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("keep");
  });

  it("is idempotent — running ensureDatabase twice does not throw", async () => {
    vi.resetModules();
    const { ensureDatabase } = await import("../migrate.js");
    await ensureDatabase();

    // Second run: columns and index already exist; must not throw.
    await expect(ensureDatabase()).resolves.toBeUndefined();
  });
});
