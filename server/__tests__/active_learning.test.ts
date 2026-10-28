import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";
import type { PipelineResult } from "../classification/pipeline.js";
import type { ClassificationCandidate } from "../../shared/schema.js";

type Mod = typeof import("../classification/active-learning.js");

const GAME = "Stellaris";
const input = (title: string, gameTitle: string | undefined = GAME) => ({
  title,
  ...(gameTitle ? { gameTitle } : {}),
});
const result = (over: Partial<PipelineResult>): PipelineResult => ({
  class: "unknown",
  confidence: null,
  source: "local",
  path: ["rules", "local"],
  ...over,
});

describe("assessCandidate", () => {
  let mod: Mod;
  beforeAll(async () => {
    mod = await import("../classification/active-learning.js");
  });

  it("keeps a release no layer could classify, with every layer's answer", () => {
    const assessment = mod.assessCandidate(input("Stellaris Mystery Pack"), result({}), {
      class: "dlc",
      confidence: 0.4,
      modelVersion: "m1",
    });
    expect(assessment?.reasons).toContain("unresolved");
    expect(assessment?.signals.local).toEqual({
      class: "dlc",
      confidence: 0.4,
      modelVersion: "m1",
    });
    expect(assessment?.signals.final.source).toBe("local");
  });

  it("keeps a decided but low-confidence release and ranks it below an unresolved one", () => {
    const low = mod.assessCandidate(
      input("Stellaris Galactic Edition"),
      result({ class: "full_game", confidence: 0.72 }),
      { class: "full_game", confidence: 0.72, modelVersion: "m1" }
    );
    const unresolved = mod.assessCandidate(input("Stellaris Mystery Pack"), result({}), null);
    expect(low?.reasons).toEqual(["low_confidence"]);
    expect(unresolved?.priority).toBeGreaterThan(low?.priority ?? 0);
  });

  it("flags a disagreement between the rules and the local model's best guess", () => {
    const assessment = mod.assessCandidate(
      input("Stellaris Update v3.4.1"),
      result({ class: "patch", confidence: 0.99, source: "rules" }),
      { class: "full_game", confidence: 0.9, modelVersion: "m1" }
    );
    expect(assessment?.reasons).toEqual(["disagreement"]);
  });

  it("flags a cloud answer that contradicts the local model's best guess", () => {
    const assessment = mod.assessCandidate(
      input("Stellaris Galactic Edition"),
      result({ class: "full_game", confidence: 0.9, source: "cloud" }),
      { class: "dlc", confidence: 0.5, modelVersion: "m1" }
    );
    expect(assessment?.reasons).toEqual(["model_disagreement"]);
    expect(assessment?.priority).toBeGreaterThanOrEqual(40);
  });

  it("does not flag the cloud and the local model naming the same class in other words", () => {
    const expansion = mod.assessCandidate(
      input("Stellaris Galactic Edition"),
      result({ class: "expansion", confidence: 0.9, source: "cloud" }),
      { class: "dlc", confidence: 0.5, modelVersion: "m1" }
    );
    const unknown = mod.assessCandidate(
      input("Stellaris Galactic Edition"),
      result({ class: "full_game", confidence: 0.9, source: "cloud" }),
      { class: "unknown", confidence: 0.2, modelVersion: "m1" }
    );
    expect(expansion).toBeNull();
    expect(unknown).toBeNull();
  });

  it("ignores a confident, consistent release", () => {
    const assessment = mod.assessCandidate(
      input("Stellaris Update v3.4.1"),
      result({ class: "patch", confidence: 0.99, source: "rules" }),
      { class: "patch", confidence: 0.95, modelVersion: "m1" }
    );
    expect(assessment).toBeNull();
  });

  it("does not collect a release the rules identified by flag", () => {
    expect(
      mod.assessCandidate(
        input("Stellaris Soundtrack"),
        result({ class: "unknown", source: "rules", flags: ["soundtrack"] }),
        null
      )
    ).toBeNull();
  });

  it("keys releases case- and space-insensitively per game", () => {
    expect(mod.candidateKey("Stellaris  Update", "Stellaris")).toBe(
      mod.candidateKey("stellaris update", " stellaris ")
    );
    expect(mod.candidateKey("Stellaris Update", "Stellaris")).not.toBe(
      mod.candidateKey("Stellaris Update", "Other")
    );
  });
});

