import { logger } from "./logger.js";
import { connectSqlite } from "./db/connect-sqlite.js";
import { connectPostgres } from "./db/connect-postgres.js";
import { connectPglite } from "./db/connect-pglite.js";
import type { AppDatabase, Dialect } from "./db/types.js";

export type { AppDatabase, Dialect } from "./db/types.js";

/**
 * Pick the database backend.
 *
 * SQLite is the default and stays completely zero-config: an existing install
 * that sets only SQLITE_DB_PATH -- or nothing at all -- behaves exactly as before.
 *
 * The dialect is NOT inferred from the presence of DATABASE_URL. Questarr ran on
 * Postgres before v1.1 (see docs/MIGRATION.md), so a long-running install may
 * still carry a stale DATABASE_URL pointing at a dead or pre-v1.1 database.
 * Inferring would silently swap a live SQLite library for that one on upgrade,
 * which is a data-loss-class regression. Opting in has to be explicit.
 */
function resolveDialect(): Dialect {
  const requested = (process.env.DB_DIALECT ?? "").trim().toLowerCase();

  if (requested === "" || requested === "sqlite") {
    if (process.env.DATABASE_URL) {
      logger.warn(
        "DATABASE_URL is set but DB_DIALECT is not 'postgres' -- continuing on SQLite. " +
          "Set DB_DIALECT=postgres to use the Postgres backend."
      );
    }
    return "sqlite";
  }

  if (requested === "postgres" || requested === "postgresql") {
    if (process.env.SQLITE_DB_PATH) {
      logger.warn("DB_DIALECT=postgres -- ignoring SQLITE_DB_PATH.");
    }
    return "postgres";
  }

  logger.error(`Unknown DB_DIALECT '${process.env.DB_DIALECT}'. Valid values: sqlite, postgres.`);
  process.exit(1);
}

/**
 * Which driver to construct.
 *
 * QUESTARR_DB_DRIVER is an internal, undocumented escape hatch for tests -- it
 * is deliberately absent from .env.example. It exists so the test harness can
 * run the Postgres code path in-process via PGlite. Because it selects the
 * driver rather than merely the dialect, it also decides the dialect: a Postgres
 * driver paired with SQLite table objects would build the wrong SQL.
 */
type Driver = "better-sqlite3" | "node-postgres" | "pglite";

function resolveDriver(): Driver {
  const override = process.env.QUESTARR_DB_DRIVER;
  if (override === "pglite" || override === "node-postgres" || override === "better-sqlite3") {
    return override;
  }
  if (override) {
    logger.error(
      `Unknown QUESTARR_DB_DRIVER '${override}'. Valid values: better-sqlite3, node-postgres, pglite.`
    );
    process.exit(1);
  }
  return resolveDialect() === "postgres" ? "node-postgres" : "better-sqlite3";
}

const driver: Driver = resolveDriver();

/** Which backend is active. */
export const dialect: Dialect = driver === "better-sqlite3" ? "sqlite" : "postgres";

const connection =
  driver === "pglite"
    ? await connectPglite()
    : driver === "node-postgres"
      ? connectPostgres()
      : connectSqlite();

/**
 * The Drizzle handle.
 *
 * Typed against the SQLite schema regardless of the active backend -- see
 * server/db/types.ts for why that is sound. Table objects must come from
 * server/db/tables.ts, never directly from shared/schema.ts, so that queries
 * are built against the active dialect's tables.
 */
export const db: AppDatabase = connection.db;

/** The underlying driver handle. Only SQLite-pinned tests use this. */
export const pool = connection.pool;

/**
 * Verify the database is reachable.
 *
 * Callers must not reach for a driver-specific escape hatch (better-sqlite3's
 * `.get()` has no node-postgres equivalent), so the liveness check lives here
 * behind one name.
 */
export async function pingDatabase(): Promise<void> {
  await connection.ping();
}

/** Release driver resources. A no-op on SQLite; ends the pool on Postgres. */
export async function closeDatabase(): Promise<void> {
  await connection.close();
  logger.info(
    dialect === "postgres"
      ? "Postgres connection pool closed"
      : "Database connection closed (noop for sqlite)"
  );
}
