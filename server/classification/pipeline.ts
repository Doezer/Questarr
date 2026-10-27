import type { Classification } from "../../shared/release-classification.js";
import { logger } from "../logger.js";
import type { CloudInput, ReleaseClassifier } from "./types.js";

const pipelineLogger = logger.child({ module: "classification" });

export const CLASSIFICATION_MODES = ["local", "cloud", "hybrid"] as const;
export type ClassificationMode = (typeof CLASSIFICATION_MODES)[number];

/** Bump when the pipeline's own rules change, so older cached results are not reused. */
export const PIPELINE_VERSION = 1;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const DEFAULT_LAYER_TIMEOUT_MS = 10_000;

export interface PipelineConfig {
  mode: ClassificationMode;
  /** Version tags that belong in cache keys: the local model and the cloud model. */
  localVersion: string | null;
  cloudVersion: string | null;
}

export interface PipelineLayers {
  rules: ReleaseClassifier;
  /** Absent when no model file is installed. */
  local: ReleaseClassifier | null;
  /** Absent when no cloud provider is configured. */
  cloud: ReleaseClassifier | null;
}

export type PipelineResult = Classification & {
  /** Layers consulted, in order; shows why a hybrid call went to the cloud. */
  path: ("rules" | "local" | "cloud")[];
  legitimacyScore?: number | null;
  /** A consulted layer failed, timed out or gave an unusable answer; `unknown` here is not a verdict. */
  degraded?: boolean;
};

/** Flags that say what the release is. `repack` only says how it is packaged, so it decides nothing. */
const RESOLVING_FLAGS = new Set(["crack_only", "demo", "soundtrack", "other_artifact"]);

const FAILURE_IDS = new Set([
  "local.error",
  "local.timeout",
  "cloud.unavailable",
  "cloud.invalid-answer",
  "cloud.error",
  "cloud.timeout",
]);
const failed = (result: Classification): boolean =>
  result.ruleIds?.some((id) => FAILURE_IDS.has(id)) ?? false;

const unresolved = (result: Classification): boolean =>
  result.class === "unknown" && !(result.flags ?? []).some((flag) => RESOLVING_FLAGS.has(flag));

/** Runs a layer without letting it throw or hang: a failure is an unresolved result. */
async function guarded(
  layer: ReleaseClassifier,
  name: "local" | "cloud",
  input: CloudInput,
  timeoutMs: number
): Promise<Classification> {
  const failed = (reason: string): Classification => ({
    class: "unknown",
    confidence: null,
    source: name,
    ruleIds: [reason],
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      layer.classify(input),
      new Promise<Classification>((resolve) => {
        timer = setTimeout(() => resolve(failed(`${name}.timeout`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    pipelineLogger.warn({ error, layer: name }, "Classification layer failed, continuing");
    return failed(`${name}.error`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider-independent classification orchestrator (ADR-001 Decision A):
 *
 *   rules -> local model (if still unresolved) -> cloud model (if still unresolved)
 *
 * `local` never reaches the cloud, `cloud` skips the local model, `hybrid` uses both and only
 * asks the cloud when the local layer could not decide or failed. A release that no layer can
 * classify is `unknown`; this class only classifies and never decides whether to download.
 */
export class ClassificationPipeline {
  private readonly cache = new Map<string, { at: number; result: PipelineResult }>();

  constructor(
    private readonly getConfig: () => Promise<PipelineConfig> | PipelineConfig,
    private readonly layers: () => Promise<PipelineLayers> | PipelineLayers,
    private readonly options: { layerTimeoutMs?: number; now?: () => number } = {}
  ) {}

  private key(input: CloudInput, config: PipelineConfig): string {
    return JSON.stringify([
      PIPELINE_VERSION,
      config.mode,
      config.localVersion,
      config.cloudVersion,
      input.title,
      input.gameTitle ?? null,
      input.alternativeTitles ?? null,
      input.platform ?? null,
      input.sizeBytes ?? null,
    ]);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async classify(input: CloudInput): Promise<PipelineResult> {
    const now = this.options.now ?? Date.now;
    const config = await this.getConfig();
    const key = this.key(input, config);
    const hit = this.cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.result;

    const started = performance.now();
    const layers = await this.layers();
    const timeoutMs = this.options.layerTimeoutMs ?? DEFAULT_LAYER_TIMEOUT_MS;
    const path: PipelineResult["path"] = ["rules"];
    const ruled = await layers.rules.classify(input);
    let result: PipelineResult = { ...ruled, path };
    // Any failing layer keeps the result out of the cache so the next call tries it again
    let uncacheable = false;

    if (unresolved(result) && config.mode !== "cloud" && layers.local) {
      path.push("local");
      const local = await guarded(layers.local, "local", input, timeoutMs);
      uncacheable ||= failed(local);
      if (!unresolved(local)) result = { ...local, path };
      else if (config.mode === "local" || failed(local)) result = { ...local, path };
    }

    if (unresolved(result) && config.mode !== "local" && layers.cloud) {
      path.push("cloud");
      const cloud = await guarded(layers.cloud, "cloud", input, timeoutMs);
      uncacheable ||= failed(cloud);
      const { legitimacyScore } = cloud as PipelineResult;
      result = {
        ...cloud,
        path,
        ...(legitimacyScore !== undefined ? { legitimacyScore } : {}),
      };
    }

    // A later layer replaces the rules' answer, but the packaging flag it found still holds
    if (result.source !== "rules" && ruled.flags?.includes("repack")) {
      result = { ...result, flags: [...new Set([...(result.flags ?? []), "repack" as const])] };
    }

    pipelineLogger.debug(
      {
        mode: config.mode,
        path: result.path,
        class: result.class,
        confidence: result.confidence,
        source: result.source,
        modelVersion: result.modelVersion,
        ruleIds: result.ruleIds,
        ms: Math.round(performance.now() - started),
      },
      "Release classified"
    );

    // `degraded` only says the answer we return came from a failed layer; an earlier failure
    // that a later layer made up for leaves a real verdict
    if (failed(result)) result = { ...result, degraded: true };

    if (!uncacheable) {
      if (this.cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, { at: now(), result });
    }
    return result;
  }
}
