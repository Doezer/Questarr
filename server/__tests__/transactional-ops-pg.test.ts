import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb, type TestDb } from "./helpers/db-harness.js";

/**
 * Postgres-only regressions for server/db/transactional-ops.pg.ts.
 *
 * These don't belong in dialect-parity.test.ts: that suite asserts identical
 * behaviour across backends, but the bugs here are specific to how Postgres
 * transactions work. Unlike better-sqlite3's synchronous transactions, a
 * failed statement puts the whole Postgres transaction into an aborted state
 * until rollback -- every later statement in it fails too, "current
 * transaction is aborted, commands ignored until end of transaction block".
 * SQLite has no equivalent failure mode, so there is nothing to compare against.
 */
describe("Postgres transactional ops", () => {
  let ctx: TestDb;
  const storage = () => ctx.storage;

  beforeAll(async () => {
    ctx = await setupTestDb("pglite");
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("syncIndexers keeps the items that succeeded when a later one fails", async () => {
    // validateIndexerInput only checks name/url/apiKey are present, and
    // buildNewIndexer passes `priority` through untouched (its `?? 1`
    // fallback only catches null/undefined). A non-numeric priority reaches
    // the database as-is, where Postgres's integer column rejects it. Before
    // the fix, that failure aborted the whole batch's transaction and every
    // row -- including the ones already inserted -- rolled back, even though
    // the returned counts said otherwise.
    const result = await storage().syncIndexers(
      [
        { name: "good-1", url: "http://good1", apiKey: "k1", protocol: "torznab" },
        {
          name: "bad",
          url: "http://bad",
          apiKey: "k2",
          protocol: "torznab",
          priority: "not-a-number" as unknown as number,
        },
        { name: "good-2", url: "http://good2", apiKey: "k3", protocol: "torznab" },
      ],
      Buffer.alloc(32)
    );

    expect(result).toMatchObject({ added: 2, updated: 0, failed: 1 });

    const urls = (await storage().getAllIndexers()).map((i) => i.url);
    expect(urls).toEqual(expect.arrayContaining(["http://good1", "http://good2"]));
    expect(urls).not.toContain("http://bad");
  });

  it("addApiKey enforces the cap across back-to-back calls for the same user", async () => {
    // PGlite is a single connection, so these two calls can never actually
    // race the way two pooled connections against a real Postgres server
    // would -- the driver serializes them regardless of the `.for("update")`
    // lock in addApiKey. This test still passes if that lock is removed, so
    // it only guards the cap-enforcement outcome, not the READ COMMITTED race
    // the lock exists to close. Covered by the "No real-Postgres CI job" gap
    // in this PR's description; a service-container job is the way to give
    // this real teeth.
    const user = await storage().registerSetupUser({ username: "alice", passwordHash: "h" });
    const maxKeys = 1;

    const results = await Promise.allSettled([
      storage().addApiKey({ userId: user.id, name: "k1", keyHash: "h1", prefix: "p1" }, maxKeys),
      storage().addApiKey({ userId: user.id, name: "k2", keyHash: "h2", prefix: "p2" }, maxKeys),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
