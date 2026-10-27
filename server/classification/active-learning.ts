import { createHash, randomUUID } from "node:crypto";
import { classifyReleaseByRules } from "../../shared/release-classification.js";
import {
  CANDIDATE_LABELS,
  type CandidateLabel,
  type CandidateReason,
  type CandidateSignals,
} from "../../shared/release-labels.js";
import type { ClassificationCandidate } from "../../shared/schema.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { storage } from "../storage.js";
import type { PipelineResult } from "./pipeline.js";
import type { CloudInput } from "./types.js";

const alLogger = logger.child({ module: "active-learning" });

/** Collection stops here; a person labels a few hundred releases, not tens of thousands. */
export const MAX_CANDIDATES = 5000;
/** A final answer below this is "low confidence" even when a layer accepted it. */
const LOW_CONFIDENCE = 0.85;

/** Same release for the same game, whatever the case or spacing. */
export function candidateKey(releaseName: string, gameTitle: string | null | undefined): string {
  const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${norm(releaseName)}\u0000${norm(gameTitle ?? "")}`)
    .digest("hex");
}

export interface LocalGuess {
  class: string;
  confidence: number;
  modelVersion: string;
}

export interface Assessment {
  reasons: CandidateReason[];
  signals: CandidateSignals;
  priority: number;
}

/**
 * Decides whether a classified release is worth a person's time and how much. Pure: the caller
 * supplies the pipeline result and the local model's best guess.
 *
 * - unresolved: nothing could say what it is.
 * - disagreement: the rules and the local model's best guess name different classes.
 * - low_confidence: a layer decided, but not by much.
 */
export function assessCandidate(
  input: CloudInput,
  result: PipelineResult,
  local: LocalGuess | null
): Assessment | null {
  const rules = classifyReleaseByRules(input);
  const flags = result.flags ?? [];
  const resolvedByFlag = flags.some((f) => f !== "repack");
  const reasons: CandidateReason[] = [];

  if (result.class === "unknown" && !resolvedByFlag) reasons.push("unresolved");
  // A rules answer of unknown says nothing, so only a real rules verdict can disagree
  if (rules.class !== "unknown" && local && local.class !== rules.class) {
    reasons.push("disagreement");
  }
  if (
    result.source !== "rules" &&
    result.class !== "unknown" &&
    result.confidence !== null &&
    result.confidence < LOW_CONFIDENCE
  ) {
    reasons.push("low_confidence");
  }
  if (reasons.length === 0) return null;

  const confidence = result.confidence ?? local?.confidence ?? 0;
  const priority =
    (reasons.includes("unresolved") ? 50 : 0) +
    (reasons.includes("disagreement") ? 40 : 0) +
    (reasons.includes("low_confidence") ? 20 : 0) +
    Math.round((1 - confidence) * 10);

  return {
    reasons,
    priority,
    signals: {
      rules: {
        class: rules.class,
        flags: rules.flags ?? [],
        ruleIds: rules.ruleIds ?? [],
      },
      local,
      final: {
        class: result.class,
        confidence: result.confidence,
        source: result.source,
        flags,
      },
    },
  };
}

/** A release that keeps turning up is written once an hour, not on every auto-search cycle. */
const SIGHTING_WINDOW_MS = 60 * 60 * 1000;
const MAX_REMEMBERED = 10_000;
const recentlySeen = new Map<string, number>();

function seenRecently(key: string, now: number): boolean {
  const at = recentlySeen.get(key);
  return at !== undefined && now - at < SIGHTING_WINDOW_MS;
}

function remember(key: string, now: number): void {
  if (recentlySeen.size >= MAX_REMEMBERED) {
    for (const [k, at] of recentlySeen) if (now - at >= SIGHTING_WINDOW_MS) recentlySeen.delete(k);
    // Still full of fresh entries: drop the oldest rather than grow
    if (recentlySeen.size >= MAX_REMEMBERED) {
      const oldest = recentlySeen.keys().next().value;
      if (oldest !== undefined) recentlySeen.delete(oldest);
    }
  }
  recentlySeen.set(key, now);
}

/**
 * Keeps an unsure release for labeling when `ACTIVE_LEARNING_COLLECT` is on. Never throws and
 * never changes what the pipeline decided: a failure here is logged and forgotten. A release
 * the pipeline could not judge because a layer failed (`degraded`) is not collected, since
 * "unknown" there means "the service was down", not "this is hard".
 */
export async function collectCandidate(
  input: CloudInput,
  result: PipelineResult,
  local: LocalGuess | null
): Promise<void> {
  if (!config.classification.activeLearning.collect) return;
  if (config.classification.mode === "cloud" || result.degraded) return;
  try {
    const assessment = assessCandidate(input, result, local);
    if (!assessment) return;
    const dedupeKey = candidateKey(input.title, input.gameTitle);
    const now = Date.now();
    if (seenRecently(dedupeKey, now)) return;
    if ((await storage.countClassificationCandidates()) >= MAX_CANDIDATES) {
      // An existing row would only be refreshed, which the limit does not need to stop
      alLogger.warn({ max: MAX_CANDIDATES }, "Candidate limit reached, not collecting more");
      return;
    }
    remember(dedupeKey, now);
    await storage.upsertClassificationCandidate({
      id: randomUUID(),
      dedupeKey,
      releaseName: input.title,
      gameTitle: input.gameTitle ?? null,
      platform: input.platform ?? null,
      sizeBytes: input.sizeBytes ?? null,
      reasons: JSON.stringify(assessment.reasons),
      signals: JSON.stringify(assessment.signals),
      priority: assessment.priority,
    });
  } catch (error) {
    alLogger.warn({ error, title: input.title }, "Could not store a classification candidate");
  }
}

/** Forgets which releases were just written, so deleted candidates can be collected again. */
export function resetCollectionMemory(): void {
  recentlySeen.clear();
}

export interface RankedCandidate {
  id: string;
  releaseName: string;
  gameTitle: string | null;
  platform: string | null;
  sizeBytes: number | null;
  reasons: CandidateReason[];
  signals: CandidateSignals | null;
  /** priority as stored, plus the bonus for a class the verified examples still lack */
  priority: number;
  seenCount: number;
  status: string;
  humanLabel: string | null;
  notes: string | null;
  suggestion: {
    label: string;
    confidence: number | null;
    model: string | null;
    at: number | null;
  } | null;
  createdAt: number | null;
}

function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** The class a reviewer would most likely be labelling, for the underrepresented-class bonus. */
function guessedClass(signals: CandidateSignals | null): string | null {
  if (!signals) return null;
  if (signals.final.class !== "unknown") return signals.final.class;
  return signals.local?.class ?? signals.rules.class;
}

/**
 * Pending candidates, most useful first. A candidate whose likely class has few verified
 * examples gets up to +30, so labeling effort goes where the dataset is thin.
 */
export function rankCandidates(rows: ClassificationCandidate[]): RankedCandidate[] {
  const verified = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "verified" && row.humanLabel) {
      verified.set(row.humanLabel, (verified.get(row.humanLabel) ?? 0) + 1);
    }
  }
  const most = Math.max(1, ...verified.values());
  return rows
    .map((row): RankedCandidate => {
      const signals = parse<CandidateSignals | null>(row.signals, null);
      const guess = guessedClass(signals);
      const have = guess ? (verified.get(guess) ?? 0) : most;
      const bonus = Math.round(30 * (1 - Math.min(1, have / most)));
      return {
        id: row.id,
        releaseName: row.releaseName,
        gameTitle: row.gameTitle,
        platform: row.platform,
        sizeBytes: row.sizeBytes,
        reasons: parse<CandidateReason[]>(row.reasons, []),
        signals,
        priority: row.priority + bonus,
        seenCount: row.seenCount,
        status: row.status,
        humanLabel: row.humanLabel,
        notes: row.notes,
        suggestion: row.suggestedLabel
          ? {
              label: row.suggestedLabel,
              confidence: row.suggestedConfidence,
              model: row.suggestedModel,
              at: row.suggestedAt?.getTime() ?? null,
            }
          : null,
        createdAt: row.createdAt?.getTime() ?? null,
      };
    })
    .sort((a, b) => b.priority - a.priority || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function isCandidateLabel(value: unknown): value is CandidateLabel {
  return typeof value === "string" && (CANDIDATE_LABELS as readonly string[]).includes(value);
}

function csvCell(value: string): string {
  return /[",\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Human-verified examples in the labeled dataset format (`release_name,query,human_label,notes`).
 * Only rows a person verified are exported; suggestions, predictions and rule output never are.
 * Rows with no game title are left out, since the benchmark groups its splits by game.
 */
export function exportVerifiedCsv(rows: ClassificationCandidate[]): {
  csv: string;
  exported: number;
  skippedNoGame: number;
} {
  const lines = ["release_name,query,human_label,notes"];
  let skippedNoGame = 0;
  for (const row of rows) {
    if (row.status !== "verified" || !row.humanLabel) continue;
    if (!row.gameTitle) {
      skippedNoGame++;
      continue;
    }
    lines.push(
      [row.releaseName, row.gameTitle, row.humanLabel, row.notes ?? ""].map(csvCell).join(",")
    );
  }
  return { csv: `${lines.join("\n")}\n`, exported: lines.length - 1, skippedNoGame };
}
