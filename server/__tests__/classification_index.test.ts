import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TfidfClassifier } from "../../scripts/release-benchmark/classifiers/tfidf.js";

vi.mock("../logger.js", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
  return { logger: log };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-classification-"));
const modelFile = path.join(dir, "model.json");
const mockConfig = vi.hoisted(() => ({
  classification: {
    mode: "hybrid" as "local" | "cloud" | "hybrid",
    modelPath: undefined as string | undefined,
    localThreshold: 0.3,
    holdUnknown: false,
  },
  database: { url: "sqlite.db" },
}));
vi.mock("../config.js", () => ({ config: mockConfig }));

const analyzeRelease = vi.hoisted(() => vi.fn());
const isConfigured = vi.hoisted(() => vi.fn());
vi.mock("../typesafe.js", () => ({
  typesafeClient: { analyzeRelease, isConfigured, modelId: "jev-test" },
}));

const { releasePipeline, reloadLocalModel } = await import("../classification/index.js");

const row = (releaseName: string, label: "full_game" | "patch" | "dlc") => ({
  releaseName,
  gameTitle: "Cyber Quest",
  label,
  flags: [],
  rawLabel: label,
});

describe("production classification pipeline", () => {
  beforeEach(() => {
    analyzeRelease.mockReset();
    isConfigured.mockReset().mockResolvedValue(false);
    mockConfig.classification.mode = "hybrid";
    mockConfig.classification.modelPath = modelFile;
    fs.rmSync(modelFile, { force: true });
    reloadLocalModel();
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("uses the installed local model with no cloud provider", async () => {
    const classifier = new TfidfClassifier({ titleAware: false, seed: 1, threshold: 0 });
    classifier.train([
      ...["A", "B", "C"].flatMap((g) => [
        row(`Game ${g} Edition-GRP`, "full_game"),
        row(`Game ${g} Fabulous Mod Pack-GRP`, "dlc"),
      ]),
    ]);
    fs.writeFileSync(modelFile, JSON.stringify(classifier.toModelFile("m1")));
    reloadLocalModel();
    const out = await releasePipeline.classify({
      title: "Game Z Edition-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(out).toMatchObject({ source: "local", modelVersion: "m1", class: "full_game" });
    expect(analyzeRelease).not.toHaveBeenCalled();
  });

  it("is unknown when neither a model nor a provider is available", async () => {
    const out = await releasePipeline.classify({
      title: "Mystery 1.0-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(out.class).toBe("unknown");
    expect(out.path).toEqual(["rules"]);
  });

  it("falls back to the configured provider, but never in local mode", async () => {
    isConfigured.mockResolvedValue(true);
    analyzeRelease.mockResolvedValue({
      releaseType: "update",
      releaseTypeConfidence: 0.95,
      legitimacyScore: null,
    });
    const hybrid = await releasePipeline.classify({
      title: "Mystery 2.0-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(hybrid).toMatchObject({ class: "patch", source: "cloud", modelVersion: "jev-test" });

    mockConfig.classification.mode = "local";
    const local = await releasePipeline.classify({
      title: "Mystery 3.0-GRP",
      gameTitle: "Cyber Quest",
    });
    expect(local.class).toBe("unknown");
    expect(analyzeRelease).toHaveBeenCalledTimes(1);
  });
});
