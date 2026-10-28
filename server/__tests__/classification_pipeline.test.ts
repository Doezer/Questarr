import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TfidfClassifier } from "../../scripts/release-benchmark/classifiers/tfidf.js";
import type { LabeledRelease } from "../../scripts/release-benchmark/types.js";
import type { Classification } from "../../shared/release-classification.js";
import { TfidfModelError, TfidfScorer, parseTfidfModel } from "../../shared/release-tfidf.js";
import { cloudClassifier } from "../classification/cloud.js";
import { LocalTfidfClassifier, loadLocalModel } from "../classification/local.js";
import {
  ClassificationPipeline,
  type PipelineConfig,
  type PipelineLayers,
} from "../classification/pipeline.js";
import { rulesClassifier, type ReleaseClassifier } from "../classification/types.js";

vi.mock("../logger.js", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
  return { logger: log };
});

const row = (releaseName: string, label: LabeledRelease["label"]): LabeledRelease => ({
  releaseName,
  gameTitle: "Cyber Quest",
  label,
  flags: [],
  rawLabel: label,
});

const TRAINING: LabeledRelease[] = [
  ...["Cyber Quest-GRP", "Cyber Quest MULTi5-GRP", "Cyber Quest Deluxe Edition-GRP"].flatMap(
    (n) => [row(n, "full_game"), row(n.replace("Cyber Quest", "Neon Farm"), "full_game")]
  ),
  ...[
    "Cyber Quest Update v1.2-GRP",
    "Cyber Quest Patch v2.0-GRP",
    "Cyber Quest Hotfix 3-GRP",
  ].flatMap((n) => [row(n, "patch"), row(n.replace("Cyber Quest", "Neon Farm"), "patch")]),
  ...[
    "Cyber Quest Skin Pack DLC-GRP",
    "Cyber Quest Season Pass DLC-GRP",
    "Cyber Quest Map Pack DLC-GRP",
  ].flatMap((n) => [row(n, "dlc"), row(n.replace("Cyber Quest", "Neon Farm"), "dlc")]),
  row("Random Tool Crack Only-GRP", "unknown"),
  row("Other Tool Crack Only-GRP", "unknown"),
];

function trainedModel() {
  const classifier = new TfidfClassifier({ titleAware: false, seed: 7, threshold: 0 });
  classifier.train(TRAINING);
  return { classifier, file: classifier.toModelFile("test-v1") };
}

const result = (
  source: Classification["source"],
  cls: Classification["class"],
  extra: Partial<Classification> = {}
): Classification => ({ class: cls, confidence: 0.9, source, ...extra });

function layersOf(
  local: ReleaseClassifier | null,
  cloud: ReleaseClassifier | null
): () => PipelineLayers {
  return () => ({ rules: rulesClassifier, local, cloud });
}

const configOf =
  (
    mode: PipelineConfig["mode"],
    localVersion: string | null = "L1",
    cloudVersion: string | null = "C1"
  ) =>
  () => ({ mode, localVersion, cloudVersion });

const spy = (answer: Classification | (() => Promise<Classification>)) =>
  vi.fn(async () => (typeof answer === "function" ? answer() : answer));

// "Mystery Thing" has no rule evidence: the rules layer says unknown for it
const UNRULED = { title: "Mystery Thing 1.0-GRP", gameTitle: "Cyber Quest" };

