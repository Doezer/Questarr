import { createHash, randomUUID } from "node:crypto";
import { classifyReleaseByRules } from "../../shared/release-classification.js";
import {
  CANDIDATE_LABELS,
  classesConflict,
  type CandidateLabel,
  type CandidateReason,
  type CandidateSignals,
} from "../../shared/release-labels.js";
import type { ClassificationCandidate } from "../../shared/schema.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { notifyUser } from "../socket.js";
import { storage } from "../storage.js";
import type { PipelineResult } from "./pipeline.js";
import type { CloudInput } from "./types.js";

const alLogger = logger.child({ module: "active-learning" });

/** Default cap; a person labels a few hundred releases, not tens of thousands. */
export const MAX_CANDIDATES = 5000;

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
 * - model_disagreement: the cloud model decided where the local model only had a best guess
 *   below its threshold, and the two name different classes. Costs nothing extra: the cloud
 *   was already asked.
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
  // A cloud demo, soundtrack or crack-only verdict has class unknown plus a flag: still a
  // definitive answer, and one a local guess of a real class contradicts
  const cloudDecided = result.class !== "unknown" || resolvedByFlag;
  if (
    result.source === "cloud" &&
    local &&
    cloudDecided &&
    (result.class === "unknown"
      ? local.class !== "unknown"
      : classesConflict(result.class, local.class))
  ) {
    reasons.push("model_disagreement");
  }
  if (
    result.source !== "rules" &&
    result.class !== "unknown" &&
    result.confidence !== null &&
    result.confidence < config.classification.activeLearning.lowConfidence
  ) {
    reasons.push("low_confidence");
  }
  if (reasons.length === 0) return null;

  const confidence = result.confidence ?? local?.confidence ?? 0;
  const priority =
    (reasons.includes("unresolved") ? 50 : 0) +
    (reasons.includes("disagreement") ? 40 : 0) +
    (reasons.includes("model_disagreement") ? 40 : 0) +
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

/** The review card, reached from the notification: Settings > Discovery & Downloads. */
export const REVIEW_LINK = "/settings?tab=discovery#classification-review";

/** One notification each time the waiting list grows by this many, so it never turns into noise. */
export const REVIEW_NOTIFY_EVERY = 25;

/**
 * Checks run one at a time: collections of releases classified in a row overlap, and two of them
 * reading the count together would skip a multiple of REVIEW_NOTIFY_EVERY or announce it twice.
 */
let backlogChain: Promise<void> = Promise.resolve();
/** The last group of REVIEW_NOTIFY_EVERY the list reached; null until the first check. */
/** Recipients already notified for `deliveringBucket`, so a retry does not repeat them. */
const deliveredTo = new Set<string>();
let deliveringBucket: number | null = null;
let notifiedBucket: number | null = null;

async function checkReviewBacklog(): Promise<void> {
  const waiting = (await storage.getClassificationCandidates({ status: "pending" })).length;
  const bucket = Math.floor(waiting / REVIEW_NOTIFY_EVERY);
  // Without a baseline (it could not be read) nothing is announced rather than guessed
  notifiedBucket ??= bucket;
  // Labeling shrinks the list: follow it down so the next climb to a multiple announces again
  if (bucket < notifiedBucket) notifiedBucket = bucket;
  if (bucket <= notifiedBucket) return;
  if (deliveringBucket !== bucket) {
    deliveringBucket = bucket;
    deliveredTo.clear();
  }
  const users = (await storage.getAllUsers()).filter((user) => !deliveredTo.has(user.id));
  const results = await Promise.allSettled(
    users.map(async (user) => {
      const notification = await storage.addNotification({
        userId: user.id,
        type: "info",
        title: "Releases need your review",
        message: `${waiting} releases the classifier was unsure about are waiting for a label. Labeling a few helps the local model improve.`,
        link: REVIEW_LINK,
      });
      deliveredTo.add(user.id);
      notifyUser("notification", notification, notification.userId);
    })
  );
  const failed = results.find((r) => r.status === "rejected");
  // The step is only taken once everyone has it; a retry skips those already notified
  if (failed) throw (failed as PromiseRejectedResult).reason;
  notifiedBucket = bucket;
  deliveringBucket = null;
  deliveredTo.clear();
}

/**
 * Reads the waiting list once, before the first insert of this run, so a crossing is measured
 * against what was there and not inferred from a count taken after concurrent inserts.
 */
function ensureBacklogBaseline(): Promise<void> {
  if (notifiedBucket !== null) return Promise.resolve();
  backlogChain = backlogChain
    .then(async () => {
      if (notifiedBucket !== null) return;
      const waiting = (await storage.getClassificationCandidates({ status: "pending" })).length;
      notifiedBucket = Math.floor(waiting / REVIEW_NOTIFY_EVERY);
    })
    .catch((error) => {
      alLogger.warn({ error }, "Could not read the classification review backlog");
    });
  return backlogChain;
}

/**
 * Tells every user that releases are waiting for a label. Nobody opens the review card on their
 * own, so a new candidate that brings the waiting list into a new group of REVIEW_NOTIFY_EVERY
 * sends one notification that opens the card. Never throws.
 */
function notifyReviewBacklog(): Promise<void> {
  backlogChain = backlogChain.then(checkReviewBacklog).catch((error) => {
    alLogger.warn({ error }, "Could not notify about the classification review backlog");
  });
  return backlogChain;
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
    const stored = await storage.countClassificationCandidates();
    // Remembered once the count succeeded, so a full table is not counted and logged on every
    // cycle while a failed count is still retried
    remember(dedupeKey, now);
    const max = config.classification.activeLearning.maxCandidates;
    if (stored >= max) {
      // At the cap nothing is written, not even a refresh of an existing row: delete some first
      alLogger.warn({ max }, "Candidate limit reached, not collecting more");
      return;
    }
    await ensureBacklogBaseline();
    const { candidate, created } = await storage.upsertClassificationCandidate({
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
    // A refresh rewrites the reasons of a pending candidate, so a disagreement found through the
    // "Ask the cloud model" button is derived again from the suggestion that is still stored
    if (candidate.status === "pending" && candidate.suggestedLabel) {
      const flagged = disagreementUpdate(candidate, candidate.suggestedLabel);
      if (flagged) await storage.updateClassificationCandidate(candidate.id, flagged);
    }
    if (created) await notifyReviewBacklog();
  } catch (error) {
    alLogger.warn({ error, title: input.title }, "Could not store a classification candidate");
  }
}

/**
 * What a cloud suggestion adds to a candidate: when it names a different class than the local
 * model's best guess, the candidate gets the `model_disagreement` reason and the priority that
 * goes with it. Null when nothing changes (no local guess, same class, or already flagged).
 */
export function disagreementUpdate(
  candidate: Pick<ClassificationCandidate, "reasons" | "signals" | "priority">,
  suggestedLabel: string
): { reasons: string; priority: number } | null {
  const reasons = parse<CandidateReason[]>(candidate.reasons, []);
  if (reasons.includes("model_disagreement")) return null;
  const local = parse<CandidateSignals | null>(candidate.signals, null)?.local;
  if (!local || !classesConflict(suggestedLabel, local.class)) return null;
  return {
    reasons: JSON.stringify([...reasons, "model_disagreement"]),
    priority: candidate.priority + 40,
  };
}

/** Forgets which releases were just written, so deleted candidates can be collected again. */
export function resetCollectionMemory(): void {
  recentlySeen.clear();
  notifiedBucket = null;
  deliveringBucket = null;
  deliveredTo.clear();
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
