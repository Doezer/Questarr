import { Router } from "express";
import z from "zod";
import { storage } from "../storage.js";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter } from "../middleware.js";
import { readRommSettings, rommClient, writeRommSettings, ROMM_CONFIG_KEYS } from "../romm.js";
import { syncFromRomm } from "../romm-sync.js";

export const rommRouter = Router();

const REDACTED = "********";

const rommSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    url: z
      .string()
      .max(1024)
      .refine((value) => value === "" || /^https?:\/\//i.test(value), {
        message: "URL must start with http:// or https://",
      })
      .optional(),
    apiToken: z.string().max(512).optional(),
    platformFolders: z.boolean().optional(),
    syncEnabled: z.boolean().optional(),
    scanAfterImport: z.boolean().optional(),
  })
  .strict();

rommRouter.use((req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
  res.locals.userId = req.user.id;
  return next();
});

rommRouter.get("/", async (_req, res) => {
  try {
    const settings = await readRommSettings();
    const lastSync = (await storage.getSystemConfig(ROMM_CONFIG_KEYS.lastSync)) ?? null;
    res.json({
      enabled: settings.enabled,
      url: settings.url,
      apiToken: settings.apiToken ? REDACTED : "",
      platformFolders: settings.platformFolders,
      syncEnabled: settings.syncEnabled,
      scanAfterImport: settings.scanAfterImport,
      lastSync,
    });
  } catch (error) {
    logger.error({ error }, "Failed to read RomM settings");
    res.status(500).json({ error: "Failed to read RomM settings" });
  }
});

rommRouter.post("/", async (req, res) => {
  try {
    const update = rommSettingsSchema.parse(req.body);
    const { apiToken, ...rest } = update;
    await writeRommSettings({
      ...rest,
      ...(apiToken !== undefined && apiToken !== REDACTED ? { apiToken } : {}),
    });
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues.map((i) => i.message).join(", ") });
    }
    logger.error({ error }, "Failed to save RomM settings");
    return res.status(500).json({ error: "Failed to save RomM settings" });
  }
});

// Candidate values are tested as typed and never saved: a typo must not overwrite working settings.
const rommTestSchema = z
  .object({
    url: z
      .string()
      .max(1024)
      .refine((value) => /^https?:\/\//i.test(value), {
        message: "URL must start with http:// or https://",
      })
      .optional(),
    apiToken: z.string().max(512).optional(),
  })
  .strict();

rommRouter.post("/test", sensitiveEndpointLimiter, async (req, res) => {
  try {
    const candidate = rommTestSchema.parse(req.body ?? {});
    const saved = await readRommSettings();
    const token = candidate.apiToken;
    const platforms = await rommClient.testConnection({
      url: candidate.url?.trim().replace(/\/+$/, "") ?? saved.url,
      apiToken: token === undefined || token === REDACTED || token === "" ? saved.apiToken : token,
    });
    return res.json({ success: true, platforms });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues.map((i) => i.message).join(", ") });
    }
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Could not reach RomM",
    });
  }
});

rommRouter.post("/sync", sensitiveEndpointLimiter, async (_req, res) => {
  try {
    const summary = await syncFromRomm(res.locals.userId as string);
    res.json({ success: true, summary });
  } catch (error) {
    logger.warn({ error }, "RomM sync failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "RomM sync failed" });
  }
});
