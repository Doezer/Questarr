import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../backup/backup-service.js", () => ({
  createBackup: vi.fn().mockResolvedValue({ name: "n" }),
  deleteBackup: vi.fn(),
  getBackupSettings: vi
    .fn()
    .mockResolvedValue({ intervalDays: 7, retentionDays: 28, includeScreenshots: false }),
  getBackupState: vi.fn().mockReturnValue({ running: false, lastError: null }),
  getKeySources: vi.fn().mockReturnValue({ encryptionKeySource: "db", jwtSecretSource: "db" }),
  listBackups: vi.fn().mockResolvedValue([]),
  resolveBackupPath: vi.fn(),
  saveBackupSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../backup/restore-boot.js", () => ({
  readRestoreResult: () => null,
  clearRestoreResult: vi.fn(),
}));
vi.mock("../backup/restore.js", () => {
  class RestoreError extends Error {}
  return { RestoreError, stageRestore: vi.fn() };
});
vi.mock("../db.js", () => ({ dialect: "sqlite" }));
vi.mock("../socket.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../middleware.js", () => ({
  sensitiveEndpointLimiter: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, routesLogger: l };
});

import * as svc from "../backup/backup-service.js";
import { RestoreError, stageRestore } from "../backup/restore.js";
import { backupsRouter } from "../routes/backups.js";

function makeApp(authenticated = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authenticated) req.user = { id: "u1" } as never;
    next();
  });
  app.use("/api/system/backups", backupsRouter);
  return app;
}

describe("backups routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Never let the restore route schedule a real process.exit.
    vi.stubEnv("QUESTARR_RESTORE_RESTART", "false");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires authentication", async () => {
    await request(makeApp(false)).get("/api/system/backups").expect(401);
    await request(makeApp(false)).post("/api/system/backups").expect(401);
  });

  it("lists backups with settings, never cacheable", async () => {
    const res = await request(makeApp()).get("/api/system/backups").expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.settings.intervalDays).toBe(7);
    expect(res.body.environment).toMatchObject({ dialect: "sqlite", encryptionKeySource: "db" });
  });

  it("starts a backup in the background, and refuses a second one", async () => {
    await request(makeApp()).post("/api/system/backups").expect(202);
    expect(svc.createBackup).toHaveBeenCalledWith("manual");
    vi.mocked(svc.getBackupState).mockReturnValueOnce({ running: true, lastError: null });
    await request(makeApp()).post("/api/system/backups").expect(409);
  });

  it("validates settings", async () => {
    const app = makeApp();
    await request(app).put("/api/system/backups/settings").send({ intervalDays: -1 }).expect(400);
    await request(app)
      .put("/api/system/backups/settings")
      .send({ intervalDays: 1, retentionDays: 0, includeScreenshots: false })
      .expect(400);
    await request(app)
      .put("/api/system/backups/settings")
      .send({ intervalDays: 1, retentionDays: 5, includeScreenshots: true })
      .expect(200);
    expect(svc.saveBackupSettings).toHaveBeenCalledOnce();
  });

  it("answers 404 for names that do not resolve, without touching disk", async () => {
    vi.mocked(svc.resolveBackupPath).mockReturnValue(null);
    const app = makeApp();
    await request(app).get("/api/system/backups/..%2F..%2Fetc%2Fpasswd/download").expect(404);
    await request(app).delete("/api/system/backups/nope.zip").expect(404);
    await request(app)
      .post("/api/system/backups/nope.zip/restore")
      .send({ confirm: true })
      .expect(404);
  });

  it("requires explicit confirmation to restore a stored backup", async () => {
    vi.mocked(svc.resolveBackupPath).mockReturnValue(__filename);
    await request(makeApp()).post("/api/system/backups/x.zip/restore").send({}).expect(400);
    expect(stageRestore).not.toHaveBeenCalled();
  });

  it("stages a restore and reports archive problems as 400", async () => {
    vi.mocked(svc.resolveBackupPath).mockReturnValue(__filename);
    vi.mocked(stageRestore).mockResolvedValueOnce({ appVersion: "1.6.0" } as never);
    const ok = await request(makeApp())
      .post("/api/system/backups/x.zip/restore")
      .send({ confirm: true })
      .expect(202);
    expect(ok.body).toMatchObject({ staged: true, appVersion: "1.6.0" });

    vi.mocked(stageRestore).mockRejectedValueOnce(new RestoreError("too new"));
    const bad = await request(makeApp())
      .post("/api/system/backups/x.zip/restore")
      .send({ confirm: true })
      .expect(400);
    expect(bad.body.error).toBe("too new");
  });

  it("rejects an upload that is not a zip", async () => {
    await request(makeApp())
      .post("/api/system/backups/restore")
      .attach("file", Buffer.from("x"), "backup.txt")
      .expect(400);
    expect(stageRestore).not.toHaveBeenCalled();
  });
});
