import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(async (key: string) => store.get(key)),
    setSystemConfig: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

import { setupWizardRouter } from "../routes/setup-wizard.js";

const app = express();
app.use(express.json());
app.use("/api/system/setup-wizard", setupWizardRouter);

describe("setup wizard state routes", () => {
  beforeEach(() => store.clear());

  it("reports `never` for an install that predates the wizard", async () => {
    const res = await request(app).get("/api/system/setup-wizard");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "never" });
  });

  it("stores and returns `done`, and can be reset to `pending`", async () => {
    await request(app).put("/api/system/setup-wizard").send({ state: "done" }).expect(200);
    expect((await request(app).get("/api/system/setup-wizard")).body.state).toBe("done");
    await request(app).put("/api/system/setup-wizard").send({ state: "pending" }).expect(200);
    expect((await request(app).get("/api/system/setup-wizard")).body.state).toBe("pending");
  });

  it("rejects an unknown state", async () => {
    const res = await request(app).put("/api/system/setup-wizard").send({ state: "never" });
    expect(res.status).toBe(400);
  });
});
