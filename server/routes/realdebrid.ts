import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage.js";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter } from "../middleware.js";
import {
  pollRealDebridDeviceFlow,
  serializeRealDebridCredentials,
  startRealDebridDeviceFlow,
} from "../downloaders/realdebrid-auth.js";

// Mounted at /api/downloaders/:id/realdebrid
export const realDebridRouter = Router({ mergeParams: true });

async function loadRealDebridDownloader(id: string) {
  const downloader = await storage.getDownloader(id);
  return downloader?.type === "realdebrid" ? downloader : undefined;
}

// POST .../auth/start - begin the OAuth device flow; the user approves on real-debrid.com/device
realDebridRouter.post("/auth/start", sensitiveEndpointLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    if (!(await loadRealDebridDownloader(id))) {
      return res.status(404).json({ error: "Real-Debrid downloader not found" });
    }
    return res.json(await startRealDebridDeviceFlow(id));
  } catch (error) {
    logger.error({ error }, "error starting Real-Debrid device flow");
    return res.status(502).json({ error: "Could not reach Real-Debrid" });
  }
});

const pollSchema = z.object({ flowId: z.string().min(1) });

// POST .../auth/poll - check whether the user approved; tokens are stored server-side only
realDebridRouter.post("/auth/poll", sensitiveEndpointLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = pollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "flowId is required" });
  try {
    if (!(await loadRealDebridDownloader(id))) {
      return res.status(404).json({ error: "Real-Debrid downloader not found" });
    }
    const result = await pollRealDebridDeviceFlow(parsed.data.flowId, id);
    if (result.status !== "authorized") return res.json(result);

    await storage.updateDownloader(id, {
      password: serializeRealDebridCredentials(result.credentials),
    });
    return res.json({ status: "authorized" });
  } catch (error) {
    logger.error({ error }, "error polling Real-Debrid device flow");
    return res.status(502).json({ error: "Could not reach Real-Debrid" });
  }
});
