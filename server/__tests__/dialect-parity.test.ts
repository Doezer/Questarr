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

    it("api keys round-trip scope and expiry, default to all / never, and throttle last-used", async () => {
      const [user] = await storage().getAllUsers();
      const expiresAt = new Date(Date.now() + 86_400_000);
      const scoped = await storage().addApiKey(
        {
          userId: user.id,
          name: "scoped",
          keyHash: "hs",
          prefix: "ps",
          scope: "read",
          expiresAt,
        },
        10
      );
      expect(scoped.scope).toBe("read");
      expect(scoped.expiresAt?.getTime()).toBe(expiresAt.getTime());

      const legacy = await storage().addApiKey(
        { userId: user.id, name: "legacy", keyHash: "hl", prefix: "pl" },
        10
      );
      expect(legacy.scope).toBe("all");
      expect(legacy.expiresAt).toBeNull();

      await storage().touchApiKey(legacy.id);
      const first = (await storage().getApiKeyByHash("hl"))!.lastUsedAt!;
      expect(first).toBeInstanceOf(Date);
      await new Promise((r) => setTimeout(r, 5));
      await storage().touchApiKey(legacy.id);
      const second = (await storage().getApiKeyByHash("hl"))!.lastUsedAt!;
      expect(second.getTime()).toBe(first.getTime());
    });

    it("integration requests are idempotent per (user, provider, id) and updatable", async () => {
      const [user] = await storage().getAllUsers();
      const first = await storage().addIntegrationRequest({
        userId: user.id,
        externalRequestId: "seerrng:request:1",
        title: "Example Game",
        igdbId: 42,
        operatingSystem: "linux",
        architecture: "x64",
      });
      expect(first.created).toBe(true);
      expect(first.request).toMatchObject({
        provider: "seerrng",
        status: "accepted",
        gameId: null,
      });

      const replay = await storage().addIntegrationRequest({
        userId: user.id,
        externalRequestId: "seerrng:request:1",
        title: "Other title",
      });
      expect(replay.created).toBe(false);
      expect(replay.request.id).toBe(first.request.id);
      expect(replay.request.title).toBe("Example Game");

      const game = await storage().addGame({
        userId: user.id,
        title: "Example Game",
        status: "wanted",
      } as Parameters<ReturnType<typeof storage>["addGame"]>[0]);
      const updated = await storage().updateIntegrationRequest(user.id, "seerrng:request:1", {
        gameId: game.id,
        status: "searching",
      });
      expect(updated).toMatchObject({ gameId: game.id, status: "searching" });
      expect(
        (await storage().getIntegrationRequestByGameId(user.id, game.id))?.externalRequestId
      ).toBe("seerrng:request:1");
      expect(await storage().getIntegrationRequest(user.id, "missing")).toBeUndefined();

      // A live holder is found ahead of a cancelled one on the same game.
      await storage().updateIntegrationRequest(user.id, "seerrng:request:1", {
        status: "cancelled",
      });
      await storage().addIntegrationRequest({
        userId: user.id,
        externalRequestId: "seerrng:request:2",
        title: "Example Game",
      });
      await storage().updateIntegrationRequest(user.id, "seerrng:request:2", {
        gameId: game.id,
        status: "searching",
      });
      expect(
        (await storage().getIntegrationRequestByGameId(user.id, game.id))?.externalRequestId
      ).toBe("seerrng:request:2");

      // The ledger row outlives the game (set null), and the game count stays untouched.
      await storage().removeGame(game.id);
      expect(
        (await storage().getIntegrationRequest(user.id, "seerrng:request:1"))?.gameId
      ).toBeNull();
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

    it("replaceGameInstalledVersion writes only over the expected value", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      expect(await storage().replaceGameInstalledVersion(game.id, "v9", "v1.0")).toBe(false);
      expect(await storage().replaceGameInstalledVersion(game.id, null, "v1.0")).toBe(true);
      expect(await storage().replaceGameInstalledVersion(game.id, null, "v2.0")).toBe(false);
      expect(await storage().replaceGameInstalledVersion(game.id, "v1.0", "v1.1")).toBe(true);
      expect((await storage().getGame(game.id))?.installedVersion).toBe("v1.1");
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

    it("stores a game file as not overridden, then flags a manual category change", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const file = await storage().addGameFile({
        gameId: game.id,
        downloadId: null,
        originalName: "Game.Update.zip",
        storedName: "Game.Update.zip",
        category: "update",
        filePath: "/library/Game/Game.Update.zip",
        fileSize: 1,
      });
      expect(file.categoryOverridden).toBe(false);

      const updated = await storage().updateGameFileCategory(file.id, "dlc");
      expect(updated).toMatchObject({ category: "dlc", categoryOverridden: true });
      const [stored] = (await storage().getGameFiles(game.id)).filter((f) => f.id === file.id);
      expect(stored).toMatchObject({ category: "dlc", categoryOverridden: true });
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

      // Both calls start with the same shape (select current, select existing,
      // then update) and neither hash exists yet, so both "existing" checks
      // come back empty before either update runs -- the update is what
      // actually races, not the pre-check. Confirmed by reverting the
      // isUniqueConflict fix locally: the loser's update throws instead of
      // resolving to "merged", reproducibly across repeated runs on both
      // dialects. The `every fulfilled` assertion below is what that failure
      // trips; if a future change makes one call win the race via the
      // pre-check instead, this still passes -- the invariant that matters is
      // no thrown error and no duplicated row, not which internal path wins.
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
  describe("collections", () => {
    it("stores rules as JSON, links games once and cascades on delete", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);

      const smart = await storage().createCollection({
        userId: user.id,
        name: "Shooters",
        description: null,
        type: "smart",
        rules: { genres: ["Shooter"], minRating: 7 },
      });
      expect((await storage().getCollection(smart.id, user.id))?.rules).toEqual({
        genres: ["Shooter"],
        minRating: 7,
      });
      expect(await storage().getCollection(smart.id, "someone-else")).toBeUndefined();

      const manual = await storage().createCollection({
        userId: user.id,
        name: "Backlog",
        description: "to play",
        type: "manual",
        rules: null,
      });
      expect(await storage().addGameToCollection(manual.id, game.id)).toBe(true);
      expect(await storage().addGameToCollection(manual.id, game.id)).toBe(false);
      expect(await storage().getCollectionLinks(user.id)).toEqual([
        { collectionId: manual.id, gameId: game.id },
      ]);

      const renamed = await storage().updateCollection(manual.id, user.id, { name: "Next up" });
      expect(renamed?.name).toBe("Next up");

      expect(await storage().removeGameFromCollection(manual.id, game.id)).toBe(true);
      expect(await storage().removeGameFromCollection(manual.id, game.id)).toBe(false);

      // Switching to smart drops the manual links, so they cannot resurface on the way back.
      await storage().addGameToCollection(manual.id, game.id);
      await storage().updateCollection(manual.id, user.id, {
        type: "smart",
        rules: { genres: ["Shooter"] },
      });
      expect(await storage().getCollectionLinks(user.id)).toEqual([]);
      await storage().updateCollection(manual.id, user.id, { type: "manual", rules: null });

      await storage().addGameToCollection(manual.id, game.id);
      expect(await storage().deleteCollection(manual.id, user.id)).toBe(true);
      expect(await storage().getCollectionLinks(user.id)).toEqual([]);
      expect((await storage().getCollections(user.id)).map((c) => c.name)).toEqual(["Shooters"]);
    });
  });

  describe("download event log", () => {
    it("still saves the error message when the status does not change", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloader = await storage().addDownloader({
        name: "same-status-qb",
        type: "qbittorrent",
        url: "http://same-status",
      } as never);
      const download = await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "same-status-hash",
        downloadTitle: "Same.Status-GRP",
        status: "manual_review_required",
      } as never);
      const before = (await storage().getDownloadEvents(user.id, { eventType: "needs_review" }))
        .total;
      await storage().updateGameDownloadStatus(download!.id, "manual_review_required", "scan gap");
      const row = await storage().getGameDownload(download!.id);
      expect(row?.errorMessage).toBe("scan gap");
      expect(
        (await storage().getDownloadEvents(user.id, { eventType: "needs_review" })).total
      ).toBe(before);
    });

    it("records a completed event for rows inserted already completed", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloader = await storage().addDownloader({
        name: "claimed-qb",
        type: "qbittorrent",
        url: "http://claimed",
      } as never);
      const before = (await storage().getDownloadEvents(user.id, { eventType: "completed" })).total;
      await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "claimed-hash",
        downloadTitle: "Claimed.Game-GRP",
        status: "completed",
      } as never);
      const after = (await storage().getDownloadEvents(user.id, { eventType: "completed" })).total;
      expect(after).toBe(before + 1);
    });

    it("records a needs_review event when an orphaned download is relinked", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloader = await storage().addDownloader({
        name: "relink-qb",
        type: "qbittorrent",
        url: "http://relink",
      } as never);
      const download = await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "relink-hash",
        downloadTitle: "Relink.Game-GRP",
        status: "game_link_required",
      } as never);
      const before = (await storage().getDownloadEvents(user.id, { eventType: "needs_review" }))
        .total;
      const relinked = await storage().relinkGameDownload(download!.id, game.id);
      expect(relinked?.status).toBe("manual_review_required");
      const after = await storage().getDownloadEvents(user.id, { eventType: "needs_review" });
      expect(after.total).toBe(before + 1);
      // A second relink no longer matches game_link_required and logs nothing.
      expect(await storage().relinkGameDownload(download!.id, game.id)).toBeUndefined();
      expect(
        (await storage().getDownloadEvents(user.id, { eventType: "needs_review" })).total
      ).toBe(before + 1);
    });

    it("records grabbed, completed, blocklisted and removed events, newest first", async () => {
      const [user] = await storage().getAllUsers();
      const [game] = await storage().getUserGames(user.id);
      const downloader = await storage().addDownloader({
        name: "events-qb",
        type: "qbittorrent",
        url: "http://events",
      } as never);
      const before = (await storage().getDownloadEvents(user.id)).total;

      const download = await storage().addGameDownload({
        gameId: game.id,
        downloaderId: downloader!.id,
        downloadType: "game",
        downloadHash: "events-hash",
        downloadTitle: "Events.Game-GRP",
        status: "downloading",
      } as never);
      await storage().updateGameDownloadStatus(download!.id, "completed");
      // Same status twice must not log a second event.
      await storage().updateGameDownloadStatus(download!.id, "completed");
      await storage().addReleaseBlacklist({
        gameId: game.id,
        releaseTitle: "Events.Game-BAD",
        indexerName: "idx",
      } as never);
      await storage().removeGameDownload(download!.id, game.id);

      const { events, total } = await storage().getDownloadEvents(user.id);
      expect(total).toBe(before + 4);
      expect(
        events
          .filter((e) => e.releaseTitle.startsWith("Events.Game-"))
          .map((e) => e.eventType)
          .sort()
      ).toEqual(["blocklisted", "completed", "grabbed", "removed"]);
      expect(events.find((e) => e.eventType === "grabbed")).toMatchObject({
        gameTitle: game.title,
        releaseTitle: "Events.Game-GRP",
        downloaderName: "events-qb",
      });

      // Search matches the release or the game title, whatever the case.
      const bySearch = await storage().getDownloadEvents(user.id, { search: "EVENTS.game-bad" });
      expect(bySearch.total).toBe(1);
      expect(bySearch.events[0]?.eventType).toBe("blocklisted");
      expect((await storage().getDownloadEvents(user.id, { search: "no-such-thing" })).total).toBe(
        0
      );

      // Unblock all removes every blocked release of the user's games, and only theirs.
      const other = await storage().createUser({
        username: "bob-unblock",
        passwordHash: "h",
      } as never);
      const otherGame = await storage().addGame({
        userId: other.id,
        igdbId: 9001,
        title: "Other Game",
        status: "wanted",
      } as never);
      await storage().addReleaseBlacklist({
        gameId: otherGame.id,
        releaseTitle: "Other.Game-BAD",
        indexerName: "idx",
      } as never);
      expect(await storage().removeAllReleaseBlacklists(user.id)).toBeGreaterThanOrEqual(1);
      expect(await storage().getAllReleaseBlacklists(user.id)).toEqual([]);
      expect(
        (await storage().getAllReleaseBlacklists(other.id)).map((e) => e.releaseTitle)
      ).toEqual(["Other.Game-BAD"]);

      const completedOnly = await storage().getDownloadEvents(user.id, { eventType: "completed" });
      expect(completedOnly.total).toBeGreaterThanOrEqual(1);
      expect(completedOnly.events.every((e) => e.eventType === "completed")).toBe(true);
    });
  });
});
