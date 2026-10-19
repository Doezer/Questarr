import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

function migratedDb() {
  const dir = path.resolve(__dirname, "../../migrations");
  const db = new Database(":memory:");
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.pragma("foreign_keys = OFF");
  return db;
}

describe("integration_requests live game index", () => {
  const insert = (db: Database.Database, id: string, status: string, gameId: string | null) =>
    db
      .prepare(
        "insert into integration_requests (id, user_id, provider, external_request_id, game_id, title, status) values (?, 'u1', 'seerrng', ?, ?, 'Game', ?)"
      )
      .run(id, id, gameId, status);

  it("rejects a second live request on the same game", () => {
    const db = migratedDb();
    insert(db, "a", "searching", "g1");
    expect(() => insert(db, "b", "accepted", "g1")).toThrow(/UNIQUE/);
  });

  it("allows a cancelled holder and requests without a game", () => {
    const db = migratedDb();
    insert(db, "a", "cancelled", "g1");
    insert(db, "b", "searching", "g1");
    insert(db, "c", "failed", null);
    insert(db, "d", "failed", null);
    expect(db.prepare("select count(*) as n from integration_requests").get()).toEqual({ n: 4 });
  });
});
