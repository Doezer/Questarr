import { vi } from "vitest";

export type TestDialect = "sqlite" | "pglite";

/**
 * Which dialects the suite should run against.
 *
 * Defaults to both: SQLite alone would let a Postgres-only regression reach CI,
 * and PGlite is in-process so it costs a WASM boot rather than a container.
 * Narrow it with TEST_DIALECTS=sqlite when iterating locally.
 */
export function activeTestDialects(): TestDialect[] {
  const raw = process.env.TEST_DIALECTS;
  if (!raw) return ["sqlite", "pglite"];
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is TestDialect => d === "sqlite" || d === "pglite");
}

export interface TestDb {
  storage: typeof import("../../storage.js").storage;
  dialect: string;
  teardown: () => Promise<void>;
}

/**
 * Boot a fresh, migrated database for one dialect.
 *
 * server/db.ts picks its driver once at module load, so the environment has to
 * be set before the module graph is re-imported -- hence resetModules() and the
 * dynamic imports.
 */
export async function setupTestDb(dialect: TestDialect): Promise<TestDb> {
  vi.resetModules();

  if (dialect === "pglite") {
    process.env.QUESTARR_DB_DRIVER = "pglite";
    delete process.env.DB_DIALECT;
    delete process.env.SQLITE_DB_PATH;
  } else {
    delete process.env.QUESTARR_DB_DRIVER;
    delete process.env.DB_DIALECT;
    process.env.SQLITE_DB_PATH = ":memory:";
  }

  const dbModule = await import("../../db.js");
  const { runMigrations } = await import("../../migrate.js");
  await runMigrations();
  const { storage } = await import("../../storage.js");

  return {
    storage,
    dialect: dbModule.dialect,
    teardown: () => dbModule.closeDatabase(),
  };
}
