import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

const ENV_NAMES = [
  "CLASSIFICATION_MODE",
  "CLASSIFIER_LOCAL_THRESHOLD",
  "CLASSIFICATION_HOLD_UNKNOWN",
  "ACTIVE_LEARNING_COLLECT",
  "ACTIVE_LEARNING_CLOUD_SUGGEST",
];

describe.each(activeTestDialects())("classification settings on %s", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let settings: typeof import("../classification/settings.js");
  let live: typeof import("../config.js").config.classification;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const { classificationSettingsRoutes } = await import("../classification-settings-routes.js");
    settings = await import("../classification/settings.js");
    live = (await import("../config.js")).config.classification;
    app = express();
    app.use(express.json());
    app.use(classificationSettingsRoutes);
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  beforeEach(async () => {
    for (const name of ENV_NAMES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    await ctx.storage.setSystemConfig("classification.settings", "{}");
    await settings.updateClassificationSettings({
      mode: "hybrid",
      localThreshold: 0.7,
      holdUnknown: false,
      collect: false,
      cloudSuggest: false,
      lowConfidence: 0.85,
      maxCandidates: 5000,
    });
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("reports the values in force, the model state and no locked setting", async () => {
    const res = await request(app).get("/api/settings/classification");
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      mode: "hybrid",
      localThreshold: 0.7,
      collect: false,
    });
    expect(res.body.locked).toEqual({});
    expect(res.body.localModel).toEqual(
      expect.objectContaining({ installed: expect.any(Boolean), path: expect.any(String) })
    );
    expect(res.body.cloud).toEqual(expect.objectContaining({ configured: expect.any(Boolean) }));
  });

  it("saves a change, applies it at once and keeps it across a reload", async () => {
    const res = await request(app)
      .put("/api/settings/classification")
      .send({ mode: "local", collect: true, lowConfidence: 0.6, maxCandidates: 200 });
    expect(res.status).toBe(200);
    expect(live.mode).toBe("local");
    expect(live.activeLearning).toMatchObject({
      collect: true,
      lowConfidence: 0.6,
      maxCandidates: 200,
    });

    live.mode = "hybrid";
    live.activeLearning.collect = false;
    await settings.loadClassificationSettings();
    expect(live.mode).toBe("local");
    expect(live.activeLearning.collect).toBe(true);
  });

  it("merges a partial change into what was saved", async () => {
    await request(app).put("/api/settings/classification").send({ holdUnknown: true });
    await request(app).put("/api/settings/classification").send({ localThreshold: 0.9 });
    const res = await request(app).get("/api/settings/classification");
    expect(res.body.settings).toMatchObject({ holdUnknown: true, localThreshold: 0.9 });
  });

  it.each([
    { mode: "turbo" },
    { localThreshold: 0 },
    { localThreshold: 1.5 },
    { lowConfidence: "high" },
    { maxCandidates: 10 },
    { maxCandidates: 100.5 },
    { unknownKey: true },
  ])("rejects %j", async (body) => {
    const res = await request(app).put("/api/settings/classification").send(body);
    expect(res.status).toBe(400);
  });

  it("refuses a setting that an environment variable fixes, and shows it as locked", async () => {
    process.env.CLASSIFICATION_MODE = "cloud";
    process.env.ACTIVE_LEARNING_COLLECT = "true";
    const get = await request(app).get("/api/settings/classification");
    expect(get.body.locked).toEqual({
      mode: "CLASSIFICATION_MODE",
      collect: "ACTIVE_LEARNING_COLLECT",
    });
    const put = await request(app)
      .put("/api/settings/classification")
      .send({ mode: "local", holdUnknown: true });
    expect(put.status).toBe(409);
    expect(put.body.locked).toEqual(["mode"]);
    // Nothing was applied or saved, not even the free setting sent along with it
    expect(live.holdUnknown).toBe(false);
    expect(await ctx.storage.getSystemConfig("classification.settings")).not.toContain(
      'holdUnknown":true'
    );
  });

  it("does not let a saved value override an environment variable at startup", async () => {
    await request(app).put("/api/settings/classification").send({ mode: "local" });
    process.env.CLASSIFICATION_MODE = "cloud";
    live.mode = "cloud";
    await settings.loadClassificationSettings();
    expect(live.mode).toBe("cloud");
  });

  it("ignores an unreadable saved value", async () => {
    await ctx.storage.setSystemConfig("classification.settings", "{not json");
    live.mode = "hybrid";
    await expect(settings.loadClassificationSettings()).resolves.toBeUndefined();
    expect(live.mode).toBe("hybrid");
  });

  it("makes the pipeline use a new threshold and clears its cache", async () => {
    const index = await import("../classification/index.js");
    const reload = index.releasePipeline.clearCache.bind(index.releasePipeline);
    let cleared = 0;
    index.releasePipeline.clearCache = () => {
      cleared++;
      reload();
    };
    try {
      await request(app).put("/api/settings/classification").send({ localThreshold: 0.8 });
      expect(cleared).toBe(1);
      await request(app).put("/api/settings/classification").send({ holdUnknown: true });
      expect(cleared).toBe(1);
    } finally {
      index.releasePipeline.clearCache = reload;
    }
  });
});
