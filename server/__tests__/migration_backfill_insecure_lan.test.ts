import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const migrationsDir = path.resolve(process.cwd(), "migrations");
const BACKFILL_TAG = "0044_backfill_insecure_lan";

function applyMigration(db: Database.Database, tag: string): void {
  const sql = fs.readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf-8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

describe("0044 backfill of allow_insecure_lan", () => {
  it("opts existing plain-HTTP indexers and downloaders in, and leaves HTTPS ones alone", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf-8")
    ) as { entries: { tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag);
    const backfillIndex = tags.indexOf(BACKFILL_TAG);
    expect(backfillIndex).toBeGreaterThan(0);

    const db = new Database(":memory:");
    for (const tag of tags.slice(0, backfillIndex)) applyMigration(db, tag);

    const addIndexer = db.prepare(
      "INSERT INTO indexers (id, name, url, api_key) VALUES (?, ?, ?, 'key')"
    );
    addIndexer.run("i-http", "Prowlarr", "http://prowlarr:9696/1/");
    addIndexer.run("i-https", "Remote", "https://indexer.example.com/api");
    addIndexer.run("i-upper", "Upper", " HTTP://10.0.0.2:9117/ ");

    const addDownloader = db.prepare(
      "INSERT INTO downloaders (id, name, type, url, use_ssl) VALUES (?, ?, 'qbittorrent', ?, ?)"
    );
    addDownloader.run("d-bare", "Bare host", "192.168.1.10", 0);
    addDownloader.run("d-http", "Scheme http", "http://qbit:8080", 0);
    addDownloader.run("d-ssl", "SSL flag", "qbit.example.com", 1);
    addDownloader.run("d-https", "Scheme https", "https://qbit.example.com", 0);

    applyMigration(db, BACKFILL_TAG);

    const flags = (table: string) =>
      Object.fromEntries(
        (
          db.prepare(`SELECT id, allow_insecure_lan AS flag FROM ${table}`).all() as {
            id: string;
            flag: number;
          }[]
        ).map((row) => [row.id, row.flag])
      );

    expect(flags("indexers")).toEqual({ "i-http": 1, "i-https": 0, "i-upper": 1 });
    expect(flags("downloaders")).toEqual({
      "d-bare": 1,
      "d-http": 1,
      "d-ssl": 0,
      "d-https": 0,
    });
    db.close();
  });
});
