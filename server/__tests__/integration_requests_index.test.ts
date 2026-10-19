import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

function migratedDb(stopBeforeLast = false) {
  const dir = path.resolve(__dirname, "../../migrations");
  const db = new Database(":memory:");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of stopBeforeLast ? files.slice(0, -1) : files) {
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

  it("releases duplicate live claims, keeping the oldest, when the index is created", () => {
    const dir = path.resolve(__dirname, "../../migrations");
    const last = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .at(-1)!;
    const db = migratedDb(true);
    const insertAt = db.prepare(
      "insert into integration_requests (id, user_id, provider, external_request_id, game_id, title, status, created_at) values (?, 'u1', 'seerrng', ?, 'g1', 'Game', ?, ?)"
    );
    insertAt.run("newer", "newer", "searching", 2000);
    insertAt.run("older", "older", "searching", 1000);
    insertAt.run("cancelled", "cancelled", "cancelled", 500);
    for (const statement of fs
      .readFileSync(path.join(dir, last), "utf8")
      .split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
    expect(
      db.prepare("select id, game_id, status from integration_requests order by id").all()
    ).toEqual([
      { id: "cancelled", game_id: "g1", status: "cancelled" },
      { id: "newer", game_id: null, status: "failed" },
      { id: "older", game_id: "g1", status: "searching" },
    ]);
  });
});
