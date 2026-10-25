import type { LabeledRelease } from "./types.js";

export interface Split {
  train: LabeledRelease[];
  validation: LabeledRelease[];
  test: LabeledRelease[];
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Splits by game, never by release: every release of one game lands in the same part, so a
 * model cannot memorise "Stellaris ... Species Pack" in training and be tested on a sibling.
 * Deterministic for a given seed. Groups go to the part furthest below its target size.
 */
export function groupedSplit(
  records: readonly LabeledRelease[],
  seed: number,
  ratios: readonly [number, number, number] = [0.6, 0.2, 0.2]
): Split {
  const groups = new Map<string, LabeledRelease[]>();
  for (const record of records) {
    const key = record.gameTitle.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  if (groups.size < 3) {
    throw new Error(`Need at least 3 distinct games for a leakage-free split, got ${groups.size}`);
  }
  const total = records.length;
  const sum = ratios[0] + ratios[1] + ratios[2];
  const targets = ratios.map((r) => (r / sum) * total);
  const parts: LabeledRelease[][] = [[], [], []];

  const ordered = [...groups.entries()].sort(
    (a, b) => fnv1a(`${seed}:${a[0]}`) - fnv1a(`${seed}:${b[0]}`) || a[0].localeCompare(b[0])
  );
  for (const [, rows] of ordered) {
    let best = 0;
    let bestDeficit = -Infinity;
    parts.forEach((part, index) => {
      const deficit = (targets[index] ?? 0) - part.length;
      if (deficit > bestDeficit) {
        best = index;
        bestDeficit = deficit;
      }
    });
    parts[best]?.push(...rows);
  }
  const [train = [], validation = [], test = []] = parts;
  return { train, validation, test };
}