describe("rankCandidates and exportVerifiedCsv", () => {
  const row = (over: Partial<ClassificationCandidate>): ClassificationCandidate => ({
    id: "id",
    dedupeKey: "k",
    releaseName: "Release",
    gameTitle: "Game",
    platform: null,
    sizeBytes: null,
    reasons: '["unresolved"]',
    signals: JSON.stringify({
      rules: { class: "unknown", flags: [], ruleIds: [] },
      local: { class: "dlc", confidence: 0.5, modelVersion: "m" },
      final: { class: "unknown", confidence: null, source: "local", flags: [] },
    }),
    priority: 50,
    seenCount: 1,
    status: "pending",
    humanLabel: null,
    notes: null,
    reviewedAt: null,
    suggestedLabel: null,
    suggestedConfidence: null,
    suggestedModel: null,
    suggestedAt: null,
    createdAt: new Date(0),
    ...over,
  });

  it("boosts pending releases whose likely class has few verified examples", async () => {
    const mod = await import("../classification/active-learning.js");
    const ranked = mod.rankCandidates([
      row({ id: "dlc-heavy", dedupeKey: "a" }),
      row({
        id: "patch-thin",
        dedupeKey: "b",
        signals: JSON.stringify({
          rules: { class: "unknown", flags: [], ruleIds: [] },
          local: { class: "patch", confidence: 0.5, modelVersion: "m" },
          final: { class: "unknown", confidence: null, source: "local", flags: [] },
        }),
      }),
      row({ id: "v1", dedupeKey: "c", status: "verified", humanLabel: "dlc" }),
      row({ id: "v2", dedupeKey: "d", status: "verified", humanLabel: "dlc" }),
    ]);
    const pending = ranked.filter((c) => c.status === "pending").map((c) => c.id);
    expect(pending).toEqual(["patch-thin", "dlc-heavy"]);
  });

  it("exports only human-verified rows, quoting cells, never suggestions", async () => {
    const mod = await import("../classification/active-learning.js");
    const { csv, exported, skippedNoGame } = mod.exportVerifiedCsv([
      row({
        id: "1",
        status: "verified",
        humanLabel: "patch",
        releaseName: 'Game, "Deluxe" Update',
        notes: "checked",
      }),
      row({ id: "2", status: "pending", suggestedLabel: "full_game" }),
      row({ id: "3", status: "rejected" }),
      row({ id: "4", status: "ambiguous" }),
      row({ id: "5", status: "verified", humanLabel: "dlc", gameTitle: null }),
    ]);
    expect(csv).toBe(
      'release_name,query,human_label,notes\n"Game, ""Deluxe"" Update",Game,patch,checked\n'
    );
    expect(exported).toBe(1);
    expect(skippedNoGame).toBe(1);
  });

  it("only exports labels the benchmark dataset reader understands", async () => {
    const { CANDIDATE_LABELS } = await import("../../shared/release-labels.js");
    const { normalizeLabel } = await import("../../scripts/release-benchmark/dataset.js");
    for (const label of CANDIDATE_LABELS) expect(normalizeLabel(label)).not.toBeNull();
  });
});

