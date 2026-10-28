import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { detectDelimiter, importDataset, parseCsv } from "./dataset.js";
import type { LabeledRelease } from "./types.js";

const keyOf = (r: Pick<LabeledRelease, "gameTitle" | "releaseName">): string =>
  `${r.gameTitle.toLowerCase()}\u0000${r.releaseName.toLowerCase()}`;

const labelOf = (r: LabeledRelease): string => `${r.label}${r.flags.length ? `+${r.flags}` : ""}`;

function cell(value: string): string {
  return /[",\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface MergeReport {
  /** The dataset text with the accepted rows appended. */
  csv: string;
  added: string[];
  /** Already in the dataset with the same label. */
  duplicates: string[];
  /** Already in the dataset (or twice in the incoming file) with a different label: nothing is overwritten. */
  conflicts: { releaseName: string; gameTitle: string; labels: string[] }[];
  /** Belong to a game of the held-out set, which only the held-out file may grow. */
  heldOut: string[];
  /** Incoming rows without a usable label, game or release name. */
  invalid: number;
}

/**
 * Appends human-verified rows exported from Questarr to a labeled dataset (ADR-001 task 6).
 *
 * - A release already in the dataset is never duplicated, and never relabeled: a different
 *   label is reported as a conflict for a person to settle.
 * - Rows for a game that appears in the held-out file are not added. The held-out set stays a
 *   separate file that is only evaluated against, so no example can leak from it into training.
 * - Existing rows are kept byte for byte; the new ones are appended under the file's header.
 */
export function mergeCandidates(params: {
  dataset: string;
  incoming: string;
  heldout?: string;
}): MergeReport {
  const base = importDataset(params.dataset, "csv");
  const incoming = importDataset(params.incoming, "csv");
  const heldoutRecords = params.heldout ? importDataset(params.heldout, "csv").records : [];
  const heldoutGames = new Set(heldoutRecords.map((r) => r.gameTitle.toLowerCase()));

  const existing = new Map(base.records.map((r) => [keyOf(r), r]));
  // Rows the base itself could not settle stay unsettled
  const contested = new Set(base.issues.conflicts.map((c) => keyOf(c)));
  for (const c of incoming.issues.conflicts) contested.add(keyOf(c));

  const report: MergeReport = {
    csv: params.dataset,
    added: [],
    duplicates: [],
    conflicts: [...incoming.issues.conflicts],
    heldOut: [],
    invalid: incoming.issues.malformed + incoming.issues.unlabeled.length,
  };
  const accepted: LabeledRelease[] = [];
  for (const record of incoming.records) {
    const key = keyOf(record);
    if (heldoutGames.has(record.gameTitle.toLowerCase())) {
      report.heldOut.push(record.releaseName);
    } else if (contested.has(key)) {
      if (!incoming.issues.conflicts.some((c) => keyOf(c) === key)) {
        report.conflicts.push({
          releaseName: record.releaseName,
          gameTitle: record.gameTitle,
          labels: [labelOf(record)],
        });
      }
    } else if (existing.has(key)) {
      const current = existing.get(key);
      if (current && labelOf(current) === labelOf(record)) {
        report.duplicates.push(record.releaseName);
      } else if (current) {
        report.conflicts.push({
          releaseName: record.releaseName,
          gameTitle: record.gameTitle,
          labels: [labelOf(current), labelOf(record)],
        });
      }
    } else {
      accepted.push(record);
      existing.set(key, record);
    }
  }

  // Appended rows use the dataset's own delimiter, or re-importing would drop them as malformed
  const delimiter = detectDelimiter(params.dataset.replace(/^\uFEFF/, ""));
  const [header = []] = parseCsv(params.dataset, delimiter);
  const find = (...names: string[]) =>
    header.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const slots = {
    release: find("release_name", "releasename", "title"),
    game: find("query", "game_title", "gametitle", "game"),
    label: find("human_label", "label"),
    notes: find("notes"),
  };
  if (slots.release < 0 || slots.game < 0 || slots.label < 0) {
    throw new Error("The dataset needs the columns release_name, query and human_label");
  }
  const lines = accepted.map((record) => {
    const cells = header.map(() => "");
    cells[slots.release] = record.releaseName;
    cells[slots.game] = record.gameTitle;
    cells[slots.label] = record.rawLabel;
    if (slots.notes >= 0) cells[slots.notes] = record.notes ?? "";
    return cells.map(cell).join(delimiter);
  });
  report.added = accepted.map((r) => r.releaseName);
  if (lines.length > 0) {
    const text = params.dataset.endsWith("\n") ? params.dataset : `${params.dataset}\n`;
    report.csv = `${text}${lines.join("\n")}\n`;
  }
  return report;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      candidates: { type: "string" },
      heldout: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.dataset || !values.candidates || !values.out) {
    console.error(
      "Usage: merge-candidates.ts --dataset <train.csv> --candidates <verified-candidates.csv> " +
        "--out <merged.csv> [--heldout <heldout.csv>]"
    );
    process.exit(2);
  }
  const report = mergeCandidates({
    dataset: fs.readFileSync(values.dataset, "utf8"),
    incoming: fs.readFileSync(values.candidates, "utf8"),
    ...(values.heldout ? { heldout: fs.readFileSync(values.heldout, "utf8") } : {}),
  });
  fs.writeFileSync(values.out, report.csv);
  console.log(
    `Added ${report.added.length}, duplicates ${report.duplicates.length}, ` +
      `held-out games ${report.heldOut.length}, invalid ${report.invalid}, ` +
      `conflicts ${report.conflicts.length}. Wrote ${values.out}.`
  );
  for (const c of report.conflicts) {
    console.log(`  CONFLICT ${c.gameTitle} | ${c.releaseName}: ${c.labels.join(" vs ")}`);
  }
  for (const name of report.heldOut) console.log(`  HELD-OUT game, not added: ${name}`);
  if (report.conflicts.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
