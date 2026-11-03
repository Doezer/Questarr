import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";
import {
  MEMORY_TTL_MS,
  PERSISTENT_TTL_MS,
  TieredCache,
  settlePendingWrites,
  type PersistentCacheStore,
  type StoredVerdict,
} from "../classification/cache.js";
import {
  ClassificationPipeline,
  type PipelineConfig,
  type PipelineLayers,
} from "../classification/pipeline.js";
import type { Classification } from "../../shared/release-classification.js";
import type { ReleaseClassifier } from "../classification/types.js";

vi.mock("../logger.js", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
  return { logger: log };
});

function fakeStore() {
  const rows = new Map<string, StoredVerdict>();
  const store: PersistentCacheStore = {
    get: async (id) => rows.get(id),
    put: async (row) => void rows.set(row.id, { verdict: row.verdict, storedAt: row.storedAt }),
    prune: vi.fn(async () => 0),
  };
  return { rows, store };
}

const parseNumber = (raw: unknown) => (typeof raw === "number" ? raw : null);

describe("TieredCache", () => {
  it("finds a value again after a restart (a new instance on the same table)", async () => {
    const { store } = fakeStore();
    const first = new TieredCache<number>({ namespace: "analysis", parse: parseNumber, store });
    await first.set("k", 7);
    const restarted = new TieredCache<number>({ namespace: "analysis", parse: parseNumber, store });
    expect(await restarted.get("k")).toBe(7);
  });

  it("keeps namespaces apart", async () => {
    const { store } = fakeStore();
    const a = new TieredCache<number>({ namespace: "analysis", parse: parseNumber, store });
    const b = new TieredCache<number>({ namespace: "pipeline", parse: parseNumber, store });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
  });

  it("serves from memory for a day, then from the table until the persistent TTL", async () => {
    const { store, rows } = fakeStore();
    let now = 1_000_000;
    const cache = new TieredCache<number>({
      namespace: "analysis",
      parse: parseNumber,
      store,
      now: () => now,
    });
    await cache.set("k", 3);
    rows.clear();
    now += MEMORY_TTL_MS - 1;
    expect(await cache.get("k")).toBe(3);
    now += 2;
    expect(await cache.get("k")).toBeNull();
  });

  it("ignores a stored row older than the persistent TTL", async () => {
    const { store } = fakeStore();
    let now = 1_000_000;
    const cache = new TieredCache<number>({
      namespace: "analysis",
      parse: parseNumber,
      store,
      now: () => now,
    });
    await cache.set("k", 3);
    now += PERSISTENT_TTL_MS + 1;
    const restarted = new TieredCache<number>({
      namespace: "analysis",
      parse: parseNumber,
      store,
      now: () => now,
    });
    expect(await restarted.get("k")).toBeNull();
  });

  it("treats a row with an unexpected shape as a miss", async () => {
    const { store, rows } = fakeStore();
    const cache = new TieredCache<number>({ namespace: "analysis", parse: parseNumber, store });
    await cache.set("k", 3);
    for (const [id, row] of rows) rows.set(id, { ...row, verdict: '{"class":"full_game"}' });
    const restarted = new TieredCache<number>({ namespace: "analysis", parse: parseNumber, store });
    expect(await restarted.get("k")).toBeNull();
  });

  it("keeps working when the table fails", async () => {
    const broken: PersistentCacheStore = {
      get: async () => {
        throw new Error("db down");
      },
      put: async () => {
        throw new Error("db down");
      },
      prune: async () => 0,
    };
    const cache = new TieredCache<number>({
      namespace: "analysis",
      parse: parseNumber,
      store: broken,
    });
    await expect(cache.set("k", 1)).resolves.toBeUndefined();
    expect(await cache.get("k")).toBe(1);
    expect(await cache.get("other")).toBeNull();
  });

  it("drops a write that started before a clear", async () => {
    const { store, rows } = fakeStore();
    const cache = new TieredCache<number>({ namespace: "analysis", parse: parseNumber, store });
    const generation = cache.generation;
    cache.clearMemory();
    await cache.set("k", 1, generation);
    expect(rows.size).toBe(0);
    expect(await cache.get("k")).toBeNull();
  });

  it("lets a write under way finish before a clear can delete the table", async () => {
    const { rows } = fakeStore();
    let release: () => void = () => {};
    const slow: PersistentCacheStore = {
      get: async () => undefined,
      put: async (row) => {
        await new Promise<void>((resolve) => (release = resolve));
        rows.set(row.id, { verdict: row.verdict, storedAt: row.storedAt });
      },
      prune: async () => 0,
    };
    const cache = new TieredCache<number>({
      namespace: "analysis",
      parse: parseNumber,
      store: slow,
    });
    const writing = cache.set("k", 1);
    let settled = false;
    const done = settlePendingWrites().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await writing;
    await done;
    expect(rows.size).toBe(1);
  });

  it("prunes at most once an hour", async () => {
    const { store } = fakeStore();
    let now = 5_000_000_000;
    const cache = new TieredCache<number>({
      namespace: "analysis",
      parse: parseNumber,
      store,
      now: () => now,
    });
    await cache.set("a", 1);
    await cache.set("b", 2);
    expect(store.prune).toHaveBeenCalledTimes(1);
    now += 60 * 60 * 1000;
    await cache.set("c", 3);
    expect(store.prune).toHaveBeenCalledTimes(2);
  });
});

