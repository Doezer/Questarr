import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

/**
 * Runs the same behavioural assertions against every supported backend.
 *
 * This is the suite that proves Postgres support actually works rather than
 * merely compiling. It deliberately concentrates on the places the two dialects
 * disagree: transactions (sync on better-sqlite3, async on node-postgres),
 * aggregate types (bigint comes back as a string on node-postgres), LIKE case
 * sensitivity, JSON column types, and 64-bit integers.
 *
 * Every expectation here is dialect-independent on purpose -- if a result
 * differs between backends, that is the bug.
 */
describe.each(activeTestDialects())("storage behaviour on %s", (dialect) => {
  let ctx: TestDb;
  const storage = () => ctx.storage;

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  async function seedUser() {
    return storage().registerSetupUser({ username: "alice", passwordHash: "h" });
  }

  describe("transactional operations", () => {
    it("registerSetupUser creates the first user and refuses a second", async () => {
      const user = await seedUser();
      expect(user.id).toBeTruthy();
      await expect(
        storage().registerSetupUser({ username: "bob", passwordHash: "h" })
      ).rejects.toThrow(/already completed/i);
    });

    it("seedPlatformMappingsIfEmpty seeds once and is then idempotent", async () => {
      const first = await storage().seedPlatformMappingsIfEmpty([
        { igdbPlatformId: 6, sourcePlatformName: "PC" },
        { igdbPlatformId: 48, sourcePlatformName: "PS4" },
      ]);
      expect(first).toEqual({ seeded: true, count: 2 });

      const second = await storage().seedPlatformMappingsIfEmpty([
        { igdbPlatformId: 1, sourcePlatformName: "Ignored" },
      ]);
      expect(second).toEqual({ seeded: false, count: 2 });
    });

    it("addApiKey enforces the per-user cap inside the transaction", async () => {
      const [user] = await storage().getAllUsers();
      await storage().addApiKey({ userId: user.id, name: "k1", keyHash: "h1", prefix: "p1" }, 2);
      await storage().addApiKey({ userId: user.id, name: "k2", keyHash: "h2", prefix: "p2" }, 2);
      await expect(
        storage().addApiKey({ userId: user.id, name: "k3", keyHash: "h3", prefix: "p3" }, 2)
      ).rejects.toThrow(/limit reached/i);
    });

    it("syncIndexers inserts, then updates the same url", async () => {
      const inserted = await storage().syncIndexers([
        { name: "idx", url: "http://a", apiKey: "secret", protocol: "torznab" },
      ]);
      expect(inserted).toMatchObject({ added: 1, updated: 0, failed: 0 });

      const updated = await storage().syncIndexers([
        { name: "idx-renamed", url: "http://a", apiKey: "secret2", protocol: "torznab" },
      ]);
      expect(updated).toMatchObject({ added: 0, updated: 1, failed: 0 });
    });
  });

  describe("dialect-sensitive queries", () => {
    it("search is case-insensitive on titles and reaches into JSON columns", async () => {
      const [user] = await storage().getAllUsers();
      await storage().addGame({
        userId: user.id,
        igdbId: 1,
        title: "Zelda Breath",
        status: "wanted",
        platforms: ["Nintendo Switch"],
        genres: ["Adventure"],
      } as never);
      await storage().addGame({
        userId: user.id,
        igdbId: 2,
        title: "Doom Eternal",
        status: "wanted",
        platforms: ["PC"],
        genres: ["Shooter"],
      } as never);

      // Uppercased query against a lowercase-insensitive match: SQLite's LIKE is
      // case-insensitive for ASCII, Postgres's is not, so this needs ILIKE there.
      const byTitle = await storage().searchUserGames(user.id, "ZELDA");
      expect(byTitle.map((g) => g.title)).toEqual(["Zelda Breath"]);

      // genres is TEXT on SQLite but JSONB on Postgres; the latter needs a cast
      // before a string operator will touch it.
      const byGenre = await storage().searchUserGames(user.id, "shooter");
      expect(byGenre.map((g) => g.title)).toEqual(["Doom Eternal"]);
    });

    it("updateGamesBatch applies every update", async () => {
      const [user] = await storage().getAllUsers();
      const games = await storage().getUserGames(user.id);
      await storage().updateGamesBatch(
        games.map((g) => ({ id: g.id, data: { status: "downloaded" as const } }))
      );
      const after = await storage().getUserGames(user.id);
      expect(after.every((g) => g.status === "downloaded")).toBe(true);
    });

    it("aggregates come back as numbers, not strings", async () => {
      const [user] = await storage().getAllUsers();
      const status = await storage().getDashboardStatus(user.id);
      // count(*) and sum() widen to bigint on Postgres, which node-postgres
      // returns as a string; "2" > 0 would silently be false.
      expect(typeof status.totalGames).toBe("number");
      expect(typeof status.pendingWishlist).toBe("number");
      expect(status.totalGames).toBe(2);
    });

    it("summarises downloads with distinct types, status and update detection", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloader = await storage().addDownloader({
        name: "qb",
        type: "qbittorrent",
        url: "http://q",
      } as never);

      await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "h1",
        downloadTitle: "Zelda.iso",
        status: "completed",
        fileSize: 9_663_676_416,
      } as never);
      await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "update",
        downloadHash: "h2",
        // Capitalised on purpose: the update heuristic matches with LIKE, which
        // is case-sensitive on Postgres only.
        downloadTitle: "Zelda.Update.v2",
        status: "completed",
      } as never);

      const summary = await storage().getDownloadSummaryByGame(user.id);
      const entry = summary[game.id];
      expect(entry.count).toBe(2);
      expect([...entry.downloadTypes].sort()).toEqual(["game", "update"]);
      expect(entry.hasUpdateDownload).toBe(true);
    });

    it("round-trips a file size larger than a 32-bit integer", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloads = await storage().getDownloadsByGameId(game.id);
      const big = downloads.find((d) => d.downloadHash === "h1");
      // Postgres `integer` tops out at 2147483647, so this column must be bigint.
      expect(big?.fileSize).toBe(9_663_676_416);
    });

    it("resolves a concurrent claim-race unique conflict the same way on both dialects", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloader = await storage().addDownloader({
        name: "race-qb",
        type: "qbittorrent",
        url: "http://race",
      } as never);

      // Two stub rows racing to resolve to the same real hash: whichever
      // update loses hits the unique index on (downloaderId, downloadHash).
      // SQLite reports "UNIQUE constraint failed"; Postgres reports SQLSTATE
      // 23505 with a different message, so the catch in updateGameDownloadHash
      // must recognize both or the loser's error propagates instead of
      // resolving to "merged".
      const tagA = await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "questarr-add-race-a",
        downloadTitle: "Race Game A",
        status: "downloading",
      } as never);
      const tagB = await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "questarr-add-race-b",
        downloadTitle: "Race Game B",
        status: "downloading",
      } as never);

      const realHash = "abcdef0123456789abcdef0123456789abcdef01";
      const results = await Promise.allSettled([
        storage().updateGameDownloadHash(tagA!.id, realHash),
        storage().updateGameDownloadHash(tagB!.id, realHash),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const outcomes = results.map((r) => (r as PromiseFulfilledResult<string>).value).sort();
      expect(outcomes).toEqual(["merged", "updated"]);

      const keys = await storage().getTrackedDownloadKeys();
      expect(keys.has(`${downloader!.id}:${realHash}`)).toBe(true);
    });
  });
});
