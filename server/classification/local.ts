import fs from "node:fs";
import type { Classification } from "../../shared/release-classification.js";
import {
  TfidfModelError,
  TfidfScorer,
  parseTfidfModel,
  type TfidfModelFile,
} from "../../shared/release-tfidf.js";
import { logger } from "../logger.js";
import type { CloudInput, ReleaseClassifier } from "./types.js";

const localLogger = logger.child({ module: "classification-local" });

/** A model file is a few hundred KB; anything near this is not one. */
const MAX_MODEL_BYTES = 32 * 1024 * 1024;

/**
 * The local layer: a tf-idf model scored in-process. It abstains with `unknown` below
 * `acceptThreshold`, and when the model is title-aware but no game title is known, because the
 * title-match feature it was trained with would be missing.
 */
export class LocalTfidfClassifier implements ReleaseClassifier {
  readonly modelVersion: string;
  private readonly scorer: TfidfScorer;

  constructor(
    model: TfidfModelFile,
    private readonly acceptThreshold: number
  ) {
    this.scorer = new TfidfScorer(model);
    this.modelVersion = model.modelVersion;
  }

  /** The model's best guess whatever its confidence, for reviewing releases it abstained on. */
  guess(input: CloudInput): { class: Classification["class"]; confidence: number } | null {
    if (this.scorer.model.titleAware && !input.gameTitle) return null;
    try {
      if (!this.scorer.hasFeatures({ title: input.title, gameTitle: input.gameTitle })) return null;
      const { class: guessed, confidence } = this.scorer.predict({
        title: input.title,
        gameTitle: input.gameTitle,
      });
      return { class: guessed, confidence };
    } catch {
      return null;
    }
  }

  classify(input: CloudInput): Promise<Classification> {
    const abstain: Classification = {
      class: "unknown",
      confidence: null,
      source: "local",
      modelVersion: this.modelVersion,
      ruleIds: ["local.abstain"],
    };
    if (this.scorer.model.titleAware && !input.gameTitle) return Promise.resolve(abstain);
    try {
      // A name with no known n-gram would be scored by the model's bias alone: abstain instead
      if (!this.scorer.hasFeatures({ title: input.title, gameTitle: input.gameTitle })) {
        return Promise.resolve({ ...abstain, ruleIds: ["local.no-features"] });
      }
      const prediction = this.scorer.predict({ title: input.title, gameTitle: input.gameTitle });
      if (prediction.confidence < this.acceptThreshold) {
        return Promise.resolve({ ...abstain, confidence: prediction.confidence });
      }
      return Promise.resolve({
        class: prediction.class,
        confidence: prediction.confidence,
        source: "local",
        modelVersion: this.modelVersion,
      });
    } catch (error) {
      localLogger.warn(
        { error },
        "Local classification failed, treating the release as unresolved"
      );
      return Promise.resolve({ ...abstain, ruleIds: ["local.error"] });
    }
  }
}

/** Loads and validates a model file. Returns null (and logs why) rather than throwing. */
export function loadLocalModel(path: string): TfidfModelFile | null {
  try {
    const { size } = fs.statSync(path);
    if (size > MAX_MODEL_BYTES) throw new TfidfModelError(`file is ${size} bytes`);
    return parseTfidfModel(JSON.parse(fs.readFileSync(path, "utf8")));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    // A missing file is the normal "no local model installed" state, not a fault
    (missing ? localLogger.debug : localLogger.warn).call(
      localLogger,
      { path, error: missing ? undefined : error },
      missing ? "No local classifier model installed" : "Local classifier model refused"
    );
    return null;
  }
}