describe("ClassificationPipeline persistent cache", () => {
  const config: PipelineConfig = { mode: "hybrid", localVersion: "m1", cloudVersion: "jev#1" };
  const rulesUnknown: ReleaseClassifier = {
    classify: async (): Promise<Classification> => ({
      class: "unknown",
      confidence: null,
      source: "rules",
    }),
  };
  const layersWith = (
    local: ReleaseClassifier | null,
    cloud: ReleaseClassifier | null = null
  ): PipelineLayers => ({ rules: rulesUnknown, local, cloud });
  const answering = (result: Classification) => {
    const classify = vi.fn(async () => result);
    return { classify } as ReleaseClassifier & { classify: typeof classify };
  };
  const input = { title: "Some Game Update v1.2-GRP", gameTitle: "Some Game" };

  it("does not ask the layers again after a restart", async () => {
    const { store } = fakeStore();
    const local = answering({ class: "patch", confidence: 0.9, source: "local" });
    const first = new ClassificationPipeline(
      () => config,
      () => layersWith(local),
      { store }
    );
    expect((await first.classify(input)).class).toBe("patch");

    const idle = answering({ class: "full_game", confidence: 0.9, source: "local" });
    const restarted = new ClassificationPipeline(
      () => config,
      () => layersWith(idle),
      { store }
    );
    const again = await restarted.classify(input);
    expect(again.class).toBe("patch");
    expect(idle.classify).not.toHaveBeenCalled();
  });

  it("never stores the answer of a failed layer", async () => {
    const { store, rows } = fakeStore();
    const failing: ReleaseClassifier = {
      classify: async () => {
        throw new Error("boom");
      },
    };
    const pipeline = new ClassificationPipeline(
      () => config,
      () => layersWith(failing),
      {
        store,
      }
    );
    const result = await pipeline.classify(input);
    expect(result.degraded).toBe(true);
    expect(rows.size).toBe(0);
  });

  it("keeps an unknown verdict unknown", async () => {
    const { store } = fakeStore();
    const local = answering({ class: "unknown", confidence: 0.2, source: "local" });
    const first = new ClassificationPipeline(
      () => config,
      () => layersWith(local),
      { store }
    );
    await first.classify(input);
    const restarted = new ClassificationPipeline(
      () => config,
      () => layersWith(null),
      { store }
    );
    expect((await restarted.classify(input)).class).toBe("unknown");
  });

  it.each([
    ["a new local model", { ...config, localVersion: "m2" }],
    ["a changed confidence bar", { ...config, localThreshold: 0.5 }],
    ["a changed cloud provider", { ...config, cloudFingerprint: "other@1" }],
    ["another mode", { ...config, mode: "local" as const }],
  ])("does not reuse a verdict after %s", async (_label, changed) => {
    const { store } = fakeStore();
    const first = new ClassificationPipeline(
      () => ({ ...config, cloudFingerprint: "jev@1" }),
      () => layersWith(answering({ class: "patch", confidence: 0.9, source: "local" })),
      { store }
    );
    await first.classify(input);
    const next = answering({ class: "dlc", confidence: 0.9, source: "local" });
    const restarted = new ClassificationPipeline(
      () => changed,
      () => layersWith(next),
      { store }
    );
    expect((await restarted.classify(input)).class).toBe("dlc");
  });

  it("does not store a verdict when the provider changed while the layers ran", async () => {
    const { store, rows } = fakeStore();
    let current = { ...config, cloudFingerprint: "jev@A" };
    const local: ReleaseClassifier = {
      classify: async () => {
        current = { ...config, cloudFingerprint: "jev@B" };
        return { class: "patch", confidence: 0.9, source: "local" };
      },
    };
    const pipeline = new ClassificationPipeline(
      () => current,
      () => layersWith(local),
      { store }
    );
    expect((await pipeline.classify(input)).class).toBe("patch");
    expect(rows.size).toBe(0);
  });

  it("rejects a stored result whose class is no longer known", async () => {
    const { store, rows } = fakeStore();
    const local = answering({ class: "patch", confidence: 0.9, source: "local" });
    const first = new ClassificationPipeline(
      () => config,
      () => layersWith(local),
      { store }
    );
    await first.classify(input);
    for (const [id, row] of rows) {
      rows.set(id, { ...row, verdict: row.verdict.replace('"patch"', '"hologram"') });
    }
    const next = answering({ class: "dlc", confidence: 0.9, source: "local" });
    const restarted = new ClassificationPipeline(
      () => config,
      () => layersWith(next),
      { store }
    );
    expect((await restarted.classify(input)).class).toBe("dlc");
  });
});

