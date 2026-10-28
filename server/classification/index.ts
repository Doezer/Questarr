import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { typesafeClient } from "../typesafe.js";
import { cloudClassifier } from "./cloud.js";
import { LocalTfidfClassifier, loadLocalModel } from "./local.js";
import { ClassificationPipeline, type PipelineLayers } from "./pipeline.js";
import { rulesClassifier } from "./types.js";

export { type PipelineResult } from "./pipeline.js";

/** Cloud answers need at least this confidence, the bar auto-download already applies to Jev. */
const CLOUD_ACCEPT_THRESHOLD = 0.6;
const DEFAULT_MODEL_FILE = "release-classifier.json";

/** The model shipped with the application, read from the working directory (the repo root or /app). */
const BUNDLED_MODEL = path.join("shared", "models", DEFAULT_MODEL_FILE);

/**
 * Model files in priority order: `CLASSIFIER_MODEL_PATH`, then a model next to the database (so a
 * retrained one rides along with the data volume and overrides the bundled one), then the model
 * shipped with the application. A candidate that is missing or refused falls through to the next.
 */
function modelCandidates(): string[] {
  const installed = path.join(
    path.dirname(path.resolve(config.database.url)),
    "models",
    DEFAULT_MODEL_FILE
  );
  return [
    config.classification.modelPath,
    fs.existsSync(installed) ? installed : null,
    path.resolve(BUNDLED_MODEL),
  ].filter((candidate): candidate is string => !!candidate);
}

function loadFirstModel(): {
  model: NonNullable<ReturnType<typeof loadLocalModel>>;
  path: string;
} | null {
  for (const candidate of modelCandidates()) {
    const model = loadLocalModel(candidate);
    if (model) return { model, path: candidate };
  }
  return null;
}

let local: LocalTfidfClassifier | null | undefined;
let localPath = "";

function localLayer(): LocalTfidfClassifier | null {
  if (local === undefined) {
    const loaded = loadFirstModel();
    localPath = loaded?.path ?? modelCandidates()[0] ?? "";
    local = loaded
      ? new LocalTfidfClassifier(loaded.model, config.classification.localThreshold)
      : null;
  }
  return local;
}

/** Forget the loaded model, e.g. after a new model file was installed. */
export function reloadLocalModel(): void {
  local = undefined;
  releasePipeline.clearCache();
}

/** Whether a local model file is installed and loaded, for the Settings page. */
export function localModelStatus(): { installed: boolean; version: string | null; path: string } {
  const layer = localLayer();
  return { installed: layer !== null, version: layer?.modelVersion ?? null, path: localPath };
}

/** The local model's best guess for a release, or null when no model is installed. */
export function localGuess(
  input: Parameters<LocalTfidfClassifier["guess"]>[0]
): (ReturnType<LocalTfidfClassifier["guess"]> & object & { modelVersion: string }) | null {
  const layer = localLayer();
  const guessed = layer?.guess(input);
  return layer && guessed ? { ...guessed, modelVersion: layer.modelVersion } : null;
}

async function layers(): Promise<PipelineLayers> {
  return {
    rules: rulesClassifier,
    local: config.classification.mode === "cloud" ? null : localLayer(),
    cloud:
      config.classification.mode !== "local" && (await typesafeClient.isConfigured())
        ? cloudClassifier(typesafeClient, CLOUD_ACCEPT_THRESHOLD, () => typesafeClient.modelId)
        : null,
  };
}

/** The server's classification pipeline; its mode comes from `CLASSIFICATION_MODE`. */
export const releasePipeline = new ClassificationPipeline(async () => {
  const { mode } = config.classification;
  return {
    mode,
    localVersion: mode === "cloud" ? null : (localLayer()?.modelVersion ?? null),
    // Without a provider the cloud layer is absent, so a later configuration must not hit a stale entry
    cloudVersion:
      mode !== "local" && (await typesafeClient.isConfigured())
        ? `${typesafeClient.modelId}#${typesafeClient.configRevision}`
        : null,
  };
}, layers);