describe("tf-idf model file", () => {
  it("scores identically to the trained classifier after a JSON round trip", async () => {
    const { classifier, file } = trainedModel();
    const scorer = new TfidfScorer(parseTfidfModel(JSON.parse(JSON.stringify(file))));
    for (const sample of [
      "Cyber Quest Update v1.3-GRP",
      "Cyber Quest-GRP",
      "Neon Farm Map Pack DLC",
    ]) {
      const trained = await classifier.classify(row(sample, "unknown"));
      const predicted = scorer.predict({ title: sample, gameTitle: "Cyber Quest" });
      expect(predicted.class).toBe(trained.label);
      expect(predicted.confidence).toBeCloseTo(trained.confidence ?? 0, 10);
    }
  });

  it("refuses damaged or foreign files", () => {
    const { file } = trainedModel();
    expect(() => parseTfidfModel(null)).toThrow(TfidfModelError);
    expect(() => parseTfidfModel({ ...file, format: 2 })).toThrow(/format/);
    expect(() => parseTfidfModel({ ...file, idf: file.idf.slice(1) })).toThrow(/vocab/);
    expect(() => parseTfidfModel({ ...file, bias: [0] })).toThrow(/bias/);
    expect(() => parseTfidfModel({ ...file, classes: ["a", "b", "c", "d"] })).toThrow(/classes/);
    expect(() => parseTfidfModel({ ...file, ngram: { min: 2, max: 99 } })).toThrow(/ngram/);
    const bad = structuredClone(file);
    bad.weights[0]![0] = Number.NaN;
    expect(() => parseTfidfModel(bad)).toThrow(/weights row/);
  });

  it("loads from disk, and treats a missing or broken file as no model", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-model-"));
    try {
      const good = path.join(dir, "model.json");
      fs.writeFileSync(good, JSON.stringify(trainedModel().file));
      expect(loadLocalModel(good)?.modelVersion).toBe("test-v1");
      expect(loadLocalModel(path.join(dir, "absent.json"))).toBeNull();
      const broken = path.join(dir, "broken.json");
      fs.writeFileSync(broken, "{not json");
      expect(loadLocalModel(broken)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("local layer", () => {
  it("decides above the threshold and abstains below it", async () => {
    const { file } = trainedModel();
    const decided = await new LocalTfidfClassifier(file, 0.3).classify({
      title: "Cyber Quest Update v1.9-GRP",
    });
    expect(decided).toMatchObject({ class: "patch", source: "local", modelVersion: "test-v1" });
    const abstained = await new LocalTfidfClassifier(file, 0.9999).classify({
      title: "Cyber Quest Update v1.9-GRP",
    });
    expect(abstained.class).toBe("unknown");
    expect(abstained.confidence).toBeGreaterThan(0);
  });

  it("abstains when a title-aware model has no game title", async () => {
    const classifier = new TfidfClassifier({ titleAware: true, seed: 7, threshold: 0 });
    classifier.train(TRAINING);
    const layer = new LocalTfidfClassifier(classifier.toModelFile("aware"), 0);
    expect((await layer.classify({ title: "Cyber Quest-GRP" })).class).toBe("unknown");
  });
});

describe("cloud layer", () => {
  const provider = (
    answer: Awaited<ReturnType<Parameters<typeof cloudClassifier>[0]["analyzeRelease"]>>
  ) => cloudClassifier({ analyzeRelease: async () => answer }, 0.6, () => "jev-test");

  it("maps provider types onto classes and flags", async () => {
    const analysis = (releaseType: "update" | "repack" | "demo" | "dlc") => ({
      releaseType,
      releaseTypeConfidence: 0.9,
      legitimacyScore: 0.8,
    });
    expect(await provider(analysis("update")).classify({ title: "x" })).toMatchObject({
      class: "patch",
      source: "cloud",
      modelVersion: "jev-test",
      legitimacyScore: 0.8,
    });
    expect(await provider(analysis("repack")).classify({ title: "x" })).toMatchObject({
      class: "full_game",
      flags: ["repack"],
    });
    expect(await provider(analysis("demo")).classify({ title: "x" })).toMatchObject({
      class: "unknown",
      flags: ["demo"],
    });
  });

  it("resolves to unknown for a missing, invalid or low-confidence answer", async () => {
    expect((await provider(null).classify({ title: "x" })).class).toBe("unknown");
    expect(
      (
        await provider({
          releaseType: null,
          releaseTypeConfidence: 0.99,
          legitimacyScore: null,
        }).classify({ title: "x" })
      ).class
    ).toBe("unknown");
    const low = await provider({
      releaseType: "dlc",
      releaseTypeConfidence: 0.3,
      legitimacyScore: null,
    }).classify({
      title: "x",
    });
    expect(low).toMatchObject({ class: "unknown", confidence: 0.3 });
  });

  it("keeps the size judgment when the type is uncertain", async () => {
    const out = await provider({
      releaseType: "dlc",
      releaseTypeConfidence: 0.4,
      legitimacyScore: 0.1,
    }).classify({ title: "x" });
    expect(out).toMatchObject({ class: "unknown", legitimacyScore: 0.1 });
    const invalid = await provider({
      releaseType: null,
      releaseTypeConfidence: null,
      legitimacyScore: 0.2,
    }).classify({ title: "x" });
    expect(invalid).toMatchObject({ class: "unknown", legitimacyScore: 0.2 });
  });
});

describe("pipeline modes", () => {
  it("answers from the rules without consulting any model", async () => {
    const local = spy(result("local", "dlc"));
    const cloud = spy(result("cloud", "dlc"));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: local }, { classify: cloud })
    );
    const out = await pipeline.classify({
      title: "Cyber Quest Update v1.2-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(out).toMatchObject({ class: "patch", source: "rules", path: ["rules"] });
    expect(local).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
  });

  it("does not stop at the rules for a repack-only name, and keeps the repack flag", async () => {
    const cloud = spy(result("cloud", "dlc"));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf(
        { classify: spy(result("local", "unknown", { confidence: 0.1 })) },
        { classify: cloud }
      )
    );
    const out = await pipeline.classify({
      title: "Mystery Thing 1.0 REPACK-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(out).toMatchObject({ class: "dlc", source: "cloud", flags: ["repack"] });
    expect(out.path).toEqual(["rules", "local", "cloud"]);
  });

  it("stops at the rules when they found a content flag", async () => {
    const local = spy(result("local", "full_game"));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: local }, null)
    );
    const out = await pipeline.classify({
      title: "Cyber Quest Crack Only-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(out.flags).toContain("crack_only");
    expect(local).not.toHaveBeenCalled();
  });

  it("local mode never calls the cloud, even when nothing decides", async () => {
    const cloud = spy(result("cloud", "dlc"));
    const local = spy(result("local", "unknown", { confidence: 0.2 }));
    const pipeline = new ClassificationPipeline(
      configOf("local"),
      layersOf({ classify: local }, { classify: cloud })
    );
    const out = await pipeline.classify(UNRULED);
    expect(out).toMatchObject({ class: "unknown", source: "local", path: ["rules", "local"] });
    expect(cloud).not.toHaveBeenCalled();
  });

  it("hybrid keeps a confident local answer and skips the cloud", async () => {
    const cloud = spy(result("cloud", "dlc"));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: spy(result("local", "full_game")) }, { classify: cloud })
    );
    expect(await pipeline.classify(UNRULED)).toMatchObject({ class: "full_game", source: "local" });
    expect(cloud).not.toHaveBeenCalled();
  });

  it.each([
    ["abstains", () => spy(result("local", "unknown", { confidence: 0.1 }))],
    ["throws", () => vi.fn(async () => Promise.reject(new Error("boom")))],
  ])("hybrid asks the cloud when the local layer %s", async (_name, makeLocal) => {
    const cloud = spy(result("cloud", "dlc", { legitimacyScore: 0.9 } as Partial<Classification>));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: makeLocal() }, { classify: cloud })
    );
    const out = await pipeline.classify(UNRULED);
    expect(out).toMatchObject({ class: "dlc", source: "cloud", path: ["rules", "local", "cloud"] });
    expect(out.legitimacyScore).toBe(0.9);
  });

  it("hybrid asks the cloud when the local layer hangs", async () => {
    const hang = vi.fn(() => new Promise<Classification>(() => undefined));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: hang }, { classify: spy(result("cloud", "patch")) }),
      { layerTimeoutMs: 20 }
    );
    expect(await pipeline.classify(UNRULED)).toMatchObject({ class: "patch", source: "cloud" });
  });

  it("cloud mode skips the local model", async () => {
    const local = spy(result("local", "dlc"));
    const pipeline = new ClassificationPipeline(
      configOf("cloud"),
      layersOf({ classify: local }, { classify: spy(result("cloud", "full_game")) })
    );
    expect(await pipeline.classify(UNRULED)).toMatchObject({
      source: "cloud",
      path: ["rules", "cloud"],
    });
    expect(local).not.toHaveBeenCalled();
  });

  it("is unknown, never a full game, when no layer is available or all fail", async () => {
    const none = new ClassificationPipeline(configOf("hybrid"), layersOf(null, null));
    expect(await none.classify(UNRULED)).toMatchObject({ class: "unknown", path: ["rules"] });
    const failing = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf(
        { classify: vi.fn(async () => Promise.reject(new Error("local down"))) },
        { classify: vi.fn(async () => Promise.reject(new Error("cloud down"))) }
      )
    );
    const out = await failing.classify(UNRULED);
    expect(out.class).toBe("unknown");
    expect(out.ruleIds).toContain("cloud.error");
  });

  it("never lets a layer's full_game answer through without the layer deciding it", async () => {
    // a cloud layer that resolves unknown must not be turned into anything else
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf(null, { classify: spy(result("cloud", "unknown")) })
    );
    expect((await pipeline.classify(UNRULED)).class).toBe("unknown");
  });
});

