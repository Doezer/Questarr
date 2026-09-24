/**
 * Copy an existing SQLite library into a Postgres database.
 *
 * Usage:
 *   SQLITE_DB_PATH=./data/sqlite.db \
 *   DATABASE_URL=postgres://questarr:pw@localhost:5432/questarr \
 *   npx tsx scripts/sqlite-to-pg.ts [--force] [--batch-size=500]
 *
 * Run this with Questarr STOPPED, against a Postgres database that has already
 * been migrated (`DB_DIALECT=postgres npm run db:migrate`). The target must be
 * empty unless --force is passed.
 *
 * Note this is the opposite direction to scripts/pg-to-sqlite.ts, which belongs
 * to the one-time v1.1 move off Postgres. That script carries a per-table column
 * map because the schema it reads predates several renames. This one needs none:
 * both schemas are generated from the same definitions and proven structurally
 * identical by shared/schema-parity.ts, so rows can be read through Drizzle with
 * the SQLite schema and written back through Drizzle with the Postgres schema.
 * Drizzle decodes and re-encodes each column, which is what converts SQLite's
 * integer booleans, epoch-millisecond timestamps and TEXT JSON into Postgres
 * booleans, bigints and jsonb without a hand-written transform per column.
 */
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import pg from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as sqliteSchema from "../shared/schema.js";
import * as pgSchema from "../shared/schema.pg.js";

/**
 * Tables in foreign-key-safe order: a table never appears before something it
 * references. Hard-coded rather than derived so the order is reviewable.
 */
const TABLE_ORDER = [
  // No foreign keys.
  "users",
  "pathMappings",
  "platformMappings",
  "systemConfig",
  "rootFolders",
  "indexers",
  "downloaders",
  "rssFeeds",
  // Reference the above.
  "userSettings",
  "games",
  "notifications",
  "apiKeys",
  "importTasks",
  "rssFeedItems",
  // Reference games / downloaders / importTasks.
  "gameDownloads",
  "xrelNotifiedReleases",
  "releaseBlacklist",
  "importTaskItems",
  // References games and gameDownloads, so it goes last.
  "gameFiles",
] as const;

type TableName = (typeof TABLE_ORDER)[number];

function parseArgs() {
  const args = process.argv.slice(2);
  const batchArg = args.find((a) => a.startsWith("--batch-size="));
  return {
    force: args.includes("--force"),
    batchSize: batchArg ? Number(batchArg.split("=")[1]) : 500,
  };
}

export interface MigrateResult {
  /** Per table: rows found in SQLite and rows present in Postgres afterwards. */
  counts: Record<string, { read: number; written: number; verified: number }>;
  mismatched: string[];
}

/** Rows already present in the target, by table. Empty means a clean target. */
export async function findExistingRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dst: any
): Promise<Array<{ table: string; rows: number }>> {
  const existing: Array<{ table: string; rows: number }> = [];
  for (const name of TABLE_ORDER) {
    // A bare count() aggregate with no GROUP BY always returns exactly one row,
    // even over an empty table.
    const [row] = await dst
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(pgSchema[name as TableName]);
    if (row!.n > 0) existing.push({ table: name, rows: row!.n });
  }
  return existing;
}

/**
 * Copy every table from SQLite into Postgres in foreign-key-safe order, then
 * reconcile by counting rows in the target rather than trusting the write loop.
 */
