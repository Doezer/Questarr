import { Router, type Request, type Response } from "express";
import { param } from "express-validator";
import { z } from "zod";
import { storage } from "../storage.js";
import { generateApiKey } from "../auth.js";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter, validateRequest } from "../middleware.js";

// Same shape as sanitizeGameId/sanitizeDownloadId in middleware.ts: api_keys.id
// is a randomUUID(), so a non-UUID path segment can never match a row and is
// rejected here instead of falling through to a storage lookup.
const sanitizeApiKeyId = [
  param("id")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid API key ID format"),
];

/**
 * Management for integration API keys.
 *
 * Mounted behind the JWT-only branch of the /api auth gate on purpose: a key
 * must never be able to mint or revoke another key, so this surface stays
 * reachable only from a logged-in browser session.
 */
export const apiKeysRouter = Router();

// Every response here varies by req.user (key list, a freshly-minted raw
// key), so none of it may be cached by a shared proxy or the browser's own
// HTTP cache.
apiKeysRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** One key per integration is the intended usage; the cap just bounds abuse. */
const MAX_KEYS_PER_USER = 25;

const createKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
});

apiKeysRouter.get("/", async (req: Request, res: Response) => {
  try {
    res.json(await storage.getApiKeys(req.user!.id));
  } catch (error) {
    logger.error({ error }, "Failed to list API keys");
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

apiKeysRouter.post("/", sensitiveEndpointLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid name" });
    }

    const userId = req.user!.id;
    const { rawKey, keyHash, prefix } = generateApiKey();

    let created;
    try {
      // Count-then-insert happens atomically inside storage.addApiKey, so two
      // concurrent requests from the same user can't both slip past the cap.
      created = await storage.addApiKey(
        { userId, name: parsed.data.name, keyHash, prefix },
        MAX_KEYS_PER_USER
      );
    } catch (error) {
      if (error instanceof Error && error.message === "API key limit reached") {
        return res
          .status(409)
          .json({ error: `You can have at most ${MAX_KEYS_PER_USER} API keys. Revoke one first.` });
      }
      throw error;
    }

    logger.info(
      { userId, apiKeyId: created.id, name: created.name },
      "Integration API key created"
    );

    // The only time the raw key is ever returned: it is not recoverable later.
    res.status(201).json({ ...created, key: rawKey });
  } catch (error) {
    logger.error({ error }, "Failed to create API key");
    res.status(500).json({ error: "Failed to create API key" });
  }
});

apiKeysRouter.delete(
  "/:id",
  sensitiveEndpointLimiter,
  sanitizeApiKeyId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const removed = await storage.removeApiKey(req.params.id, userId);
      if (!removed) {
        return res.status(404).json({ error: "API key not found" });
      }
      logger.info({ userId, apiKeyId: req.params.id }, "Integration API key revoked");
      res.status(204).send();
    } catch (error) {
      logger.error({ error }, "Failed to revoke API key");
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  }
);