describe("pipeline cache", () => {
  it("serves a repeat call from the cache and misses when a version changes", async () => {
    const cloud = spy(result("cloud", "dlc"));
    let cloudVersion = "C1";
    const pipeline = new ClassificationPipeline(
      () => ({ mode: "cloud" as const, localVersion: null, cloudVersion }),
      layersOf(null, { classify: cloud })
    );
    await pipeline.classify(UNRULED);
    await pipeline.classify(UNRULED);
    expect(cloud).toHaveBeenCalledTimes(1);
    cloudVersion = "C2";
    await pipeline.classify(UNRULED);
    expect(cloud).toHaveBeenCalledTimes(2);
  });

  it("does not let a call that started before clearCache() write its result back", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const cloud = spy(async () => {
      await gate;
      return result("cloud", "full_game");
    });
    const pipeline = new ClassificationPipeline(
      configOf("cloud"),
      layersOf(null, { classify: cloud })
    );
    const inFlight = pipeline.classify(UNRULED);
    await vi.waitFor(() => expect(cloud).toHaveBeenCalledTimes(1));
    pipeline.clearCache();
    release();
    await inFlight;
    await pipeline.classify(UNRULED);
    expect(cloud).toHaveBeenCalledTimes(2);
  });

  it("keys on the exact size, since the cloud model sees it", async () => {
    const cloud = spy(result("cloud", "dlc"));
    const pipeline = new ClassificationPipeline(
      configOf("cloud"),
      layersOf(null, { classify: cloud })
    );
    await pipeline.classify({ ...UNRULED, sizeBytes: 1_200_000 });
    await pipeline.classify({ ...UNRULED, sizeBytes: 1_400_000 });
    expect(cloud).toHaveBeenCalledTimes(2);
  });

  it("marks a failing layer degraded and does not cache an invalid cloud answer", async () => {
    const invalid = spy(() =>
      Promise.resolve({ ...result("cloud", "unknown"), ruleIds: ["cloud.invalid-answer"] })
    );
    const pipeline = new ClassificationPipeline(
      configOf("cloud"),
      layersOf(null, { classify: invalid })
    );
    const first = await pipeline.classify(UNRULED);
    await pipeline.classify(UNRULED);
    expect(first.degraded).toBe(true);
    expect(invalid).toHaveBeenCalledTimes(2);
    const ordinary = new ClassificationPipeline(
      configOf("cloud"),
      layersOf(null, { classify: spy(result("cloud", "unknown", { confidence: 0.2 })) })
    );
    expect((await ordinary.classify(UNRULED)).degraded).toBeUndefined();
  });

  it("keeps a real cloud unknown non-degraded after a local failure, but does not cache it", async () => {
    const local = spy(() =>
      Promise.resolve({ ...result("local", "unknown"), ruleIds: ["local.error"] })
    );
    const cloud = spy(result("cloud", "unknown", { confidence: 0.2 }));
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: local }, { classify: cloud })
    );
    const first = await pipeline.classify(UNRULED);
    expect(first.path).toEqual(["rules", "local", "cloud"]);
    expect(first.degraded).toBeUndefined();
    await pipeline.classify(UNRULED);
    expect(cloud).toHaveBeenCalledTimes(2);
  });

  it("keeps a local failure as degraded when hybrid has no cloud layer to fall back on", async () => {
    const local = spy(() =>
      Promise.resolve({ ...result("local", "unknown"), ruleIds: ["local.error"] })
    );
    const pipeline = new ClassificationPipeline(
      configOf("hybrid"),
      layersOf({ classify: local }, null)
    );
    const first = await pipeline.classify(UNRULED);
    expect(first.path).toEqual(["rules", "local"]);
    expect(first.degraded).toBe(true);
  });

  it("expires entries and does not cache failures", async () => {
    let now = 0;
    const failing = spy(() =>
      Promise.resolve({ ...result("cloud", "unknown"), ruleIds: ["cloud.unavailable"] })
    );
    const pipeline = new ClassificationPipeline(
      configOf("cloud"),
      layersOf(null, { classify: failing }),
      {
        now: () => now,
      }
    );
    await pipeline.classify(UNRULED);
    await pipeline.classify(UNRULED);
    expect(failing).toHaveBeenCalledTimes(2);

    const ok = spy(result("cloud", "dlc"));
    const cached = new ClassificationPipeline(configOf("cloud"), layersOf(null, { classify: ok }), {
      now: () => now,
    });
    await cached.classify(UNRULED);
    now += 25 * 60 * 60 * 1000;
    await cached.classify(UNRULED);
    expect(ok).toHaveBeenCalledTimes(2);
  });
});
