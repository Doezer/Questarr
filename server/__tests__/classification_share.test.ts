import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";

describe.each(activeTestDialects())("sharing verified labels on %s", (dialect) => {
  let ctx: TestDb;
  let app: express.Express;
  let live: { shareLabels: boolean };
  let share: typeof import("../classification/share.js");

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    const { classificationCandidatesRoutes } =
      await import("../classification-candidates-routes.js");
    share = await import("../classification/share.js");
    live = (await import("../config.js")).config.classification
      .activeLearning as unknown as typeof live;
    app = express();
    app.use(express.json());
    app.use(classificationCandidatesRoutes);
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  beforeEach(async () => {
    live.shareLabels = false;
    await ctx.storage.deleteClassificationCandidates();
    await ctx.storage.setSystemConfig("classification.shared", "[]");
    vi.restoreAllMocks();
  });

  /** Sends like the dialog does: previews first, then names the batch it saw. */
  async function send(batchId?: string) {
    const id =
      batchId ??
      (await request(app).get("/api/classification-candidates/share/preview")).body.batchId;
    return request(app).post("/api/classification-candidates/share").send({ batchId: id });
  }

  async function addCandidate(
    releaseName: string,
    over: { status?: string; humanLabel?: string | null; gameTitle?: string | null } = {}
  ) {
    await ctx.storage.upsertClassificationCandidate({
      id: crypto.randomUUID(),
      dedupeKey: `${releaseName}|${over.gameTitle ?? "g"}`,
      releaseName,
      gameTitle: over.gameTitle === undefined ? "Stellaris" : over.gameTitle,
      reasons: "[]",
      signals: "{}",
      status: over.status ?? "verified",
      humanLabel: over.humanLabel === undefined ? "dlc" : over.humanLabel,
    });
  }

  it("is off by default and previews only verified rows, with the four fields", async () => {
    await addCandidate("Stellaris Leviathans-GOG");
    await addCandidate("Stellaris Pending", { status: "pending", humanLabel: null });
    await addCandidate("Stellaris Ambiguous", { status: "ambiguous", humanLabel: null });
    await addCandidate("Stellaris NoGame", { gameTitle: null });
    const res = await request(app).get("/api/classification-candidates/share/preview");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.url).toBe(share.SHARE_URL);
    expect(res.body.skipped).toBe(1);
    expect(res.body.rows).toHaveLength(1);
    expect(Object.keys(res.body.rows[0]).sort()).toEqual(
      ["gameTitle", "label", "modelVersion", "releaseName"].sort()
    );
    expect(res.body.rows[0]).toMatchObject({
      releaseName: "Stellaris Leviathans-GOG",
      gameTitle: "Stellaris",
      label: "dlc",
    });
  });

  it("refuses to send while sharing is off and never calls the network", async () => {
    await addCandidate("Stellaris Leviathans-GOG");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await request(app)
      .post("/api/classification-candidates/share")
      .send({ batchId: "x" });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends one POST without following redirects, then does not repeat the same rows", async () => {
    live.shareLabels = true;
    await addCandidate("Stellaris Leviathans-GOG");
    await addCandidate("Stellaris Apocalypse-GOG");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 2 }), { status: 200 }));
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 2, remaining: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(share.SHARE_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body)) as { labels: Record<string, string>[] };
    expect(Object.keys(body)).toEqual(["labels"]);
    for (const row of body.labels) {
      expect(Object.keys(row).sort()).toEqual(
        ["gameTitle", "label", "modelVersion", "releaseName"].sort()
      );
    }

    // Nothing left to send, and the preview says why
    const again = await send("whatever");
    expect(again.status).toBe(409);
    const preview = await request(app).get("/api/classification-candidates/share/preview");
    expect(preview.body.rows).toHaveLength(0);
    expect(preview.body.alreadyShared).toBe(2);
  });

  it("keeps the rows to send again when the collector refuses or is unreachable", async () => {
    live.shareLabels = true;
    await addCandidate("Stellaris Leviathans-GOG");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("no", { status: 429 }))
      .mockRejectedValueOnce(new Error("offline"));
    expect((await send()).status).toBe(502);
    expect((await send()).status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const preview = await request(app).get("/api/classification-candidates/share/preview");
    expect(preview.body.rows).toHaveLength(1);
  });

  it("refuses a batch that changed since the preview and sends nothing", async () => {
    live.shareLabels = true;
    await addCandidate("Stellaris Leviathans-GOG");
    const previewed = (await request(app).get("/api/classification-candidates/share/preview")).body
      .batchId;
    await addCandidate("Stellaris Apocalypse-GOG");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await send(previewed);
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await request(app).post("/api/classification-candidates/share").send({})).status).toBe(
      400
    );
  });

  it("keeps the fingerprints of sent releases still in the queue", async () => {
    live.shareLabels = true;
    await addCandidate("Stellaris Leviathans-GOG");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await send()).status).toBe(200);
    const kept = JSON.parse((await ctx.storage.getSystemConfig("classification.shared")) ?? "[]");
    expect(kept).toHaveLength(1);
    await ctx.storage.deleteClassificationCandidates();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await addCandidate("Stellaris Apocalypse-GOG");
    expect((await send()).status).toBe(200);
    // The first release left the queue, so its fingerprint is dropped with it
    expect(
      JSON.parse((await ctx.storage.getSystemConfig("classification.shared")) ?? "[]")
    ).toHaveLength(1);
  });

  it("shares automatically only while the switch is on, and retries after a failure", async () => {
    await addCandidate("Stellaris Leviathans-GOG");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await share.autoShareVerifiedLabels();
    expect(fetchSpy).not.toHaveBeenCalled();
    live.shareLabels = true;
    await expect(share.autoShareVerifiedLabels()).rejects.toThrow(); // collector down: nothing is marked sent
    await share.autoShareVerifiedLabels(); // next run succeeds
    await share.autoShareVerifiedLabels(); // nothing left
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((await share.buildShareBatch()).rows).toHaveLength(0);
  });

  it("offers a corrected label again and tells apart the same release for two games", async () => {
    live.shareLabels = true;
    await addCandidate("Stellaris Leviathans-GOG");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await send()).status).toBe(200);
    const [row] = await ctx.storage.getClassificationCandidates({ status: "verified" });
    await ctx.storage.updateClassificationCandidate(row!.id, { humanLabel: "patch" });
    expect((await share.buildShareBatch()).rows.map((r) => r.label)).toEqual(["patch"]);
    await ctx.storage.deleteClassificationCandidates();
    await addCandidate("Same.Release-X", { gameTitle: "Game A" });
    expect((await send()).status).toBe(200);
    await addCandidate("Same.Release-X", { gameTitle: "Game B" });
    expect((await share.buildShareBatch()).rows.map((r) => r.gameTitle)).toEqual(["Game B"]);
  });

  it("sends once when two sends overlap", async () => {
    live.shareLabels = true;
    await addCandidate("Stellaris Leviathans-GOG");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    const { batchId } = await share.buildShareBatch();
    const results = await Promise.allSettled([
      share.sendShareBatch(batchId),
      share.sendShareBatch(batchId),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("caps a request and reports the rest", async () => {
    for (let i = 0; i < share.SHARE_MAX_ROWS + 3; i++) await addCandidate(`Stellaris Pack ${i}`);
    const batch = await share.buildShareBatch();
    expect(batch.rows).toHaveLength(share.SHARE_MAX_ROWS);
    expect(batch.remaining).toBe(3);
  });
});
