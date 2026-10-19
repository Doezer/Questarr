import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { setupTestDb, type TestDb } from "./helpers/db-harness.js";

describe("release scoring routes", () => {
  let ctx: TestDb;
  let app: express.Express;
  let otherApp: express.Express;

  beforeAll(async () => {
    ctx = await setupTestDb("sqlite");
    const { releaseScoringRoutes } = await import("../release-scoring-routes.js");
    const alice = await ctx.storage.registerSetupUser({ username: "alice", passwordHash: "h" });
    const bob = await ctx.storage.createUser({ username: "bob", passwordHash: "h" });
    const build = (id: string) => {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        (req as unknown as { user: { id: string } }).user = { id };
        next();
      });
      a.use(releaseScoringRoutes);
      return a;
    };
    app = build(alice.id);
    otherApp = build(bob.id);
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  const format = {
    name: "Repacks",
    specs: [{ field: "title", mode: "contains", value: "repack" }],
    score: 25,
  };

  it("returns the profile, formats and built-in rules", async () => {
    const res = await request(app).get("/api/release-scoring");
    expect(res.status).toBe(200);
    expect(res.body.profile.minScore).toBe(0);
    expect(res.body.formats).toEqual([]);
    expect(res.body.builtInRules.length).toBeGreaterThan(5);
  });

  it("creates, edits and deletes a custom format", async () => {
    const created = await request(app).post("/api/custom-formats").send(format);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Repacks", score: 25, enabled: true });

    const edited = await request(app)
      .patch(`/api/custom-formats/${created.body.id}`)
      .send({ score: -10 });
    expect(edited.body.score).toBe(-10);

    const disabled = await request(app)
      .patch(`/api/custom-formats/${created.body.id}`)
      .send({ enabled: false, hardReject: true });
    expect(disabled.body).toMatchObject({ enabled: false, hardReject: true });
    // a later partial update must not reset the fields it does not mention
    const renamed = await request(app)
      .patch(`/api/custom-formats/${created.body.id}`)
      .send({ name: "Repacks v2" });
    expect(renamed.body).toMatchObject({ name: "Repacks v2", enabled: false, hardReject: true });

    const list = await request(app).get("/api/release-scoring");
    expect(list.body.formats).toHaveLength(1);

    expect((await request(otherApp).delete(`/api/custom-formats/${created.body.id}`)).status).toBe(
      404
    );
    expect((await request(app).delete(`/api/custom-formats/${created.body.id}`)).status).toBe(204);
    expect((await request(app).get("/api/release-scoring")).body.formats).toEqual([]);
  });

  it("rejects an invalid regex and a missing condition", async () => {
    const badRegex = await request(app)
      .post("/api/custom-formats")
      .send({ ...format, specs: [{ field: "title", mode: "regex", value: "(?=x)" }] });
    expect(badRegex.status).toBe(400);
    const noSpecs = await request(app)
      .post("/api/custom-formats")
      .send({ ...format, specs: [] });
    expect(noSpecs.status).toBe(400);
  });

  it("saves the profile and refuses unknown built-in rules", async () => {
    const body = {
      minScore: 20,
      protocolPreference: "torrent",
      requiredTerms: [],
      ignoredTerms: ["demo"],
      minSeeders: 2,
      maxSizeBytes: null,
      builtInOverrides: { repack: { points: 3 } },
      formatScores: {},
    };
    const ok = await request(app).put("/api/release-profile").send(body);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ minScore: 20, ignoredTerms: ["demo"] });

    const bad = await request(app)
      .put("/api/release-profile")
      .send({ ...body, builtInOverrides: { nope: { points: 1 } } });
    expect(bad.status).toBe(400);
  });
});
