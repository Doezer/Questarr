import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, pool } from "../db.js";
import { logger } from "../logger.js";

/**
 * Arbitrary, fixed key for Questarr's migration advisory lock. Advisory locks
 * are keyed by a single bigint and are visible to every session on the
 * database, so any two Questarr instances contend for this same key
 * regardless of which one grabs it first. The value has no meaning beyond
 * being stable across releases.
 */
const MIGRATION_LOCK_KEY = 72_733_629_381;

/**
 * The bit of `pg.Pool` and PGlite that this module needs, so both drivers can
 * take the same lock/unlock path below.
 */
interface LockableConnection {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release?: () => void;
}

/** True for a real `pg.Pool` (has a connection to check out); false for PGlite. */
function hasConnect(p: unknown): p is { connect(): Promise<LockableConnection> } {
  return typeof (p as { connect?: unknown }).connect === "function";
}

/**
 * Postgres migration runner.
 *
 * Drizzle's migrator reads migration state and applies pending files
 * transactionally, tracking them by hash -- but it takes no lock of its own.
 * Two Questarr instances starting at once could both see the same pending
 * migration and double-apply it. A database-wide advisory lock, held on one
 * dedicated connection for the whole run, serializes concurrent starts: the
 * second instance blocks here until the first finishes and commits its
 * migration records.
 *
 * Note what is deliberately absent: the schema-drift repair in
 * server/db/migrate-sqlite.ts is not ported here, and should not be. That code
 * exists to patch installs that ran an intermediate build before a migration
 * file existed -- a situation with no Postgres equivalent, because Postgres
 * support shipped with a single baseline migration and every Postgres install
 * is therefore greenfield.
 *
 * Also runs under QUESTARR_DB_DRIVER=pglite (tests): PGlite has no connection
 * pool to check out from, it IS the one connection, so the lock and unlock
 * below simply run on it directly -- pg_advisory_unlock must run on the exact
 * session that took the lock, which a pool's own .query() does not guarantee.
 */
export async function runPgMigrations(): Promise<void> {
  logger.info("Running Postgres migrations...");

  const rawPool = pool as unknown as LockableConnection;
  const client: LockableConnection = hasConnect(rawPool) ? await rawPool.connect() : rawPool;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await migrate(db as unknown as NodePgDatabase, { migrationsFolder: "migrations-pg" });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    client.release?.();
  }

  logger.info("Postgres migrations completed successfully");
}
