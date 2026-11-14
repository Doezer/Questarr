import { createHmac, randomBytes, randomUUID } from "crypto";
import {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT,
  type WebhookEventType,
  type WebhookSubscription,
  type WebhookSubscriptionPublic,
} from "../shared/schema.js";
import { storage } from "./storage.js";
import { isSafeUrl, safeFetch } from "./ssrf.js";
import { logger } from "./logger.js";

/** Delivery attempts per event (the first try plus retries). */
export const WEBHOOK_MAX_ATTEMPTS = 3;
/** Wait before the 2nd and 3rd attempt. */
const RETRY_DELAYS_MS = [2_000, 10_000];
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Recent attempts kept per subscription; the purge task trims anything older. */
export const WEBHOOK_DELIVERIES_KEPT = 50;
export const MAX_WEBHOOKS_PER_USER = 20;
const MAX_ERROR_LENGTH = 300;

export type WebhookEventName = WebhookEventType | typeof WEBHOOK_TEST_EVENT;

export interface WebhookEnvelope {
  id: string;
  type: WebhookEventName;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface WebhookAttemptResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  attempt: number;
  durationMs: number;
}

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export function toPublicWebhookSubscription(sub: WebhookSubscription): WebhookSubscriptionPublic {
  const { secret: _secret, ...rest } = sub;
  return rest;
}

/** A fresh signing secret, shown to the user once. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export async function encryptWebhookSecret(secret: string): Promise<string> {
  // Loaded on demand: credential-crypto opens the database, which callers of emitWebhookEvent
  // (cron, import) must not pull in at import time.
  return (await import("./credential-crypto.js")).encryptCredential(secret);
}

/**
 * `sha256=<hex HMAC>` over `<timestamp>.<body>`, so a receiver can reject replays by checking the
 * timestamp header as well as the signature.
 */
export function signWebhookBody(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/**
 * Validates a user-supplied target URL. Only http(s), no embedded credentials, and the host must
 * pass the SSRF check (cloud metadata and the like are refused; LAN targets stay allowed since
 * self-hosted automation usually lives there).
 */
export async function validateWebhookUrl(
  raw: unknown
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "URL is required" };
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must start with http:// or https://" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URL must not contain credentials" };
  }
  // The canonical href, not the raw input, so a case-variant scheme can't dodge the host check.
  if (!(await isSafeUrl(parsed.href))) {
    return { ok: false, error: "URL points to a disallowed address" };
  }
  return { ok: true, url: parsed.href };
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

function isRetryable(statusCode: number | null): boolean {
  if (statusCode === null) return true;
  return statusCode >= 500 || statusCode === 429 || statusCode === 408;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptDelivery(
  sub: WebhookSubscription,
  secret: string,
  envelope: WebhookEnvelope,
  body: string,
  attempt: number
): Promise<WebhookAttemptResult> {
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const timestamp = Math.floor(started / 1000).toString();
    const res = await safeFetch(sub.url, {
      method: "POST",
      allowPrivate: true,
      // A redirect would send the signed body somewhere the user never configured.
      redirect: "manual",
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Questarr-Webhooks",
        "X-Questarr-Event": envelope.type,
        "X-Questarr-Delivery": envelope.id,
        "X-Questarr-Timestamp": timestamp,
        "X-Questarr-Signature": signWebhookBody(secret, timestamp, body),
      },
      body,
    });
    statusCode = res.status;
    // Drain the body so the connection is released; the content is irrelevant.
    await res.arrayBuffer().catch(() => undefined);
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = truncate(err instanceof Error ? err.message : String(err));
  }
  const durationMs = Date.now() - started;
  try {
    await storage.addWebhookDelivery({
      subscriptionId: sub.id,
      eventId: envelope.id,
      eventType: envelope.type,
      attempt,
      statusCode,
      error,
      durationMs,
    });
  } catch (logErr) {
    logger.warn({ err: logErr, subscriptionId: sub.id }, "Failed to record delivery");
  }
  return { ok: error === null, statusCode, error, attempt, durationMs };
}

export interface DeliverOptions {
  /** Defaults to WEBHOOK_MAX_ATTEMPTS; the test operation uses 1. */
  maxAttempts?: number;
  /** Overridable so tests don't wait for real backoff. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Sends one envelope to one subscription, retrying transient failures. Never throws. */
export async function deliverWebhook(
  sub: WebhookSubscription,
  envelope: WebhookEnvelope,
  options: DeliverOptions = {}
): Promise<WebhookAttemptResult> {
  const maxAttempts = options.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
  const wait = options.sleepFn ?? sleep;
  const body = JSON.stringify(envelope);

  let secret: string;
  try {
    secret = await (await import("./credential-crypto.js")).decryptCredential(sub.secret);
  } catch (err) {
    const error = "Stored secret could not be decrypted";
    logger.error({ err, subscriptionId: sub.id }, error);
    return { ok: false, statusCode: null, error, attempt: 1, durationMs: 0 };
  }

  let result = await attemptDelivery(sub, secret, envelope, body, 1);
  for (let attempt = 2; attempt <= maxAttempts && !result.ok; attempt++) {
    if (!isRetryable(result.statusCode)) break;
    await wait(RETRY_DELAYS_MS[attempt - 2] ?? RETRY_DELAYS_MS.at(-1)!);
    result = await attemptDelivery(sub, secret, envelope, body, attempt);
  }
  if (!result.ok) {
    logger.warn(
      { subscriptionId: sub.id, event: envelope.type, error: result.error },
      "Webhook delivery failed"
    );
  }
  return result;
}

export function buildWebhookEnvelope(
  type: WebhookEventName,
  data: Record<string, unknown>
): WebhookEnvelope {
  return { id: randomUUID(), type, createdAt: new Date().toISOString(), data };
}

/** Sends a sample event to one subscription, once, and reports the outcome. */
export function sendTestWebhook(sub: WebhookSubscription): Promise<WebhookAttemptResult> {
  const envelope = buildWebhookEnvelope(WEBHOOK_TEST_EVENT, {
    message: "This is a test event from Questarr.",
    subscription: { id: sub.id, name: sub.name },
  });
  return deliverWebhook(sub, envelope, { maxAttempts: 1 });
}

/**
 * Publishes an event to every enabled subscription that listens for it. Fire-and-forget: callers
 * never wait on (or fail because of) a webhook receiver. `userId` limits delivery to that user's
 * subscriptions; when the owner is unknown every subscription listening for the event gets it.
 */
export function emitWebhookEvent(
  type: WebhookEventType,
  data: Record<string, unknown>,
  userId?: string | null
): void {
  void (async () => {
    const subs = (await storage.getEnabledWebhookSubscriptions()).filter(
      (s) => s.events.includes(type) && (!userId || s.userId === userId)
    );
    await Promise.all(subs.map((sub) => deliverWebhook(sub, buildWebhookEnvelope(type, data))));
  })().catch((err) => {
    // Dispatch is best effort: even a failing logger must not become an unhandled rejection.
    try {
      logger.warn({ err, event: type }, "Webhook dispatch failed");
    } catch {
      /* ignore */
    }
  });
}

/** Body of the "webhook-deliveries-purge" System Task. */
export async function purgeWebhookDeliveries(): Promise<number> {
  return storage.pruneWebhookDeliveries(WEBHOOK_DELIVERIES_KEPT);
}
