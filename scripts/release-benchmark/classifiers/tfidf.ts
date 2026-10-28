import type { ReleaseClass } from "../../../shared/release-classification.js";
import {
  TFIDF_MODEL_FORMAT,
  charNgrams,
  featureText as sharedFeatureText,
  type TfidfModelFile,
} from "../../../shared/release-tfidf.js";
import { CLASSES, type BenchClassifier, type LabeledRelease } from "../types.js";

/**
 * Classical baseline: character n-gram TF-IDF into a multinomial logistic regression trained
 * with seeded SGD. Pure TypeScript, no dependency. Training lives in the tooling only; the
 * server scores a file exported with `toModelFile()` through shared/release-tfidf.ts.
 * Confidence is the raw softmax probability, which is not calibrated: calibration belongs to
 * the model-selection task.
 */
export interface TfidfOptions {
  /** `true` strips the game title and adds a title-match token (metadata-enriched variant). */
  titleAware: boolean;
  seed: number;
  /** Below this probability the prediction abstains with `unknown`. */
  threshold: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  minDocFreq?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function featureText(row: LabeledRelease, titleAware: boolean): string {
  return sharedFeatureText({ title: row.releaseName, gameTitle: row.gameTitle }, titleAware);
}

interface Model {
  vocab: Map<string, number>;
  idf: number[];
  weights: number[][]; // [class][feature]
  bias: number[];
}

type Sparse = { index: number; value: number }[];

export class TfidfClassifier implements BenchClassifier {
  readonly trainable = true;
  readonly remote = false;
  readonly id: string;
  private model: Model | null = null;

  constructor(private readonly options: TfidfOptions) {
    this.id = options.titleAware ? "tfidf-title" : "tfidf";
  }

  private vectorize(text: string, model: Pick<Model, "vocab" | "idf">): Sparse {
    const entries: Sparse = [];
    for (const [gram, count] of charNgrams(text)) {
      const index = model.vocab.get(gram);
      if (index === undefined) continue;
      entries.push({ index, value: (1 + Math.log(count)) * (model.idf[index] ?? 0) });
    }
    const norm = Math.sqrt(entries.reduce((acc, e) => acc + e.value * e.value, 0));
    return norm === 0 ? entries : entries.map((e) => ({ index: e.index, value: e.value / norm }));
  }

  private scores(vector: Sparse, model: Model): number[] {
    const logits = CLASSES.map((_, c) => {
      const w = model.weights[c] ?? [];
      return vector.reduce((acc, e) => acc + (w[e.index] ?? 0) * e.value, model.bias[c] ?? 0);
    });
    const max = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  }

  train(rows: readonly LabeledRelease[]): void {
    if (rows.length === 0) throw new Error("Cannot train on an empty set");
    const { titleAware, seed } = this.options;
    const epochs = this.options.epochs ?? 40;
    const lr0 = this.options.learningRate ?? 0.5;
    const l2 = this.options.l2 ?? 1e-4;
    const minDf = this.options.minDocFreq ?? 2;

    const texts = rows.map((r) => featureText(r, titleAware));
    const docFreq = new Map<string, number>();
    for (const text of texts) {
      for (const gram of charNgrams(text).keys()) docFreq.set(gram, (docFreq.get(gram) ?? 0) + 1);
    }
    const vocab = new Map<string, number>();
    const idf: number[] = [];
    for (const [gram, df] of docFreq) {
      if (df < minDf) continue;
      vocab.set(gram, vocab.size);
      idf.push(Math.log((1 + rows.length) / (1 + df)) + 1);
    }
    const vectors = texts.map((t) => this.vectorize(t, { vocab, idf }));
    const targets = rows.map((r) => CLASSES.indexOf(r.label));

    // Inverse-frequency class weights so rare classes are not ignored.
    const counts = new Array<number>(CLASSES.length).fill(0);
    for (const t of targets) counts[t] = (counts[t] ?? 0) + 1;
    const classWeight = counts.map((c) => (c === 0 ? 0 : rows.length / (CLASSES.length * c)));

    const model: Model = {
      vocab,
      idf,
      weights: CLASSES.map(() => new Array<number>(vocab.size).fill(0)),
      bias: new Array<number>(CLASSES.length).fill(0),
    };
    const random = mulberry32(seed);
    const order = rows.map((_, i) => i);
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
      }
      const lr = lr0 / (1 + epoch * 0.1);
      for (const i of order) {
        const vector = vectors[i] ?? [];
        const target = targets[i] ?? 0;
        const probs = this.scores(vector, model);
        const weight = classWeight[target] ?? 1;
        for (let c = 0; c < CLASSES.length; c++) {
          const grad = ((probs[c] ?? 0) - (c === target ? 1 : 0)) * weight;
          const w = model.weights[c];
          if (!w) continue;
          for (const e of vector) {
            w[e.index] = (w[e.index] ?? 0) - lr * (grad * e.value + l2 * (w[e.index] ?? 0));
          }
          model.bias[c] = (model.bias[c] ?? 0) - lr * grad;
        }
      }
    }
    this.model = model;
  }

  /** The trained model in the format the server's local classifier loads. */
  toModelFile(modelVersion: string): TfidfModelFile {
    if (!this.model) throw new Error(`${this.id} must be trained before it is exported`);
    const vocab = [...this.model.vocab.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g);
    return {
      format: TFIDF_MODEL_FORMAT,
      modelVersion,
      classes: CLASSES,
      titleAware: this.options.titleAware,
      ngram: { min: 2, max: 5 },
      vocab,
      idf: this.model.idf,
      weights: this.model.weights,
      bias: this.model.bias,
    };
  }

  async classify(row: LabeledRelease) {
    if (!this.model) throw new Error(`${this.id} must be trained before it classifies`);
    const started = performance.now();
    const vector = this.vectorize(featureText(row, this.options.titleAware), this.model);
    const probs = this.scores(vector, this.model);
    let best = 0;
    probs.forEach((p, i) => {
      if (p > (probs[best] ?? 0)) best = i;
    });
    const confidence = probs[best] ?? 0;
    const label: ReleaseClass =
      confidence < this.options.threshold ? "unknown" : (CLASSES[best] ?? "unknown");
    return { label, confidence, latencyMs: performance.now() - started };
  }
}
