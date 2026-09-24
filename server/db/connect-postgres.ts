import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as pgSchema from "../../shared/schema.pg.js";
import { logger } from "../logger.js";
import type { AppDatabase, DatabaseConnection } from "./types.js";

const { Pool } = pg;

/**
 * Postgres backend -- opt in with DB_DIALECT=postgres.
 *
 * Unlike SQLite there is no file to create or permission to check: the failure
 * modes here are network, authentication and a missing database, so the
 * diagnostics below target those instead.
 */
export function connectPostgres(): DatabaseConnection {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error(
      "DB_DIALECT=postgres requires DATABASE_URL to be set, " +
        "e.g. postgres://questarr:password@localhost:5432/questarr"
    );
    process.exit(1);
  }

  const max = Number(process.env.DATABASE_POOL_MAX ?? 10);
  // runPgMigrations() checks out one connection for the whole run to hold the
  // migration advisory lock, then migrate() needs a second one from the same
  // pool to apply migrations. A pool of 1 deadlocks startup silently: the lock
  // holder never releases, migrate() waits forever for a connection that will
  // never free up.
  if (!Number.isFinite(max) || max < 2) {
    logger.error(`DATABASE_POOL_MAX must be at least 2, got: ${process.env.DATABASE_POOL_MAX}`);
    process.exit(1);
  }

  // Log the target without leaking the password.
  let target = "postgres";
  try {
    const parsed = new URL(connectionString);
    target = `${parsed.host}${parsed.pathname}`;
  } catch {
    logger.error("DATABASE_URL is not a valid connection URL");
    process.exit(1);
  }
  logger.info(`Initializing Postgres database at: ${target}`);

  // Without these, a stalled server leaves pingDatabase() (and anything else
  // that borrows from the pool) pending forever: a route-level timeout alone
  // can't help, since it would return a response while the query keeps
  // running underneath. connectionTimeoutMillis bounds the wait for a pool
  // slot; statement_timeout bounds the query itself once it has one.
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });

  // An idle client erroring (server restart, network blip) would otherwise be an
  // unhandled 'error' event and take the process down.
  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected error on idle Postgres client");
  });

  const db = drizzle(pool, { schema: pgSchema });

  return {
    // See server/db/types.ts: the app types against the SQLite schema, and the
    // two schemas are proven interchangeable by the parity guards.
    db: db as unknown as AppDatabase,
    pool: pool as unknown as import("better-sqlite3").Database,
    ping: async () => {
      try {
        await db.execute(sql`SELECT 1`);
      } catch (err) {
        // Drizzle wraps driver errors, so the pg error code may be one level down.
        const e = err as { code?: string; cause?: { code?: string } };
        const code = e?.code ?? e?.cause?.code;
        const hint =
          code === "ECONNREFUSED"
            ? `Nothing is listening at ${target}. Is the Postgres server running and reachable?`
            : code === "28P01"
              ? "Authentication failed. Check the username and password in DATABASE_URL."
              : code === "3D000"
                ? "That database does not exist. Create it before starting Questarr."
                : "Check DATABASE_URL and that the server is reachable.";
        logger.error({ err, target }, `Cannot connect to Postgres at ${target}. ${hint}`);
        throw err;
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
