import { sql, type SQL, type AnyColumn } from "drizzle-orm";

/**
 * Cross-dialect SQL helpers.
 *
 * Most of `storage.ts` is written with Drizzle's dialect-neutral query builder
 * and needs nothing from this module. These are the few constructs that have no
 * single spelling which works on both SQLite and Postgres.
 *
 * Currently SQLite-only; the Postgres branches land with the connection factory
 * (see docs/DATABASE.md). Keeping them behind these helpers means the dialect
 * switch touches this file instead of a dozen call sites in storage.ts.
 */

/**
 * Case-insensitive substring match.
 *
 * Callers pass a BARE term -- this helper does the `%` wrapping and the
 * lower-casing, so the two halves can never drift apart.
 *
 * SQLite's LIKE is already case-insensitive for ASCII, but the explicit
 * `lower()` on both sides keeps the behaviour identical for non-ASCII titles
 * and matches what Postgres's ILIKE will do.
 */
export function containsCI(column: AnyColumn, term: string): SQL {
  const pattern = `%${term.toLowerCase()}%`;
  return sql`lower(${column}) LIKE ${pattern}`;
}

/**
 * Concatenate the distinct values of a column into one comma-separated string.
 *
 * SQLite's `group_concat(DISTINCT x)` cannot take a custom separator and
 * defaults to ",". Postgres's equivalent is `string_agg(DISTINCT x, ',')`,
 * which produces the same string, so consumers can keep calling `.split(",")`.
 */
export function distinctJoin(column: AnyColumn): SQL<string> {
  return sql<string>`group_concat(DISTINCT ${column})`;
}

/**
 * Number of rows affected by an INSERT/UPDATE/DELETE.
 *
 * better-sqlite3 reports this as `changes`; node-postgres reports it as
 * `rowCount`. Reading whichever is present keeps call sites dialect-blind.
 */
export function affectedRows(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const r = result as { changes?: number; rowCount?: number | null };
  return r.changes ?? r.rowCount ?? 0;
}
