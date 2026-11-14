import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

vi.mock("../logger.js", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => log };
  return { logger: log, routesLogger: log };
});

const safeFetchMock = vi.fn();
vi.mock("../ssrf.js", async () => {
  const actual = await vi.importActual<typeof import("../ssrf.js")>("../ssrf.js");
  return { ...actual, safeFetch: (...args: unknown[]) => safeFetchMock(...args) };
});

vi.mock("../middleware.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware.js")>("../middleware.js");
  return {
    ...actual,
    sensitiveEndpointLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

describe.each(activeTestDialects())("outbound webhooks (%s)", (dialect) => {
  let db: TestDb;
  let webhooks: typeof import("../webhooks.js");
  let app: express.Express;
  let userId: string;
  let otherUserId: string;
  let currentUser: string;

  beforeAll(async () => {
    db = await setupTestDb(dialect);
    webhooks = await import("../webhooks.js");
    const { webhooksRouter } = await import("../routes/webhooks.js");
    userId = (await db.storage.createUser({ username: "wh-owner", passwordHash: "x" })).id;
    otherUserId = (await db.storage.createUser({ username: "wh-other", passwordHash: "x" })).id;
    currentUser = userId;
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: currentUser, username: "u" } as Express.User;
      next();
    });
    app.use("/api/webhooks", webhooksRouter);
  });

  afterAll(async () => {
    await db.teardown();
  });

  beforeEach(async () => {
    safeFetchMock.mockReset();
    currentUser = userId;
    for (const owner of [userId, otherUserId]) {
      for (const sub of await db.storage.getWebhookSubscriptions(owner)) {
        await db.storage.removeWebhookSubscription(sub.id, owner);
      }
    }
  });

  const okResponse = () => new Response("ok", { status: 200 });

  async function createSub(extra: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/webhooks")
      .send({
        name: "n8n",
        url: "https://hooks.example.com/questarr",
        events: ["download.completed"],
        ...extra,
      });
    return res;
  }

  describe("routes", () => {
    it("creates a subscription, returns the secret once and never lists it", async () => {
      const created = await createSub();
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^whsec_/);

      const list = await request(app).get("/api/webhooks");
      expect(list.status).toBe(200);
      expect(list.body.subscriptions).toHaveLength(1);
      expect(list.body.subscriptions[0]).not.toHaveProperty("secret");
      expect(list.body.events).toContain("import.failed");

      const [stored] = await db.storage.getWebhookSubscriptions(userId);
      expect(stored!.secret).not.toBe(created.body.secret);
    });

    it("rejects bad input and unsafe URLs", async () => {
      expect((await createSub({ events: [] })).status).toBe(400);
      expect((await createSub({ events: ["nope"] })).status).toBe(400);
      expect((await createSub({ url: "ftp://example.com/x" })).status).toBe(400);
      expect((await createSub({ url: "https://user:pw@example.com/x" })).status).toBe(400);
      expect((await createSub({ url: "http://169.254.169.254/latest/meta-data" })).status).toBe(
        400
      );
      expect((await createSub({ secret: "short" })).status).toBe(400);
    });

    it("updates, rotates the secret and re-validates the URL", async () => {
      const { body } = await createSub();
      const patched = await request(app)
        .patch(`/api/webhooks/${body.id}`)
        .send({ enabled: false, events: ["download.failed", "download.failed"] });
      expect(patched.status).toBe(200);
      expect(patched.body.enabled).toBe(false);
      expect(patched.body.events).toEqual(["download.failed"]);
      expect(patched.body).not.toHaveProperty("secret");

      const rotated = await request(app)
        .patch(`/api/webhooks/${body.id}`)
        .send({ rotateSecret: true });
      expect(rotated.body.secret).toMatch(/^whsec_/);
      expect(rotated.body.secret).not.toBe(body.secret);

      const bad = await request(app)
        .patch(`/api/webhooks/${body.id}`)
        .send({ url: "http://169.254.169.254/" });
      expect(bad.status).toBe(400);
    });

    it("scopes subscriptions to their owner", async () => {
      const { body } = await createSub();
      currentUser = otherUserId;
      expect((await request(app).get("/api/webhooks")).body.subscriptions).toHaveLength(0);
      expect((await request(app).delete(`/api/webhooks/${body.id}`)).status).toBe(404);
      expect((await request(app).post(`/api/webhooks/${body.id}/test`)).status).toBe(404);
      expect((await request(app).get(`/api/webhooks/${body.id}/deliveries`)).status).toBe(404);
    });

    it("deletes a subscription together with its delivery log", async () => {
      const { body } = await createSub();
      safeFetchMock.mockResolvedValue(okResponse());
      await request(app).post(`/api/webhooks/${body.id}/test`);
      expect(await db.storage.getWebhookDeliveries(body.id, 10)).toHaveLength(1);
      expect((await request(app).delete(`/api/webhooks/${body.id}`)).status).toBe(204);
      expect(await db.storage.getWebhookDeliveries(body.id, 10)).toHaveLength(0);
    });

    it("sends a signed test event once and reports the outcome", async () => {
      const { body } = await createSub();
      safeFetchMock.mockResolvedValueOnce(okResponse());
      const ok = await request(app).post(`/api/webhooks/${body.id}/test`);
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);

      const [url, init] = safeFetchMock.mock.calls[0] as [
        string,
        RequestInit & { allowPrivate: boolean },
      ];
      expect(url).toBe("https://hooks.example.com/questarr");
      expect(init.redirect).toBe("manual");
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Questarr-Event"]).toBe("webhook.test");
      expect(headers["X-Questarr-Signature"]).toBe(
        webhooks.signWebhookBody(body.secret, headers["X-Questarr-Timestamp"]!, init.body as string)
      );
      expect(JSON.parse(init.body as string).type).toBe("webhook.test");

      safeFetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
      const failed = await request(app).post(`/api/webhooks/${body.id}/test`);
      expect(failed.status).toBe(502);
      expect(failed.body.error).toBe("HTTP 500");
      expect(safeFetchMock).toHaveBeenCalledTimes(2); // a test never retries

      const log = await request(app).get(`/api/webhooks/${body.id}/deliveries`);
      expect(log.body).toHaveLength(2);
      expect(log.body[0].statusCode).toBe(500);
    });
  });

  describe("delivery", () => {
    const noWait = async () => undefined;

    it("retries transient failures with a growing attempt number, then stops", async () => {
      const { body } = await createSub();
      const sub = (await db.storage.getWebhookSubscription(body.id, userId))!;
      safeFetchMock
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce(okResponse());
      const result = await webhooks.deliverWebhook(
        sub,
        webhooks.buildWebhookEnvelope("download.completed", { gameTitle: "X" }),
        { sleepFn: noWait }
      );
      expect(result).toMatchObject({ ok: true, attempt: 3 });
      const rows = await db.storage.getWebhookDeliveries(sub.id, 10);
      expect(rows.map((r) => r.attempt).sort()).toEqual([1, 2, 3]);
      expect(new Set(rows.map((r) => r.eventId)).size).toBe(1);
    });

    it("does not retry a permanent client error", async () => {
      const { body } = await createSub();
      const sub = (await db.storage.getWebhookSubscription(body.id, userId))!;
      safeFetchMock.mockResolvedValue(new Response("", { status: 404 }));
      const result = await webhooks.deliverWebhook(
        sub,
        webhooks.buildWebhookEnvelope("download.failed", {}),
        { sleepFn: noWait }
      );
      expect(result).toMatchObject({ ok: false, statusCode: 404, attempt: 1 });
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    });

    it("emits only to enabled subscriptions of the owner that listen for the event", async () => {
      const listening = (await createSub({ events: ["game.released"] })).body;
      await createSub({ name: "other event", events: ["download.failed"] });
      await createSub({ name: "off", events: ["game.released"], enabled: false });
      currentUser = otherUserId;
      await createSub({ name: "someone else", events: ["game.released"] });
      currentUser = userId;

      safeFetchMock.mockResolvedValue(okResponse());
      webhooks.emitWebhookEvent("game.released", { gameTitle: "Y" }, userId);
      await vi.waitFor(() => expect(safeFetchMock).toHaveBeenCalledTimes(1));
      await vi.waitFor(async () =>
        expect(await db.storage.getWebhookDeliveries(listening.id, 10)).toHaveLength(1)
      );
    });

    it("trims each subscription's log to the newest attempts", async () => {
      const { body } = await createSub();
      for (let i = 0; i < 5; i++) {
        await db.storage.addWebhookDelivery({
          subscriptionId: body.id,
          eventId: `e${i}`,
          eventType: "download.completed",
          attempt: 1,
          statusCode: 200,
          error: null,
          durationMs: 1,
        });
        await new Promise((r) => setTimeout(r, 3));
      }
      expect(await db.storage.pruneWebhookDeliveries(2)).toBe(3);
      const left = await db.storage.getWebhookDeliveries(body.id, 10);
      expect(left.map((r) => r.eventId)).toEqual(["e4", "e3"]);
    });
  });
});
