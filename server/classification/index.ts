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

/** The model sits next to the database by default, so it rides along with the data volume. */
function modelPath(): string {
  return (
    config.classification.modelPath ??
    path.join(path.dirname(path.resolve(config.database.url)), "models", DEFAULT_MODEL_FILE)
  );
}

let local: LocalTfidfClassifier | null | undefined;

function localLayer(): LocalTfidfClassifier | null {
  if (local === undefined) {
    const model = loadLocalModel(modelPath());
    local = model ? new LocalTfidfClassifier(model, config.classification.localThreshold) : null;
  }
  return local;
}

/** Forget the loaded model, e.g. after a new model file was installed. */
export function reloadLocalModel(): void {
  local = undefined;
  releasePipeline.clearCache();
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
