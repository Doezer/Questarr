import type { ClassificationFlag, ReleaseClass } from "../../shared/release-classification.js";
import type { LabeledRelease } from "./types.js";

/**
 * Human labels as the labeling sheet writes them. Jev's own vocabulary (update, repack,
 * crack_only, ...) is accepted and folded onto the ADR's classes plus flags, so a sheet filled
 * in next to Jev's suggestions needs no cleanup.
 */
const LABEL_MAP: Readonly<Record<string, { label: ReleaseClass; flags: ClassificationFlag[] }>> = {
  full_game: { label: "full_game", flags: [] },
  expansion: { label: "dlc", flags: [] },
  patch: { label: "patch", flags: [] },
  dlc: { label: "dlc", flags: [] },
  unknown: { label: "unknown", flags: [] },
  update: { label: "patch", flags: [] },
  dlc_update: { label: "patch", flags: [] },
  repack: { label: "full_game", flags: ["repack"] },
  crack_only: { label: "unknown", flags: ["crack_only"] },
  demo: { label: "unknown", flags: ["demo"] },
  soundtrack: { label: "unknown", flags: ["soundtrack"] },
  other: { label: "unknown", flags: ["other_artifact"] },
};

export function normalizeLabel(
  raw: string
): { label: ReleaseClass; flags: ClassificationFlag[] } | null {
  const entry = LABEL_MAP[raw.trim().toLowerCase()];
  return entry ? { label: entry.label, flags: [...entry.flags] } : null;
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF, BOM. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (quoted) {
      if (ch === '"' && source.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source.charAt(i + 1) === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  return header.split(";").length > header.split(",").length ? ";" : ",";
}

export interface DatasetIssues {
  /** Rows without a usable label (empty or not in the label set). */
  unlabeled: { releaseName: string; reason: string }[];
  /** Same release and game, same label: kept once. */
  duplicates: string[];
  /** Same release and game, different labels: dropped, a human has to decide. */
  conflicts: { releaseName: string; gameTitle: string; labels: string[] }[];
  /** Rows missing a release name or game title. */
  malformed: number;
}

export interface Dataset {
  records: LabeledRelease[];
  issues: DatasetIssues;
}

interface RawRow {
  releaseName: string;
  gameTitle: string;
  label: string;
  notes: string;
}

function csvToRaw(text: string): RawRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const column = (...names: string[]): number =>
    header.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const nameIdx = column("release_name", "releasename", "title");
  const gameIdx = column("query", "game_title", "gametitle", "game");
  const labelIdx = column("human_label", "label");
  const notesIdx = column("notes");
  if (nameIdx < 0 || gameIdx < 0 || labelIdx < 0) {
    throw new Error(
      "CSV needs the columns release_name, query (or game_title) and human_label (or label)"
    );
  }
  return body.map((cells) => ({
    releaseName: (cells[nameIdx] ?? "").trim(),
    gameTitle: (cells[gameIdx] ?? "").trim(),
    label: (cells[labelIdx] ?? "").trim(),
    notes: notesIdx >= 0 ? (cells[notesIdx] ?? "").trim() : "",
  }));
}

function jsonlToRaw(text: string): RawRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Line ${index + 1} is not valid JSON`);
      }
      const obj = (typeof value === "object" && value !== null ? value : {}) as Record<
        string,
        unknown
      >;
      const str = (...keys: string[]): string => {
        for (const key of keys) {
          const v = obj[key];
          if (typeof v === "string") return v.trim();
        }
        return "";
      };
      return {
        releaseName: str("release_name", "releaseName", "title"),
        gameTitle: str("game_title", "gameTitle", "query", "game"),
        label: str("human_label", "label"),
        notes: str("notes"),
      };
    });
}

/** Imports a labeled dataset (CSV or JSONL text) and reports everything it had to drop. */
export function importDataset(text: string, format: "csv" | "jsonl"): Dataset {
  const raw = format === "jsonl" ? jsonlToRaw(text) : csvToRaw(text);
  const issues: DatasetIssues = { unlabeled: [], duplicates: [], conflicts: [], malformed: 0 };
  const byKey = new Map<string, LabeledRelease[]>();

  for (const row of raw) {
    if (!row.releaseName || !row.gameTitle) {
      issues.malformed++;
      continue;
    }
    if (!row.label) {
      issues.unlabeled.push({ releaseName: row.releaseName, reason: "empty label" });
      continue;
    }
    const normalized = normalizeLabel(row.label);
    if (!normalized) {
      issues.unlabeled.push({
        releaseName: row.releaseName,
        reason: `unknown label "${row.label}"`,
      });
      continue;
    }
    const record: LabeledRelease = {
      releaseName: row.releaseName,
      gameTitle: row.gameTitle,
      label: normalized.label,
      flags: normalized.flags,
      rawLabel: row.label,
      ...(row.notes ? { notes: row.notes } : {}),
    };
    const key = `${row.gameTitle.toLowerCase()}\u0000${row.releaseName.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }

  const records: LabeledRelease[] = [];
  for (const group of byKey.values()) {
    const [first] = group;
    if (!first) continue;
    const labels = [
      ...new Set(group.map((r) => `${r.label}${r.flags.length ? `+${r.flags}` : ""}`)),
    ];
    if (new Set(group.map((r) => r.label)).size > 1) {
      issues.conflicts.push({
        releaseName: first.releaseName,
        gameTitle: first.gameTitle,
        labels,
      });
      continue;
    }
    if (group.length > 1) issues.duplicates.push(first.releaseName);
    records.push(first);
  }
  return { records, issues };
}
