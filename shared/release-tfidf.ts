import { classifyTitleMatch } from "./release-scoring.js";
import type { ReleaseClass } from "./release-classification.js";

/**
 * Character n-gram TF-IDF with a multinomial logistic regression head, in plain TypeScript.
 * Shared by the training tooling (scripts/release-benchmark) and the server's local classifier
 * so a trained model file scores identically in both places. No native dependency, no network.
 */
export const TFIDF_MODEL_FORMAT = 1;
export const TFIDF_CLASSES = [
  "full_game",
  "patch",
  "dlc",
  "unknown",
] as const satisfies readonly ReleaseClass[];

/** A trained model as stored on disk. `weights` is indexed [class][feature]. */
export interface TfidfModelFile {
  format: typeof TFIDF_MODEL_FORMAT;
  /** Identifies this training run; part of every cache key and log line. */
  modelVersion: string;
  classes: readonly ReleaseClass[];
  titleAware: boolean;
  ngram: { min: number; max: number };
  vocab: string[];
  idf: number[];
  weights: number[][];
  bias: number[];
}

export interface TfidfInput {
  title: string;
  gameTitle?: string | undefined;
}

const OPEN_SEPARATORS = /[._-]+/g;

function tidy(text: string): string {
  return text.toLowerCase().replaceAll(OPEN_SEPARATORS, " ").replaceAll(/\s+/g, " ").trim();
}

export function featureText(input: TfidfInput, titleAware: boolean): string {
  let text = tidy(input.title);
  if (titleAware) {
    const game = tidy(input.gameTitle ?? "");
    if (game && text.includes(game)) text = text.replace(game, " ");
    text = `${text.replaceAll(/\s+/g, " ").trim()} titlematch${
      input.gameTitle ? classifyTitleMatch(input.title, input.gameTitle) : "none"
    }`;
  }
  return text;
}

export function charNgrams(text: string, min = 2, max = 5): Map<string, number> {
  const padded = ` ${text} `;
  const counts = new Map<string, number>();
  for (let n = min; n <= max; n++) {
    for (let i = 0; i + n <= padded.length; i++) {
      const gram = padded.slice(i, i + n);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
}

export type SparseVector = { index: number; value: number }[];

/** Why a model file was refused; the caller logs it and falls back to the other layers. */
export class TfidfModelError extends Error {}

/** Checks the shape of untrusted JSON so a damaged or foreign file cannot reach inference. */
export function parseTfidfModel(raw: unknown): TfidfModelFile {
  const fail = (reason: string): never => {
    throw new TfidfModelError(`Invalid tf-idf model: ${reason}`);
  };
  if (typeof raw !== "object" || raw === null) return fail("not an object");
  const m = raw as Partial<TfidfModelFile>;
  if (m.format !== TFIDF_MODEL_FORMAT) return fail(`unsupported format ${String(m.format)}`);
  if (typeof m.modelVersion !== "string" || m.modelVersion.length === 0) {
    return fail("missing modelVersion");
  }
  if (
    !Array.isArray(m.classes) ||
    m.classes.length < 2 ||
    !m.classes.every((c) => (TFIDF_CLASSES as readonly string[]).includes(c))
  ) {
    return fail("classes");
  }
  if (typeof m.titleAware !== "boolean") return fail("titleAware");
  if (
    !m.ngram ||
    !Number.isInteger(m.ngram.min) ||
    !Number.isInteger(m.ngram.max) ||
    m.ngram.min < 1 ||
    m.ngram.max < m.ngram.min ||
    m.ngram.max > 8
  ) {
    return fail("ngram");
  }
  const { vocab, idf, weights, bias } = m;
  if (!Array.isArray(vocab) || !Array.isArray(idf) || vocab.length !== idf.length) {
    return fail("vocab and idf");
  }
  if (!Array.isArray(weights) || weights.length !== m.classes.length) return fail("weights");
  if (!Array.isArray(bias) || bias.length !== m.classes.length) return fail("bias");
  const numeric = (values: unknown[]) =>
    values.every((v) => typeof v === "number" && Number.isFinite(v));
  if (!numeric(idf) || !numeric(bias)) return fail("non-finite number");
  for (const row of weights) {
    if (!Array.isArray(row) || row.length !== vocab.length || !numeric(row)) {
      return fail("weights row");
    }
  }
  return m as TfidfModelFile;
}

/** Inference over a validated model. Cheap enough to run inline in a request. */
export class TfidfScorer {
  private readonly vocab: Map<string, number>;

  constructor(readonly model: TfidfModelFile) {
    this.vocab = new Map(model.vocab.map((gram, index) => [gram, index]));
  }

  private vectorize(text: string): SparseVector {
    const entries: SparseVector = [];
    for (const [gram, count] of charNgrams(text, this.model.ngram.min, this.model.ngram.max)) {
      const index = this.vocab.get(gram);
      if (index === undefined) continue;
      entries.push({ index, value: (1 + Math.log(count)) * (this.model.idf[index] ?? 0) });
    }
    const norm = Math.sqrt(entries.reduce((acc, e) => acc + e.value * e.value, 0));
    return norm === 0 ? entries : entries.map((e) => ({ index: e.index, value: e.value / norm }));
  }

  /** False when no n-gram of the input is in the vocabulary, so a score would be the bias alone. */
  hasFeatures(input: TfidfInput): boolean {
    // The title-match token is synthetic and always known, so it must not count as a feature
    const text = featureText(input, this.model.titleAware).replace(/\s*titlematch\S*$/, "");
    return text.length > 0 && this.vectorize(text).length > 0;
  }

  /** Class probabilities (softmax over the logits), in `model.classes` order. */
  probabilities(input: TfidfInput): number[] {
    const vector = this.vectorize(featureText(input, this.model.titleAware));
    const logits = this.model.classes.map((_, c) => {
      const w = this.model.weights[c] ?? [];
      return vector.reduce((acc, e) => acc + (w[e.index] ?? 0) * e.value, this.model.bias[c] ?? 0);
    });
    const max = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  }

  predict(input: TfidfInput): { class: ReleaseClass; confidence: number } {
    const probs = this.probabilities(input);
    let best = 0;
    probs.forEach((p, i) => {
      if (p > (probs[best] ?? 0)) best = i;
    });
    return { class: this.model.classes[best] ?? "unknown", confidence: probs[best] ?? 0 };
  }
}
