import { Router } from "express";
import { z } from "zod";
import { routesLogger as logger } from "../logger.js";
import { storage } from "../storage.js";
import { INITIAL_WIZARD_REVISION, WIZARD_REVISION } from "../../shared/setup-wizard.js";

export const SETUP_WIZARD_KEY = "setup_wizard.state";
export const SETUP_WIZARD_REVISION_KEY = "setup_wizard.seen_revision";

/**
 * - `pending`: a fresh install that has not been through the wizard yet (set by first-run setup).
 * - `done`: the wizard was completed, or skipped, on purpose.
 * - `never`: nothing recorded -- an install that predates the wizard. It is offered, never forced.
 */
export type SetupWizardState = "pending" | "done" | "never";

const updateSchema = z.object({ state: z.enum(["pending", "done"]) });

export async function readSetupWizardState(): Promise<SetupWizardState> {
  const value = await storage.getSystemConfig(SETUP_WIZARD_KEY);
  return value === "pending" || value === "done" ? value : "never";
}

/** The wizard revision the user last finished or dismissed; older installs saw revision 1. */
export async function readSeenWizardRevision(): Promise<number> {
  const value = Number.parseInt(
    (await storage.getSystemConfig(SETUP_WIZARD_REVISION_KEY)) ?? "",
    10
  );
  return Number.isFinite(value) && value > 0 ? value : INITIAL_WIZARD_REVISION;
}

export const setupWizardRouter = Router();

// GET /api/system/setup-wizard
setupWizardRouter.get("/", async (_req, res) => {
  try {
    const [state, seenRevision] = await Promise.all([
      readSetupWizardState(),
      readSeenWizardRevision(),
    ]);
    return res.json({ state, seenRevision, currentRevision: WIZARD_REVISION });
  } catch (error) {
    logger.error({ error }, "failed to read setup wizard state");
    return res.status(500).json({ error: "Failed to read setup wizard state" });
  }
});

// PUT /api/system/setup-wizard  { state: "done" | "pending" }
setupWizardRouter.put("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "state must be 'pending' or 'done'" });
  }
  try {
    await storage.setSystemConfig(SETUP_WIZARD_KEY, parsed.data.state);
    if (parsed.data.state === "done") {
      await storage.setSystemConfig(SETUP_WIZARD_REVISION_KEY, String(WIZARD_REVISION));
    }
    return res.json({ state: parsed.data.state });
  } catch (error) {
    logger.error({ error }, "failed to update setup wizard state");
    return res.status(500).json({ error: "Failed to update setup wizard state" });
  }
});
