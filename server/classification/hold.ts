import type { SearchItem } from "../search.js";
import type { ReleaseType } from "../../shared/typesafe-types.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { collectCandidate } from "./active-learning.js";
import { localGuess, releasePipeline, type PipelineResult } from "./index.js";

const holdLogger = logger.child({ module: "classification" });

const HOLD_CLASSES = new Set(["patch", "dlc", "expansion"]);
const HOLD_FLAGS = new Set(["crack_only", "demo", "soundtrack", "other_artifact"]);
const LEGITIMACY_THRESHOLD = 0.5;

/** Hybrid and cloud may call a paid provider, so a search classifies only its top results. */
export const PROVIDER_MAX_ITEMS = 15;

type ReleaseInput = Pick<SearchItem, "title" | "size">;

/**
 * Runs the classification pipeline for one release. This is the only entry point for the
 * `local` and `hybrid` modes, shared by the auto-download hold and the search results, so both
 * always agree. Any failure resolves to null: callers treat it as "no verdict".
 */
export async function classifyRelease(
  item: ReleaseInput,
  platform: string | null,
  gameTitle: string | undefined,
  options: { collect?: boolean } = {}
): Promise<PipelineResult | null> {
  try {
    const input = {
      title: item.title,
      ...(gameTitle ? { gameTitle } : {}),
      sizeBytes: item.size,
      platform: platform ?? undefined,
    };
    const result = await releasePipeline.classify(input);
    // Optional, off by default, and it never throws: it cannot change the decision
    if (options.collect && config.classification.activeLearning.collect) {
      void collectCandidate(input, result, localGuess(input));
    }
    return result;
  } catch (error) {
    holdLogger.warn(
      { error, title: item.title },
      "Release classification failed, proceeding without it"
    );
    return null;
  }
}

/**
 * Why a classified release should not be downloaded unattended, or null when it may go ahead.
 * It holds what the layers agree is not the full game. A release no layer could classify goes
 * through unless CLASSIFICATION_HOLD_UNKNOWN is set.
 */
export function holdReasonFor(result: PipelineResult, item: ReleaseInput): string | null {
  const flag = result.flags?.find((f) => HOLD_FLAGS.has(f));
  if (HOLD_CLASSES.has(result.class) || flag) {
    return `Classified (${result.source}) as "${flag ?? result.class}" rather than the full game`;
  }
  // A layer failure is not a verdict: holding on it would block the release for days
  if (result.class === "unknown" && config.classification.holdUnknown && !result.degraded) {
    return "Could not be classified as the full game (hold-unknown is enabled)";
  }
  if (
    item.size !== undefined &&
    result.legitimacyScore !== undefined &&
    result.legitimacyScore !== null &&
    result.legitimacyScore < LEGITIMACY_THRESHOLD
  ) {
    return "AI flagged this release's file size as implausible for this type of release";
  }
  return null;
}

/** The hold check for the `local` and `hybrid` classification modes (fail-open). */
export async function pipelineHoldReason(
  item: ReleaseInput,
  platform: string | null,
  gameTitle: string | undefined
): Promise<string | null> {
  const result = await classifyRelease(item, platform, gameTitle, { collect: true });
  return result ? holdReasonFor(result, item) : null;
}

/** The legacy Jev release types, which the existing search categories and UI understand. */
export function legacyType(result: PipelineResult): ReleaseType | undefined {
  const flag = result.flags?.find((f) => HOLD_FLAGS.has(f));
  if (flag === "crack_only" || flag === "demo" || flag === "soundtrack") return flag;
  if (flag === "other_artifact") return "other";
  switch (result.class) {
    case "full_game":
      return result.flags?.includes("repack") ? "repack" : "full_game";
    case "patch":
      return "update";
    case "dlc":
    case "expansion":
      return "dlc";
    default:
      return undefined;
  }
}
