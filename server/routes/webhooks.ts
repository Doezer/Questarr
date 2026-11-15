import { Router, type Request, type Response } from "express";
import { param } from "express-validator";
import { z } from "zod";
import { WEBHOOK_EVENT_TYPES } from "../../shared/schema.js";
import { storage } from "../storage.js";
import { stripUndefined } from "../object-utils.js";
import { routesLogger as logger } from "../logger.js";
import { sensitiveEndpointLimiter, validateRequest } from "../middleware.js";
import {
  MAX_WEBHOOKS_PER_USER,
  WEBHOOK_DELIVERIES_KEPT,
  encryptWebhookSecret,
  generateWebhookSecret,
  sendTestWebhook,
  toPublicWebhookSubscription,
  validateWebhookUrl,
} from "../webhooks.js";

const sanitizeWebhookId = [
  param("id")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid webhook ID format"),
];

/**
 * Outbound webhook subscriptions: CRUD, a test operation and the recent delivery log.
 *
 * Reachable with a JWT session or an `admin`-scope API key (see admin-api-routes.ts). The signing
 * secret is returned once, when a subscription is created or its secret rotated.
 */
export const webhooksRouter = Router();

webhooksRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENT_TYPES, { message: "Unknown event type" }))
  .min(1, "Select at least one event")
  .transform((events) => [...new Set(events)]);

const secretSchema = z
  .string()
  .min(16, "Secret must be at least 16 characters")
  .max(200, "Secret is too long");

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  url: z.string().trim().min(1, "URL is required").max(2000, "URL is too long"),
  events: eventsSchema,
  enabled: z.boolean().optional(),
  secret: secretSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long").optional(),
  url: z.string().trim().min(1, "URL is required").max(2000, "URL is too long").optional(),
  events: eventsSchema.optional(),
  enabled: z.boolean().optional(),
  secret: secretSchema.optional(),
  rotateSecret: z.boolean().optional(),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}

webhooksRouter.get("/", async (req: Request, res: Response) => {
  try {
    const subs = await storage.getWebhookSubscriptions(req.user!.id);
    res.json({ subscriptions: subs.map(toPublicWebhookSubscription), events: WEBHOOK_EVENT_TYPES });
  } catch (error) {
    logger.error({ error }, "Failed to list webhooks");
    res.status(500).json({ error: "Failed to list webhooks" });
  }
});

webhooksRouter.post("/", sensitiveEndpointLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });

    const userId = req.user!.id;
    const urlCheck = await validateWebhookUrl(parsed.data.url);
    if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });

    const existing = await storage.getWebhookSubscriptions(userId);
    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      return res.status(409).json({
        error: `You can have at most ${MAX_WEBHOOKS_PER_USER} webhooks. Delete one first.`,
      });
    }

    const rawSecret = parsed.data.secret ?? generateWebhookSecret();
    const created = await storage.addWebhookSubscription({
      userId,
      name: parsed.data.name,
      url: urlCheck.url,
      secret: await encryptWebhookSecret(rawSecret),
      events: parsed.data.events,
      ...stripUndefined({ enabled: parsed.data.enabled }),
    });
    logger.info({ userId, webhookId: created.id, name: created.name }, "Webhook created");
    // The only time the secret is returned when the server generated it.
    return res.status(201).json({ ...toPublicWebhookSubscription(created), secret: rawSecret });
  } catch (error) {
    logger.error({ error }, "Failed to create webhook");
    return res.status(500).json({ error: "Failed to create webhook" });
  }
});

webhooksRouter.patch(
  "/:id",
  sensitiveEndpointLimiter,
  sanitizeWebhookId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const userId = req.user!.id;
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });

      const existing = await storage.getWebhookSubscription(id, userId);
      if (!existing) return res.status(404).json({ error: "Webhook not found" });

      const { rotateSecret, secret, url, ...rest } = parsed.data;
      const patch: Parameters<typeof storage.updateWebhookSubscription>[2] = stripUndefined(rest);
      if (url !== undefined) {
        const urlCheck = await validateWebhookUrl(url);
        if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });
        patch.url = urlCheck.url;
      }
      let newSecret: string | undefined;
      if (secret || rotateSecret) {
        newSecret = secret ?? generateWebhookSecret();
        patch.secret = await encryptWebhookSecret(newSecret);
      }

      const updated = await storage.updateWebhookSubscription(id, userId, patch);
      if (!updated) return res.status(404).json({ error: "Webhook not found" });
      logger.info({ userId, webhookId: id, rotated: !!newSecret }, "Webhook updated");
      return res.json({
        ...toPublicWebhookSubscription(updated),
        ...(rotateSecret && newSecret ? { secret: newSecret } : {}),
      });
    } catch (error) {
      logger.error({ error }, "Failed to update webhook");
      return res.status(500).json({ error: "Failed to update webhook" });
    }
  }
);

webhooksRouter.delete(
  "/:id",
  sensitiveEndpointLimiter,
  sanitizeWebhookId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const removed = await storage.removeWebhookSubscription(id, req.user!.id);
      if (!removed) return res.status(404).json({ error: "Webhook not found" });
      logger.info({ userId: req.user!.id, webhookId: id }, "Webhook deleted");
      return res.status(204).send();
    } catch (error) {
      logger.error({ error }, "Failed to delete webhook");
      return res.status(500).json({ error: "Failed to delete webhook" });
    }
  }
);

webhooksRouter.post(
  "/:id/test",
  sensitiveEndpointLimiter,
  sanitizeWebhookId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const sub = await storage.getWebhookSubscription(id, req.user!.id);
      if (!sub) return res.status(404).json({ error: "Webhook not found" });
      const result = await sendTestWebhook(sub);
      if (!result.ok) {
        return res.status(502).json({
          success: false,
          error: result.error ?? "Delivery failed",
          statusCode: result.statusCode,
        });
      }
      return res.json({
        success: true,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
      });
    } catch (error) {
      logger.error({ error }, "Webhook test failed");
      return res.status(500).json({ error: "Webhook test failed" });
    }
  }
);

webhooksRouter.get(
  "/:id/deliveries",
  sanitizeWebhookId,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const sub = await storage.getWebhookSubscription(id, req.user!.id);
      if (!sub) return res.status(404).json({ error: "Webhook not found" });
      return res.json(await storage.getWebhookDeliveries(id, WEBHOOK_DELIVERIES_KEPT));
    } catch (error) {
      logger.error({ error }, "Failed to list webhook deliveries");
      return res.status(500).json({ error: "Failed to list webhook deliveries" });
    }
  }
);
