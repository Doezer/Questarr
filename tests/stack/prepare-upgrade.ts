import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

// Prepare a persisted pre-0044 database. The production server applies the pending
// backfill on startup, so the browser verifies upgrade behavior through real APIs.
const dbPath = process.env.SQLITE_DB_PATH;
if (!dbPath) throw new Error("SQLITE_DB_PATH is required for the upgrade fixture");
const journal = JSON.parse(readFileSync("migrations/meta/_journal.json", "utf8")) as {
  entries: Array<{ tag: string; when: number }>;
};
const backfill = journal.entries.findIndex((entry) => entry.tag === "0044_backfill_insecure_lan");
if (backfill < 0) throw new Error("HTTP backfill migration missing");
const db = new Database(dbPath);
try {
  db.exec(
    'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL UNIQUE, created_at integer)'
  );
  for (const entry of journal.entries.slice(0, backfill)) {
    const sql = readFileSync(path.join("migrations", `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
    db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run(
      entry.tag,
      entry.when
    );
  }
  for (const [suffix, url] of [
    ["http", "http://127.0.0.1:9117/api"],
    ["https", "https://127.0.0.1:9117/api"],
  ]) {
    db.prepare(
      "INSERT INTO indexers (id, name, url, api_key, enabled) VALUES (?, ?, ?, 'fixture-key', 0)"
    ).run(`upgrade-${suffix}`, `Upgrade ${suffix}`, url);
    db.prepare(
      "INSERT INTO downloaders (id, name, type, url, use_ssl, enabled) VALUES (?, ?, 'qbittorrent', ?, 0, 0)"
    ).run(`upgrade-${suffix}`, `Upgrade ${suffix}`, url);
  }
} finally {
  db.close();
}