describe.each(activeTestDialects())("classification cache table on %s", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const { classificationSettingsRoutes } = await import("../classification-settings-routes.js");
    app = express();
    app.use(express.json());
    app.use(classificationSettingsRoutes);
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  const row = (id: string, ageMs: number) => ({
    id,
    namespace: "pipeline" as const,
    verdict: "{}",
    storedAt: new Date(Date.now() - ageMs),
  });

  it("stores, replaces and reads back a row", async () => {
    const { storage } = ctx;
    await storage.clearClassificationCache();
    await storage.putClassificationCacheEntry({ ...row("pipeline:a", 0), verdict: '{"v":1}' });
    await storage.putClassificationCacheEntry({ ...row("pipeline:a", 0), verdict: '{"v":2}' });
    expect((await storage.getClassificationCacheEntry("pipeline:a"))?.verdict).toBe('{"v":2}');
    expect(await storage.countClassificationCache()).toBe(1);
  });

  it("prunes expired rows, then the oldest beyond the limit", async () => {
    const { storage } = ctx;
    await storage.clearClassificationCache();
    const day = 24 * 60 * 60 * 1000;
    await storage.putClassificationCacheEntry(row("pipeline:old", 10 * day));
    for (let i = 0; i < 5; i++) {
      await storage.putClassificationCacheEntry(row(`pipeline:r${i}`, (5 - i) * 1000));
    }
    const removed = await storage.pruneClassificationCache(new Date(Date.now() - 7 * day), 3);
    expect(removed).toBe(3);
    expect(await storage.getClassificationCacheEntry("pipeline:old")).toBeUndefined();
    expect(await storage.getClassificationCacheEntry("pipeline:r0")).toBeUndefined();
    expect(await storage.getClassificationCacheEntry("pipeline:r4")).toBeDefined();
    expect(await storage.countClassificationCache()).toBe(3);
  });

  it("keeps the rows inside the limit when several share the cut's timestamp", async () => {
    const { storage } = ctx;
    await storage.clearClassificationCache();
    const same = new Date(Date.now() - 1000);
    for (const id of ["pipeline:a", "pipeline:b", "pipeline:c", "pipeline:d"]) {
      await storage.putClassificationCacheEntry({
        id,
        namespace: "pipeline",
        verdict: "{}",
        storedAt: same,
      });
    }
    const removed = await storage.pruneClassificationCache(new Date(0), 3);
    expect(removed).toBe(1);
    expect(await storage.countClassificationCache()).toBe(3);
    expect(await storage.getClassificationCacheEntry("pipeline:a")).toBeUndefined();
  });

  it("reports and clears the cache from the settings routes", async () => {
    const { storage } = ctx;
    await storage.clearClassificationCache();
    await storage.putClassificationCacheEntry(row("analysis:x", 0));
    await storage.putClassificationCacheEntry(row("pipeline:y", 0));

    const overview = await request(app).get("/api/settings/classification");
    expect(overview.body.cache).toEqual({ entries: 2 });

    const cleared = await request(app).delete("/api/settings/classification/cache");
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ cleared: 2 });
    expect(await storage.countClassificationCache()).toBe(0);
  });
});
