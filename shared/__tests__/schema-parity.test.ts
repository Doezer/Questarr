import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName, SQL, type Table } from "drizzle-orm";
import * as sqliteSchema from "../schema.js";
import * as pgSchema from "../schema.pg.js";

/**
 * Runtime proof that the SQLite and Postgres schemas describe the same tables.
 *
 * shared/schema-parity.ts already proves the two infer identical TypeScript
 * shapes. That check cannot see SQL column names, nullability or defaults -- a
 * typo'd snake_case name or a dropped .notNull() widens to the same TS type and
 * would sail past the compiler, then fail against a real Postgres database.
 *
 * Both guards exist because server/db/tables.ts casts one schema to the other.
 */

/**
 * Every table both schemas must define. Hard-coded on purpose: comparing the
 * two schemas against each other would pass if a table were missing from BOTH.
 */
const EXPECTED_TABLES = [
  "apiKeys",
  "downloaders",
  "gameDownloads",
  "gameFiles",
  "games",
  "importTaskItems",
  "importTasks",
  "indexers",
  "notifications",
  "pathMappings",
  "platformMappings",
  "releaseBlacklist",
  "rootFolders",
  "rssFeedItems",
  "rssFeeds",
  "systemConfig",
  "userSettings",
  "users",
  "xrelNotifiedReleases",
] as const;

type TableExport = (typeof EXPECTED_TABLES)[number];

/**
 * Exports that are not tables in their own right but aliases of one, kept for
 * backward compatibility. Both schemas must carry them so the two modules stay
 * drop-in interchangeable.
 */
const TABLE_ALIASES: Record<string, TableExport> = {
  legacy_gameDownloads: "gameDownloads",
};

function tablesIn(schema: Record<string, unknown>): string[] {
  return Object.entries(schema)
    .filter(
      ([, v]) => typeof v === "object" && v !== null && getTableName(v as Table) !== undefined
    )
    .map(([k]) => k)
    .filter((k) => !(k in TABLE_ALIASES))
    .sort();
}

describe("SQLite/Postgres schema parity", () => {
  it("both schemas export exactly the expected tables", () => {
    expect(tablesIn(sqliteSchema as unknown as Record<string, unknown>)).toEqual([
      ...EXPECTED_TABLES,
    ]);
    expect(tablesIn(pgSchema as unknown as Record<string, unknown>)).toEqual([...EXPECTED_TABLES]);
  });

  it.each(Object.entries(TABLE_ALIASES))(
    "%s aliases the same table in both schemas",
    (alias, target) => {
      expect(sqliteSchema[alias as keyof typeof sqliteSchema]).toBe(
        sqliteSchema[target as keyof typeof sqliteSchema]
      );
      expect(pgSchema[alias as keyof typeof pgSchema]).toBe(
        pgSchema[target as keyof typeof pgSchema]
      );
    }
  );

  describe.each(EXPECTED_TABLES)("%s", (tableName: TableExport) => {
    const sqliteTable = sqliteSchema[tableName] as Table;
    const pgTable = pgSchema[tableName] as Table;

    it("maps to the same SQL table name", () => {
      expect(getTableName(pgTable)).toBe(getTableName(sqliteTable));
    });

    it("declares the same SQL column names", () => {
      const sqliteCols = Object.values(getTableColumns(sqliteTable))
        .map((c) => c.name)
        .sort();
      const pgCols = Object.values(getTableColumns(pgTable))
        .map((c) => c.name)
        .sort();
      expect(pgCols).toEqual(sqliteCols);
    });

    it("agrees on nullability, defaults and primary keys per column", () => {
      // A SQL-expression default (e.g. "now" as epoch milliseconds) is spelled
      // differently per dialect by design -- see shared/schema.pg.ts -- so only
      // "both have a computed default" is compared, not the exact SQL text.
      // A literal default (true/false/0/"manual"/[]) is compared for real: that
      // kind of drift is exactly what hasDefault alone can't see.
      const normalizeDefault = (value: unknown) =>
        value instanceof SQL ? "<sql-expression>" : value;

      const describeCols = (t: Table) =>
        Object.fromEntries(
          Object.entries(getTableColumns(t)).map(([key, c]) => [
            key,
            {
              name: c.name,
              notNull: c.notNull,
              hasDefault: c.hasDefault,
              primary: c.primary,
              default: normalizeDefault(c.default),
            },
          ])
        );
      expect(describeCols(pgTable)).toEqual(describeCols(sqliteTable));
    });
  });
});
