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
 * Deterministic for a given seed. Groups go to the part furthest below its target size, and no
 * part with a positive ratio is left empty.
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
  for (const [position, [, rows]] of ordered.entries()) {
    // A part with a positive ratio must not end up empty: once the groups left are only just
    // enough to fill the empty parts, the next group goes to one of them.
    const empty = parts
      .map((part, index) => index)
      .filter((index) => parts[index]?.length === 0 && (ratios[index] ?? 0) > 0);
    const mustFill = empty.length > 0 && ordered.length - position <= empty.length;
    const candidates = mustFill ? empty : parts.map((_, index) => index);
    let best = candidates[0] ?? 0;
    let bestDeficit = -Infinity;
    for (const index of candidates) {
      const deficit = (targets[index] ?? 0) - (parts[index]?.length ?? 0);
      if (deficit > bestDeficit) {
        best = index;
        bestDeficit = deficit;
      }
    }
    parts[best]?.push(...rows);
  }
  const [train = [], validation = [], test = []] = parts;
  return { train, validation, test };
}