export async function copyAllTables(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  src: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dst: any,
  options: { batchSize?: number; onProgress?: (table: string, rows: number) => void } = {}
): Promise<MigrateResult> {
  const batchSize = options.batchSize ?? 500;
  // main() validates its own --batch-size flag, but this function is exported
  // and called directly by tests, so a bad value must not reach the loop
  // below: 0 never advances `i` and hangs forever, and a non-integer or
  // negative value is just as broken.
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be a positive integer, got: ${batchSize}`);
  }
  const counts: MigrateResult["counts"] = {};

  // Snapshot how many rows each table already holds before writing anything.
  // With --force the target isn't empty, so "did every row land" has to be
  // checked against this baseline plus what we're about to copy -- comparing
  // against the source count alone would report a false mismatch on every
  // table that already had rows.
  const baseline: Record<string, number> = {};
  for (const name of TABLE_ORDER) {
    // A bare count() aggregate with no GROUP BY always returns exactly one row,
    // even over an empty table.
    const [row] = await dst
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(pgSchema[name as TableName]);
    baseline[name] = row!.n;
  }

  for (const name of TABLE_ORDER) {
    const rows = await src.select().from(sqliteSchema[name as TableName]);
    counts[name] = { read: rows.length, written: 0, verified: 0 };

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await dst.insert(pgSchema[name as TableName]).values(batch);
      counts[name].written += batch.length;
    }
    options.onProgress?.(name, counts[name].written);
  }

  const mismatched: string[] = [];
  for (const name of TABLE_ORDER) {
    // A bare count() aggregate with no GROUP BY always returns exactly one row,
    // even over an empty table.
    const [row] = await dst
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(pgSchema[name as TableName]);
    // Every name in TABLE_ORDER got a `counts` entry in the loop above, and a
    // `baseline` entry in the loop below, before either is ever read here.
    counts[name]!.verified = row!.n;
    if (row!.n !== baseline[name]! + counts[name]!.read) mismatched.push(name);
  }

  return { counts, mismatched };
}

async function main() {
  const { force, batchSize } = parseArgs();

  const sqlitePath = process.env.SQLITE_DB_PATH;
  const databaseUrl = process.env.DATABASE_URL;
  if (!sqlitePath || !databaseUrl) {
    console.error("Both SQLITE_DB_PATH and DATABASE_URL must be set.");
    process.exit(1);
  }
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    console.error(`--batch-size must be a positive number, got: ${batchSize}`);
    process.exit(1);
  }

  // Validate the connection string without keeping anything derived from it.
  // Nothing parsed out of DATABASE_URL is logged, not even the host: it carries
  // credentials, naive masking breaks on a password containing "@" or "/", and
  // credentials can also arrive as query parameters. The driver's own error
  // names the host it tried, which is all the diagnostics this needs.
  try {
    void new URL(databaseUrl);
  } catch {
    console.error("DATABASE_URL is not a valid connection URL.");
    process.exit(1);
  }

  const sqliteClient = new Database(sqlitePath, { readonly: true });
  const src = drizzleSqlite(sqliteClient, { schema: sqliteSchema });

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const dst = drizzlePg(pool, { schema: pgSchema });

  // Fail early and clearly rather than part-way through the copy. Queried
  // through the pool rather than Drizzle so the failure surfaces as the pg
  // driver's own message ("connect ECONNREFUSED <host>:<port>") instead of
  // Drizzle's wrapper, which hides which server was unreachable.
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(`Cannot connect to Postgres: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Source: ${sqlitePath}\n`);

  // Refuse to merge into a database that already holds data: primary key
  // collisions would half-succeed and leave a mess.
  const existing = await findExistingRows(dst);
  if (existing.length > 0) {
    if (!force) {
      console.error("Target database is not empty:");
      for (const e of existing) console.error(`  ${e.table} (${e.rows})`);
      console.error("\nRefusing to continue. Re-run with --force to insert anyway.");
      process.exit(1);
    }
    console.warn(`--force: target already holds rows in ${existing.length} table(s)\n`);
  }

  const { counts, mismatched } = await copyAllTables(src, dst, {
    batchSize,
    onProgress: (table, rows) => console.log(`  ${table.padEnd(24)} ${rows} row(s)`),
  });

  console.log("\nReconciliation:");
  for (const name of TABLE_ORDER) {
    // copyAllTables() populates a `counts` entry for every name in TABLE_ORDER.
    const c = counts[name]!;
    const ok = c.verified === c.read;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${name.padEnd(24)} sqlite=${c.read} postgres=${c.verified}`
    );
  }

  await pool.end();
  sqliteClient.close();

  if (mismatched.length > 0) {
    console.error(
      `\n${mismatched.length} table(s) did not match (${mismatched.join(", ")}). ` +
        "The target is NOT a faithful copy."
    );
    process.exit(1);
  }
  console.log("\nMigration complete. Start Questarr with DB_DIALECT=postgres.");
}

// Only run when invoked directly, so the exports above can be imported by tests.
if (process.argv[1]?.includes("sqlite-to-pg")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
