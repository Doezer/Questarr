import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "../../shared/schema.js";
import * as pgSchema from "../../shared/schema.pg.js";
import { copyAllTables, findExistingRows } from "../../scripts/sqlite-to-pg.js";

/**
 * Round-trips a populated SQLite library into Postgres.
 *
 * The migration relies on Drizzle decoding each column with the SQLite schema
 * and re-encoding it with the Postgres one, so the values that matter here are
 * the ones whose representation differs between the two: integer booleans,
 * epoch-millisecond timestamps, TEXT-vs-jsonb JSON, and 64-bit file sizes.
 */
describe("sqlite-to-pg migration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let src: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dst: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pglite: any;
  let sqliteClient: Database.Database;

  const addedAt = new Date("2026-01-02T03:04:05.000Z");

  beforeAll(async () => {
    sqliteClient = new Database(":memory:");
    src = drizzleSqlite(sqliteClient, { schema: sqliteSchema });
    migrateSqlite(src, { migrationsFolder: "migrations" });

    await src.insert(sqliteSchema.users).values({
      id: "u1",
      username: "alice",
      passwordHash: "hash",
    });
    await src.insert(sqliteSchema.games).values({
      id: "g1",
      userId: "u1",
      igdbId: 7346,
      title: "Zelda Breath",
      status: "downloaded",
      // Boolean stored as an integer on SQLite, native boolean on Postgres.
      hidden: true,
      earlyAccess: false,
      // JSON stored as TEXT on SQLite, jsonb on Postgres.
      platforms: ["Nintendo Switch", "Wii U"],
      genres: ["Adventure"],
      // Real: 8-byte on SQLite, must land in double precision.
      rating: 97.25,
      addedAt,
    });
    await src.insert(sqliteSchema.downloaders).values({
      id: "dl1",
      name: "qb",
      type: "qbittorrent",
      url: "http://q",
    });
    await src.insert(sqliteSchema.gameDownloads).values({
      id: "d1",
      gameId: "g1",
      downloaderId: "dl1",
      downloadType: "game",
      downloadHash: "h1",
      downloadTitle: "Zelda.iso",
      status: "completed",
      // Larger than a 32-bit integer.
      fileSize: 9_663_676_416,
    });

    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    const { migrate: migratePglite } = await import("drizzle-orm/pglite/migrator");
    pglite = new PGlite();
    dst = drizzlePglite(pglite, { schema: pgSchema });
    await migratePglite(dst, { migrationsFolder: "migrations-pg" });
  }, 60_000);

  afterAll(async () => {
    await pglite?.close();
    sqliteClient?.close();
  });

  it("reports a clean target before the copy", async () => {
    expect(await findExistingRows(dst)).toEqual([]);
  });

  it("copies every table and reconciles the row counts", async () => {
    const { counts, mismatched } = await copyAllTables(src, dst, { batchSize: 2 });

    expect(mismatched).toEqual([]);
    expect(counts.users).toMatchObject({ read: 1, written: 1, verified: 1 });
    expect(counts.games).toMatchObject({ read: 1, written: 1, verified: 1 });
    expect(counts.gameDownloads).toMatchObject({ read: 1, written: 1, verified: 1 });
    // A table with no rows is still reconciled rather than skipped.
    expect(counts.notifications).toMatchObject({ read: 0, written: 0, verified: 0 });
  });

  it("preserves values whose storage differs between the dialects", async () => {
    const [game] = await dst.select().from(pgSchema.games).where(eq(pgSchema.games.id, "g1"));

    expect(game.hidden).toBe(true);
    expect(game.earlyAccess).toBe(false);
    expect(game.platforms).toEqual(["Nintendo Switch", "Wii U"]);
    expect(game.genres).toEqual(["Adventure"]);
    expect(game.rating).toBe(97.25);
    expect(game.addedAt).toBeInstanceOf(Date);
    expect(game.addedAt.toISOString()).toBe(addedAt.toISOString());

    const [download] = await dst
      .select()
      .from(pgSchema.gameDownloads)
      .where(eq(pgSchema.gameDownloads.id, "d1"));
    expect(download.fileSize).toBe(9_663_676_416);
  });

  it("reports the populated target afterwards, so --force is required to re-run", async () => {
    const existing = await findExistingRows(dst);
    expect(existing.map((e) => e.table)).toEqual(
      expect.arrayContaining(["users", "games", "downloaders", "gameDownloads"])
    );
  });
});
