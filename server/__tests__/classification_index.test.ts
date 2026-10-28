import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const provider = vi.hoisted(() => ({ configRevision: 0 }));
vi.mock("../typesafe.js", () => ({
  typesafeClient: {
    analyzeRelease,
    isConfigured,
    modelId: "jev-test",
    get configRevision() {
      return provider.configRevision;
    },
  },
}));

const { localGuess, releasePipeline, reloadLocalModel } =
  await import("../classification/index.js");

const row = (releaseName: string, label: "full_game" | "patch" | "dlc") => ({
  releaseName,
  gameTitle: "Cyber Quest",
  label,
  flags: [],
  rawLabel: label,
});

let cwd: ReturnType<typeof vi.spyOn>;

describe("production classification pipeline", () => {
  beforeEach(() => {
    analyzeRelease.mockReset();
    isConfigured.mockReset().mockResolvedValue(false);
    provider.configRevision = 0;
    mockConfig.classification.mode = "hybrid";
    mockConfig.classification.modelPath = modelFile;
    fs.rmSync(modelFile, { force: true });
    // The bundled model is resolved from the working directory: hide it unless a test asks for it
    cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    reloadLocalModel();
  });
  afterEach(() => cwd.mockRestore());
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

  it("falls back to the model shipped with the application, and lets an installed one win", async () => {
    cwd.mockRestore();
    mockConfig.classification.modelPath = undefined;
    mockConfig.database.url = path.join(dir, "sqlite.db");
    mockConfig.classification.localThreshold = 0.7;
    reloadLocalModel();
    const bundled = localGuess({ title: "Some.Game-FitGirl.Repack", gameTitle: "Some Game" });
    expect(bundled).toMatchObject({ class: "full_game" });
    expect(bundled?.modelVersion).toMatch(/^tfidf-/);

    // A name with no known n-gram must abstain, not be scored by the model's bias alone
    expect(localGuess({ title: "漢字", gameTitle: "Some Game" })).toBeNull();
    const unscorable = await releasePipeline.classify({ title: "漢字", gameTitle: "Some Game" });
    expect(unscorable.class).toBe("unknown");

    fs.mkdirSync(path.join(dir, "models"), { recursive: true });
    const classifier = new TfidfClassifier({ titleAware: false, seed: 1, threshold: 0 });
    classifier.train(
      ["A", "B", "C"].flatMap((g) => [
        row(`Game ${g} Edition-GRP`, "full_game"),
        row(`Game ${g} Fabulous Mod Pack-GRP`, "dlc"),
      ])
    );
    fs.writeFileSync(
      path.join(dir, "models", "release-classifier.json"),
      JSON.stringify(classifier.toModelFile("installed"))
    );
    reloadLocalModel();
    expect(
      localGuess({ title: "Game Z Edition-GRP", gameTitle: "Cyber Quest" })?.modelVersion
    ).toBe("installed");

    mockConfig.database.url = "sqlite.db";
    mockConfig.classification.localThreshold = 0.3;
    fs.rmSync(path.join(dir, "models"), { recursive: true, force: true });
  });

  it("falls through to the bundled model when the configured file is refused", async () => {
    cwd.mockRestore();
    fs.writeFileSync(modelFile, "{ not a model");
    reloadLocalModel();
    const guessed = localGuess({ title: "Some.Game-FitGirl.Repack", gameTitle: "Some Game" });
    expect(guessed?.modelVersion).toMatch(/^tfidf-/);
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

  it("does not reuse a cached answer after the provider settings change", async () => {
    isConfigured.mockResolvedValue(true);
    analyzeRelease.mockResolvedValue({
      releaseType: "dlc",
      releaseTypeConfidence: 0.9,
      legitimacyScore: null,
    });
    const input = { title: "Mystery 4.0-GRP", gameTitle: "Cyber Quest" };
    await releasePipeline.classify(input);
    await releasePipeline.classify(input);
    expect(analyzeRelease).toHaveBeenCalledTimes(1);
    provider.configRevision++;
    await releasePipeline.classify(input);
    expect(analyzeRelease).toHaveBeenCalledTimes(2);
  });
});
