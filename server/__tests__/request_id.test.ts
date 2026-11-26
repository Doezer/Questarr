import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

describe("request id", () => {
  it("tags every response with a short correlation id, different per request", async () => {
    const app = createApp();
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));

    const first = await request(app).get("/api/ping");
    const second = await request(app).get("/api/ping");

    expect(first.headers["x-request-id"]).toMatch(/^[0-9a-f]{8}$/);
    expect(second.headers["x-request-id"]).toMatch(/^[0-9a-f]{8}$/);
    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
  });
});
