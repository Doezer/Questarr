import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { dialect } from "./db.js";

/**
 * Cross-dialect SQL helpers.
 *
 * Most of storage.ts is written with Drizzle's dialect-neutral query builder and
 * needs nothing from here. These are the constructs that have no single spelling
 * working on both SQLite and Postgres. Keeping them behind these helpers means a
 * dialect difference is fixed in one place rather than at a dozen call sites.
 */

/**
 * Case-insensitive substring match.
 *
 * Callers pass a BARE term -- this helper does the `%` wrapping and the
 * lower-casing, so the two halves cannot drift apart.
 *
 * SQLite's LIKE is already case-insensitive for ASCII but Postgres's is not,
 * which is exactly the kind of difference that would otherwise surface as
 * "search works on my machine". Postgres gets ILIKE.
 *
 * The ::text cast matters: the searchable JSON columns (games.genres,
 * games.platforms) are TEXT on SQLite but JSONB on Postgres, and Postgres will
 * not apply a string operator to jsonb. Casting yields the same JSON text
 * SQLite stores, so a substring match behaves identically on both.
 */
export function containsCI(column: AnyColumn, term: string): SQL {
  // `%` and `_` are LIKE/ILIKE metacharacters and `\` is the escape character
  // below, so a term containing any of them must have that character escaped
  // or it would match more (or less) than its literal text.
  const escaped = term.toLowerCase().replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  return dialect === "postgres"
    ? sql`${column}::text ILIKE ${pattern} ESCAPE '\\'`
    : sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`;
}

/**
 * Concatenate the distinct values of a column into one comma-separated string.
 *
 * SQLite's group_concat(DISTINCT x) cannot take a custom separator and defaults
 * to ",". Postgres's string_agg requires one, so it is given "," explicitly and
 * the two produce the same string -- consumers keep calling .split(",").
 */
export function distinctJoin(column: AnyColumn): SQL<string> {
  return dialect === "postgres"
    ? sql<string>`string_agg(DISTINCT ${column}::text, ',')`
    : sql<string>`group_concat(DISTINCT ${column})`;
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
