import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { CANDIDATE_LABELS, CANDIDATE_STATUSES } from "../shared/release-labels.js";
import { config } from "./config.js";
import { routesLogger } from "./logger.js";
import { storage } from "./storage.js";
import { typesafeClient } from "./typesafe.js";
import { exportVerifiedCsv, rankCandidates } from "./classification/active-learning.js";

/**
 * Review workflow for the releases active learning collected (docs/RELEASE_CLASSIFICATION.md).
 * Nothing here retrains or redeploys a model: a person verifies labels, exports them, and
 * retrains by hand. All routes sit behind the /api authentication gate.
 */
const router = Router();

const MAX_LISTED = 300;

const reviewSchema = z.discriminatedUnion("action", [
  // accept: take the proposed label (the cloud suggestion, else the local prediction) as is
  z.object({ action: z.literal("accept"), notes: z.string().trim().max(500).optional() }),
  z.object({
    action: z.literal("correct"),
    label: z.enum(CANDIDATE_LABELS),
    notes: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("reject"), notes: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("ambiguous"), notes: z.string().trim().max(500).optional() }),
]);

async function overview(status?: string) {
  const all = await storage.getClassificationCandidates();
  const counts = Object.fromEntries(CANDIDATE_STATUSES.map((s) => [s, 0])) as Record<
    (typeof CANDIDATE_STATUSES)[number],
    number
  >;
  for (const row of all) {
    if (row.status in counts) counts[row.status as keyof typeof counts]++;
  }
  // Ranking needs every verified row to see which classes are thin, then the view is filtered
  const ranked = rankCandidates(all).filter((c) => status === undefined || c.status === status);
  return {
    collecting: config.classification.activeLearning.collect,
    cloudSuggest: config.classification.activeLearning.cloudSuggest,
    cloudAvailable: await typesafeClient.isConfigured(),
    mode: config.classification.mode,
    labels: CANDIDATE_LABELS,
    counts,
    candidates: ranked.slice(0, MAX_LISTED),
  };
}

router.get("/api/classification-candidates", async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status !== undefined && !(CANDIDATE_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ error: "Unknown status" });
    }
    return res.json(await overview(status ?? "pending"));
  } catch (error) {
    routesLogger.error({ error }, "error listing classification candidates");
    return res.status(500).json({ error: "Failed to list candidates" });
  }
});

router.get("/api/classification-candidates/export", async (_req: Request, res: Response) => {
  try {
    const { csv, exported, skippedNoGame } = exportVerifiedCsv(
      await storage.getClassificationCandidates({ status: "verified" })
    );
    return res
      .type("text/csv")
      .set("Content-Disposition", 'attachment; filename="verified-candidates.csv"')
      .set("X-Exported-Rows", String(exported))
      .set("X-Skipped-No-Game", String(skippedNoGame))
      .send(csv);
  } catch (error) {
    routesLogger.error({ error }, "error exporting classification candidates");
    return res.status(500).json({ error: "Failed to export candidates" });
  }
});

router.post("/api/classification-candidates/:id/review", async (req: Request, res: Response) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid review", details: parsed.error.issues });
  }
  try {
    const id = String(req.params.id);
    const candidate = await storage.getClassificationCandidate(id);
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    const review = parsed.data;
    const notes = review.notes ?? candidate.notes ?? null;
    let patch: Parameters<typeof storage.updateClassificationCandidate>[1];
    if (review.action === "accept" || review.action === "correct") {
      let label: string | null | undefined;
      if (review.action === "correct") {
        label = review.label;
      } else {
        // Only a proposal made for this release can be accepted
        label = candidate.suggestedLabel ?? proposedByLocal(candidate.signals);
        if (!label) {
          return res.status(400).json({ error: "Nothing to accept: pick a label instead" });
        }
      }
      patch = { status: "verified", humanLabel: label, notes, reviewedAt: new Date() };
    } else {
      patch = {
        status: review.action === "reject" ? "rejected" : "ambiguous",
        humanLabel: null,
        notes,
        reviewedAt: new Date(),
      };
    }
    return res.json(await storage.updateClassificationCandidate(id, patch));
  } catch (error) {
    routesLogger.error({ error }, "error reviewing classification candidate");
    return res.status(500).json({ error: "Failed to review candidate" });
  }
});

/** The local model's label for a candidate, usable as a proposal when it names a real class. */
function proposedByLocal(signals: string): string | null {
  try {
    const parsed = JSON.parse(signals) as { local?: { class?: string } | null };
    const guessed = parsed.local?.class;
    return guessed && guessed !== "unknown" && guessed !== "expansion" ? guessed : null;
  } catch {
    return null;
  }
}

router.post("/api/classification-candidates/:id/suggest", async (req: Request, res: Response) => {
  // A paid request: off unless ACTIVE_LEARNING_CLOUD_SUGGEST is set, and one candidate at a time
  if (!config.classification.activeLearning.cloudSuggest) {
    return res.status(403).json({ error: "Cloud suggestions are disabled" });
  }
  try {
    const id = String(req.params.id);
    const candidate = await storage.getClassificationCandidate(id);
    if (!candidate) return res.status(404).json({ error: "Candidate not found" });
    if (!(await typesafeClient.isConfigured())) {
      return res.status(409).json({ error: "No cloud provider is configured" });
    }
    const analysis = await typesafeClient.analyzeRelease({
      releaseName: candidate.releaseName,
      sizeBytes: candidate.sizeBytes ?? undefined,
      platform: candidate.platform ?? undefined,
    });
    if (!analysis?.releaseType) {
      return res.status(502).json({ error: "The provider gave no usable answer" });
    }
    // A suggestion is stored beside the candidate; it never sets the human label or the status
    const updated = await storage.updateClassificationCandidate(id, {
      suggestedLabel: analysis.releaseType,
      suggestedConfidence: analysis.releaseTypeConfidence,
      suggestedModel: typesafeClient.modelId,
      suggestedAt: new Date(),
    });
    return res.json(updated);
  } catch (error) {
    routesLogger.error({ error }, "error asking the provider for a suggestion");
    return res.status(502).json({ error: "The provider request failed" });
  }
});

router.delete("/api/classification-candidates", async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status !== undefined && !(CANDIDATE_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ error: "Unknown status" });
    }
    return res.json({ deleted: await storage.deleteClassificationCandidates(status) });
  } catch (error) {
    routesLogger.error({ error }, "error deleting classification candidates");
    return res.status(500).json({ error: "Failed to delete candidates" });
  }
});

export { router as classificationCandidatesRoutes };