describe.each(activeTestDialects())("active learning on %s", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let mod: Mod;
  let activeConfig: { collect: boolean; cloudSuggest: boolean };
  let typesafe: typeof import("../typesafe.js").typesafeClient;

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const { classificationCandidatesRoutes } =
      await import("../classification-candidates-routes.js");
    mod = await import("../classification/active-learning.js");
    const { config } = await import("../config.js");
    activeConfig = config.classification.activeLearning as typeof activeConfig;
    typesafe = (await import("../typesafe.js")).typesafeClient;
    app = express();
    app.use(express.json());
    app.use(classificationCandidatesRoutes);
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  beforeEach(async () => {
    activeConfig.collect = false;
    activeConfig.cloudSuggest = false;
    await ctx.storage.deleteClassificationCandidates();
    mod.resetCollectionMemory();
    vi.restoreAllMocks();
  });

  const unsure = result({ class: "unknown", confidence: null });

  it("collects nothing while collection is disabled", async () => {
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    expect(await ctx.storage.getClassificationCandidates()).toHaveLength(0);
  });

  it("collects once per release and game, counting later sightings", async () => {
    activeConfig.collect = true;
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    mod.resetCollectionMemory();
    await mod.collectCandidate(input("stellaris  mystery pack"), unsure, null);
    await mod.collectCandidate(input("Stellaris Mystery Pack", "Other Game"), unsure, null);
    const rows = await ctx.storage.getClassificationCandidates();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.gameTitle === GAME)?.seenCount).toBe(2);
  });

  it("does not collect when a layer failed", async () => {
    activeConfig.collect = true;
    await mod.collectCandidate(
      input("Stellaris Mystery Pack"),
      { ...unsure, degraded: true },
      null
    );
    expect(await ctx.storage.getClassificationCandidates()).toHaveLength(0);
  });

  it("never throws when storage fails", async () => {
    activeConfig.collect = true;
    vi.spyOn(ctx.storage, "upsertClassificationCandidate").mockRejectedValue(new Error("disk"));
    await expect(
      mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null)
    ).resolves.toBeUndefined();
  });

  it("retries a release whose candidate count failed", async () => {
    activeConfig.collect = true;
    vi.spyOn(ctx.storage, "countClassificationCandidates").mockRejectedValueOnce(new Error("disk"));
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    expect(await ctx.storage.getClassificationCandidates()).toHaveLength(0);
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    expect(await ctx.storage.getClassificationCandidates()).toHaveLength(1);
  });

  async function seed(title = "Stellaris Mystery Pack"): Promise<string> {
    activeConfig.collect = true;
    await mod.collectCandidate(input(title), unsure, {
      class: "dlc",
      confidence: 0.5,
      modelVersion: "m1",
    });
    const row = (await ctx.storage.getClassificationCandidates()).find(
      (r) => r.releaseName === title
    );
    return row?.id ?? "";
  }

  it("lists pending candidates with the layer signals and the collection switches", async () => {
    await seed();
    const res = await request(app).get("/api/classification-candidates");
    expect(res.status).toBe(200);
    expect(res.body.collecting).toBe(true);
    expect(res.body.counts.pending).toBe(1);
    expect(res.body.candidates[0]).toMatchObject({
      releaseName: "Stellaris Mystery Pack",
      reasons: ["unresolved"],
      status: "pending",
    });
    expect(res.body.candidates[0].signals.local.class).toBe("dlc");
    expect((await request(app).get("/api/classification-candidates?status=nope")).status).toBe(400);
  });

  it("verifies a corrected label and exports only that", async () => {
    const id = await seed();
    await seed("Stellaris Other Pack");
    const reviewed = await request(app)
      .post(`/api/classification-candidates/${id}/review`)
      .send({ action: "correct", label: "patch", notes: "checked on the indexer" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toMatchObject({ status: "verified", humanLabel: "patch" });

    const exported = await request(app).get("/api/classification-candidates/export");
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.text).toBe(
      "release_name,query,human_label,notes\nStellaris Mystery Pack,Stellaris,patch,checked on the indexer\n"
    );
  });

  it("accepts the local prediction but refuses to accept nothing", async () => {
    const id = await seed();
    const accepted = await request(app)
      .post(`/api/classification-candidates/${id}/review`)
      .send({ action: "accept" });
    expect(accepted.body).toMatchObject({ status: "verified", humanLabel: "dlc" });

    activeConfig.collect = true;
    await mod.collectCandidate(input("Stellaris No Idea"), unsure, null);
    const empty = (await ctx.storage.getClassificationCandidates()).find(
      (r) => r.releaseName === "Stellaris No Idea"
    );
    const refused = await request(app)
      .post(`/api/classification-candidates/${empty?.id}/review`)
      .send({ action: "accept" });
    expect(refused.status).toBe(400);
  });

  it("rejects or sets aside a candidate without exporting it", async () => {
    const id = await seed();
    const other = await seed("Stellaris Other Pack");
    await request(app)
      .post(`/api/classification-candidates/${id}/review`)
      .send({ action: "reject" });
    await request(app)
      .post(`/api/classification-candidates/${other}/review`)
      .send({ action: "ambiguous", notes: "title is cut off" });
    const exported = await request(app).get("/api/classification-candidates/export");
    expect(exported.text).toBe("release_name,query,human_label,notes\n");
    const counts = (await request(app).get("/api/classification-candidates")).body.counts;
    expect(counts).toMatchObject({ pending: 0, rejected: 1, ambiguous: 1 });
  });

  it("validates reviews and unknown ids", async () => {
    const id = await seed();
    const bad = await request(app)
      .post(`/api/classification-candidates/${id}/review`)
      .send({ action: "correct", label: "banana" });
    expect(bad.status).toBe(400);
    const missing = await request(app)
      .post("/api/classification-candidates/nope/review")
      .send({ action: "reject" });
    expect(missing.status).toBe(404);
  });

  it("asks the provider only when cloud suggestions are enabled, and never sets the label", async () => {
    const id = await seed();
    const analyze = vi.spyOn(typesafe, "analyzeRelease").mockResolvedValue({
      releaseType: "update",
      releaseTypeConfidence: 0.8,
      legitimacyScore: null,
    } as never);
    vi.spyOn(typesafe, "isConfigured").mockResolvedValue(true);

    const off = await request(app).post(`/api/classification-candidates/${id}/suggest`);
    expect(off.status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();

    activeConfig.cloudSuggest = true;
    const on = await request(app).post(`/api/classification-candidates/${id}/suggest`);
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({
      suggestedLabel: "update",
      suggestedConfidence: 0.8,
      status: "pending",
      humanLabel: null,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    // the cloud says patch, the local model said dlc: now a better example, flagged once
    expect(JSON.parse(on.body.reasons)).toEqual(["unresolved", "model_disagreement"]);
    expect(on.body.priority).toBeGreaterThan(40);
    const again = await request(app).post(`/api/classification-candidates/${id}/suggest`);
    expect(JSON.parse(again.body.reasons)).toEqual(["unresolved", "model_disagreement"]);
    expect((await request(app).get("/api/classification-candidates/export")).text).not.toContain(
      "Mystery"
    );
  });

  it("reports provider failures without touching the candidate", async () => {
    const id = await seed();
    activeConfig.cloudSuggest = true;
    vi.spyOn(typesafe, "isConfigured").mockResolvedValue(true);
    vi.spyOn(typesafe, "analyzeRelease").mockResolvedValue(null);
    expect((await request(app).post(`/api/classification-candidates/${id}/suggest`)).status).toBe(
      502
    );
    vi.spyOn(typesafe, "analyzeRelease").mockRejectedValue(new Error("boom"));
    expect((await request(app).post(`/api/classification-candidates/${id}/suggest`)).status).toBe(
      502
    );
    vi.spyOn(typesafe, "isConfigured").mockResolvedValue(false);
    expect((await request(app).post(`/api/classification-candidates/${id}/suggest`)).status).toBe(
      409
    );
    expect((await ctx.storage.getClassificationCandidate(id))?.suggestedLabel).toBeNull();
  });

  it("deletes candidates by status or all of them", async () => {
    const id = await seed();
    await seed("Stellaris Other Pack");
    await request(app)
      .post(`/api/classification-candidates/${id}/review`)
      .send({ action: "reject" });
    expect((await request(app).delete("/api/classification-candidates?status=nope")).status).toBe(
      400
    );
    const rejected = await request(app).delete("/api/classification-candidates?status=rejected");
    expect(rejected.body.deleted).toBe(1);
    const all = await request(app).delete("/api/classification-candidates");
    expect(all.body.deleted).toBe(1);
    expect(await ctx.storage.getClassificationCandidates()).toHaveLength(0);
  });

  it("does not downgrade a verified candidate when it is seen again", async () => {
    const id = await seed();
    await request(app)
      .post(`/api/classification-candidates/${id}/review`)
      .send({ action: "correct", label: "dlc" });
    mod.resetCollectionMemory();
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    const row = await ctx.storage.getClassificationCandidate(id);
    expect(row).toMatchObject({ status: "verified", humanLabel: "dlc", seenCount: 2 });
  });

  it("writes a release once per window, and again after the candidates were deleted", async () => {
    activeConfig.collect = true;
    const upsert = vi.spyOn(ctx.storage, "upsertClassificationCandidate");
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    expect(upsert).toHaveBeenCalledTimes(1);

    await request(app).delete("/api/classification-candidates");
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(await ctx.storage.getClassificationCandidates()).toHaveLength(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    vi.useRealTimers();
    expect(upsert).toHaveBeenCalledTimes(3);
    expect((await ctx.storage.getClassificationCandidates())[0]?.seenCount).toBe(2);
  });

  it("counts candidates without loading them", async () => {
    await seed();
    await seed("Stellaris Other Pack");
    expect(await ctx.storage.countClassificationCandidates()).toBe(2);
  });

  it("counts a full table once per release per window and writes nothing", async () => {
    activeConfig.collect = true;
    const count = vi
      .spyOn(ctx.storage, "countClassificationCandidates")
      .mockResolvedValue(mod.MAX_CANDIDATES);
    const upsert = vi.spyOn(ctx.storage, "upsertClassificationCandidate");
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    await mod.collectCandidate(input("Stellaris Mystery Pack"), unsure, null);
    expect(count).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });
});
