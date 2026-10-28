import { Router, type Request, type Response } from "express";
import { routesLogger } from "./logger.js";
import { typesafeClient } from "./typesafe.js";
import { localModelStatus } from "./classification/index.js";
import {
  classificationSettingsSchema,
  currentSettings,
  lockedSettings,
  updateClassificationSettings,
} from "./classification/settings.js";

/**
 * Settings page for release classification (docs/RELEASE_CLASSIFICATION.md). A setting fixed by
 * an environment variable is reported under `locked` and cannot be changed here.
 */
const router = Router();

async function overview() {
  return {
    settings: currentSettings(),
    locked: lockedSettings(),
    localModel: localModelStatus(),
    cloud: {
      configured: await typesafeClient.isConfigured(),
      model: typesafeClient.modelId,
    },
  };
}

router.get("/api/settings/classification", async (_req: Request, res: Response) => {
  try {
    res.json(await overview());
  } catch (error) {
    routesLogger.error({ error }, "Could not read the classification settings");
    res.status(500).json({ error: "Could not read the classification settings" });
  }
});

router.put("/api/settings/classification", async (req: Request, res: Response): Promise<void> => {
  const parsed = classificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid classification settings", details: parsed.error.issues });
    return;
  }
  try {
    const { rejected } = await updateClassificationSettings(parsed.data);
    if (rejected.length > 0) {
      res.status(409).json({
        error: `Set by an environment variable: ${rejected.join(", ")}`,
        locked: rejected,
      });
      return;
    }
    res.json(await overview());
  } catch (error) {
    routesLogger.error({ error }, "Could not save the classification settings");
    res.status(500).json({ error: "Could not save the classification settings" });
  }
});

export { router as classificationSettingsRoutes };
