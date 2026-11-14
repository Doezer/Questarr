import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { getTableName, sql } from "drizzle-orm";
import { db } from "../db.js";
import * as tables from "../db/tables.js";
import { TABLE_ORDER, type TableName } from "../db/table-order.js";

/**
 * Logical (dialect-neutral) table export and import, used for Postgres backups so
 * no `pg_dump` binary (and no matching client version) is needed in the image.
 * One NDJSON file per table, rows exactly as Drizzle decodes them.
 */

const BATCH_SIZE = 500;
export const NDJSON_DIR = "database";

type AnyTable = Parameters<typeof getTableName>[0];

/** The minimal Drizzle surface this module needs; a Postgres handle matches it. */
interface TxLike {
  select(): { from(table: AnyTable): Promise<Record<string, unknown>[]> };
  insert(table: AnyTable): { values(rows: Record<string, unknown>[]): Promise<unknown> };
  delete(table: AnyTable): Promise<unknown>;
}
interface DbLike {
  transaction<T>(fn: (tx: TxLike) => Promise<T>, config?: Record<string, unknown>): Promise<T>;
}

function tableFor(name: TableName): AnyTable {
  return (tables as unknown as Record<string, AnyTable>)[name]!;
}

/** Tags the values JSON cannot carry (dates), so they come back as the same type. */
function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const raw = this[key];
  if (raw instanceof Date) return { $date: raw.getTime() };
  if (typeof raw === "bigint") return { $bigint: raw.toString() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object") {
    const tagged = value as { $date?: unknown; $bigint?: unknown };
    if (typeof tagged.$date === "number") return new Date(tagged.$date);
    if (typeof tagged.$bigint === "string") return BigInt(tagged.$bigint);
  }
  return value;
}

export function ndjsonFileName(table: TableName): string {
  return `${NDJSON_DIR}/${table}.ndjson`;
}

export function isNdjsonEntry(name: string): boolean {
  return TABLE_ORDER.some((t) => name === ndjsonFileName(t));
}

/** Write every table to `<destDir>/database/<table>.ndjson` from one consistent snapshot. */
export async function exportTables(destDir: string): Promise<Record<string, number>> {
  const dir = path.join(destDir, NDJSON_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  const counts: Record<string, number> = {};
  await (db as unknown as DbLike).transaction(
    async (tx) => {
      for (const name of TABLE_ORDER) {
        const rows = await tx.select().from(tableFor(name));
        const lines = rows.map((row) => JSON.stringify(row, replacer));
        await fs.promises.writeFile(
          path.join(dir, `${name}.ndjson`),
          lines.length ? lines.join("\n") + "\n" : "",
          { mode: 0o600 }
        );
        counts[name] = rows.length;
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
  return counts;
}

async function readNdjson(file: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8") });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line, reviver) as Record<string, unknown>);
  }
  return rows;
}

/**
 * Replace the content of every table with the staged NDJSON files, in one
 * transaction: any failure leaves the current data untouched.
 */
export async function importTables(sourceDir: string): Promise<Record<string, number>> {
  const dir = path.join(sourceDir, NDJSON_DIR);
  const data = new Map<TableName, Record<string, unknown>[]>();
  for (const name of TABLE_ORDER) {
    const file = path.join(dir, `${name}.ndjson`);
    // A backup made before a table existed simply has no file for it.
    data.set(name, fs.existsSync(file) ? await readNdjson(file) : []);
  }

  const counts: Record<string, number> = {};
  await (db as unknown as DbLike).transaction(async (tx) => {
    for (const name of [...TABLE_ORDER].reverse()) {
      await tx.delete(tableFor(name));
    }
    for (const name of TABLE_ORDER) {
      const rows = data.get(name)!;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        await tx.insert(tableFor(name)).values(rows.slice(i, i + BATCH_SIZE));
      }
      counts[name] = rows.length;
    }
  });
  return counts;
}

/** Row counts of the live database, by table. */
export async function countTables(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of TABLE_ORDER) {
    const [row] = await (
      db as unknown as {
        select(f: unknown): { from(t: AnyTable): Promise<Array<{ n: number }>> };
      }
    )
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(tableFor(name));
    counts[name] = row?.n ?? 0;
  }
  return counts;
}

/** The SQL table name behind a TABLE_ORDER entry. */
export function sqlTableName(name: TableName): string {
  return getTableName(tableFor(name));
}
