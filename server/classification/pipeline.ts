import { RELEASE_CLASSES, type Classification } from "../../shared/release-classification.js";
import { logger } from "../logger.js";
import { TieredCache, type PersistentCacheStore } from "./cache.js";
import type { CloudInput, ReleaseClassifier } from "./types.js";

const pipelineLogger = logger.child({ module: "classification" });

export const CLASSIFICATION_MODES = ["local", "cloud", "hybrid"] as const;
export type ClassificationMode = (typeof CLASSIFICATION_MODES)[number];

/** Bump when the pipeline's own rules change, so older cached results are not reused. */
export const PIPELINE_VERSION = 1;

const DEFAULT_LAYER_TIMEOUT_MS = 10_000;

export interface PipelineConfig {
  mode: ClassificationMode;
  /** Version tags that belong in cache keys: the local model and the cloud model. */
  localVersion: string | null;
  cloudVersion: string | null;
  /** The local model's confidence bar; it changes verdicts, so it belongs in cache keys. */
  localThreshold?: number | null;
  /**
   * Identifies the cloud provider across restarts (endpoint, key and model). `cloudVersion` may carry
   * a counter that restarts at zero, so the persisted key uses this one when it is given.
   */
  cloudFingerprint?: string | null;
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

const SOURCES = new Set(["rules", "local", "cloud"]);

/** A stored verdict is reused only when it still has the shape of a pipeline result. */
function parseStoredResult(raw: unknown): PipelineResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const path = value.path;
  const valid =
    (RELEASE_CLASSES as readonly unknown[]).includes(value.class) &&
    typeof value.source === "string" &&
    SOURCES.has(value.source) &&
    (value.confidence === null || typeof value.confidence === "number") &&
    Array.isArray(path) &&
    path.every((layer) => typeof layer === "string" && SOURCES.has(layer));
  // A degraded answer comes from a failed layer and is never kept
  return valid && value.degraded !== true ? (raw as PipelineResult) : null;
}

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
  /** Memory first, then the `classification_cache` table when a store is given. */
  private readonly cache: TieredCache<PipelineResult>;

  constructor(
    private readonly getConfig: () => Promise<PipelineConfig> | PipelineConfig,
    private readonly layers: () => Promise<PipelineLayers> | PipelineLayers,
    private readonly options: {
      layerTimeoutMs?: number;
      now?: () => number;
      store?: PersistentCacheStore;
    } = {}
  ) {
    this.cache = new TieredCache<PipelineResult>({
      namespace: "pipeline",
      parse: parseStoredResult,
      store: options.store,
      now: options.now,
    });
  }

  private key(input: CloudInput, config: PipelineConfig): string {
    return JSON.stringify([
      PIPELINE_VERSION,
      config.mode,
      config.localVersion,
      config.localThreshold ?? null,
      config.cloudFingerprint ?? config.cloudVersion,
      input.title,
      input.gameTitle ?? null,
      input.alternativeTitles ?? null,
      input.platform ?? null,
      input.sizeBytes ?? null,
    ]);
  }

  /** Forgets the memory level; the table is keyed by versions and is cleared on request only. */
  clearCache(): void {
    this.cache.clearMemory();
  }

  async classify(input: CloudInput): Promise<PipelineResult> {
    const config = await this.getConfig();
    const key = this.key(input, config);
    const generation = this.cache.generation;
    const hit = await this.cache.get(key);
    if (hit) return hit;

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

    // `degraded` is a failed layer's answer; neither it nor a result with a failed layer is kept
    if (!uncacheable && !result.degraded) await this.cache.set(key, result, generation);
    return result;
  }
}
