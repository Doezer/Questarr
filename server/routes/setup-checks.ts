import { Router } from "express";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter } from "../middleware.js";
import { runSetupChecks } from "../setup-checks.js";

export const setupChecksRouter = Router();

// POST /api/system/setup-checks
// Read-only: runs every check and returns the report. POST (not GET) because it
// triggers outbound probes to indexers and download clients.
setupChecksRouter.post("/", sensitiveEndpointLimiter, async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    return res.json(await runSetupChecks());
  } catch (error) {
    logger.error({ error }, "setup checks failed");
    return res.status(500).json({ error: "Failed to run setup checks" });
  }
});
