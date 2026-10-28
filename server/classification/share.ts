import { createHash } from "node:crypto";
import { CANDIDATE_LABELS } from "../../shared/release-labels.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { storage } from "../storage.js";
import { localModelStatus } from "./index.js";

const shareLogger = logger.child({ module: "classification-share" });

/**
 * Opt-in sharing of verified labels (docs/RELEASE_CLASSIFICATION.md, "Share your verified
 * labels"). The address is fixed in the code on purpose: the endpoint takes no API key, since a
 * key shipped in an open-source app is not a secret, and a configurable address would turn this
 * into a way to post to any server.
 */
export const SHARE_URL = "https://labels.questarr.app/v1/labels";

/** What one request may carry, mirrored by the collector, which refuses more. */
export const SHARE_MAX_ROWS = 200;
export const SHARE_MAX_RELEASE_NAME = 300;
export const SHARE_MAX_GAME_TITLE = 200;

const SHARED_KEY = "classification.shared";
const SHARED_MEMORY = 20_000;
const SEND_TIMEOUT_MS = 10_000;

/** The only four fields that leave the server. */
export interface SharedLabel {
  releaseName: string;
  gameTitle: string;
  label: string;
  modelVersion: string;
}

export interface ShareBatch {
  rows: SharedLabel[];
  /** Verified rows that fit no request yet (more than SHARE_MAX_ROWS) */
  remaining: number;
  alreadyShared: number;
  /** Verified rows left out because they have no game title, or a value that is too long */
  skipped: number;
}

/** Short fingerprint of a release name, used only to remember what was already sent. */
function fingerprint(releaseName: string): string {
  const normalized = releaseName.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

async function readShared(): Promise<string[]> {
  const raw = await storage.getSystemConfig(SHARED_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** The rows a send would carry now: verified, not sent before, and within the size limits. */
export async function buildShareBatch(): Promise<ShareBatch> {
  const [verified, shared] = await Promise.all([
    storage.getClassificationCandidates({ status: "verified" }),
    readShared(),
  ]);
  const sent = new Set(shared);
  const modelVersion = localModelStatus().version ?? "none";
  const labels: readonly string[] = CANDIDATE_LABELS;
  const eligible: SharedLabel[] = [];
  let alreadyShared = 0;
  let skipped = 0;
  for (const row of verified) {
    if (!row.humanLabel || !labels.includes(row.humanLabel)) continue;
    if (sent.has(fingerprint(row.releaseName))) {
      alreadyShared++;
      continue;
    }
    const gameTitle = row.gameTitle?.trim();
    if (
      !gameTitle ||
      gameTitle.length > SHARE_MAX_GAME_TITLE ||
      row.releaseName.length > SHARE_MAX_RELEASE_NAME
    ) {
      skipped++;
      continue;
    }
    eligible.push({
      releaseName: row.releaseName,
      gameTitle,
      label: row.humanLabel,
      modelVersion,
    });
  }
  return {
    rows: eligible.slice(0, SHARE_MAX_ROWS),
    remaining: Math.max(0, eligible.length - SHARE_MAX_ROWS),
    alreadyShared,
    skipped,
  };
}

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Sends the batch the person previewed. One manual request, no background task, no redirect
 * followed, nothing but the four fields in the body.
 */
export async function sendShareBatch(): Promise<{ sent: number; remaining: number }> {
  if (!config.classification.activeLearning.shareLabels) {
    throw new ShareError("Sharing is off", 403);
  }
  const batch = await buildShareBatch();
  if (batch.rows.length === 0) throw new ShareError("No verified labels to share", 409);

  let response: Response;
  try {
    response = await fetch(SHARE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: batch.rows }),
      redirect: "error",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    shareLogger.warn({ error }, "Could not reach the label collector");
    throw new ShareError("The collection point could not be reached", 502);
  }
  if (!response.ok) {
    shareLogger.warn({ status: response.status }, "The label collector refused the batch");
    throw new ShareError(`The collection point refused the batch (${response.status})`, 502);
  }

  const sent = [...(await readShared()), ...batch.rows.map((r) => fingerprint(r.releaseName))];
  await storage.setSystemConfig(SHARED_KEY, JSON.stringify(sent.slice(-SHARED_MEMORY)));
  return { sent: batch.rows.length, remaining: batch.remaining };
}
