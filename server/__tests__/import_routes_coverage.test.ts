import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { mockStorage, mockImportManager, mockPlatformMappingService, fsMock } = vi.hoisted(() => ({
  mockStorage: {
    getImportConfig: vi.fn(),
    getEnabledDownloaders: vi.fn(),
    getPendingImportReviews: vi.fn(),
    getGame: vi.fn(),
    getPlatformMappings: vi.fn(),
    addPlatformMapping: vi.fn(),
    removePlatformMapping: vi.fn(),
    getPathMappings: vi.fn(),
    addPathMapping: vi.fn(),
    updatePathMapping: vi.fn(),
    removePathMapping: vi.fn(),
    getUserSettings: vi.fn(),
    updateUserSettings: vi.fn(),
    createUserSettings: vi.fn(),
    getGameDownload: vi.fn(),
    updateGameDownloadStatus: vi.fn(),
  },
  mockImportManager: {
    confirmImport: vi.fn(),
    planConfirmImport: vi.fn(),
  },
  mockPlatformMappingService: {
    initializeDefaults: vi.fn(),
    updateMapping: vi.fn(),
  },
  fsMock: {
    stat: vi.fn(),
    writeFile: vi.fn(),
    link: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({ storage: mockStorage }));
vi.mock("../services/index.js", () => ({
  importManager: mockImportManager,
  platformMappingService: mockPlatformMappingService,
}));
vi.mock("fs-extra", () => ({ default: fsMock }));

import { importRouter } from "../routes/import.js";
import { makeImportConfig, createImportTestApp } from "./helpers/import-test-helpers.js";

const createApp = (withUser = true) => createImportTestApp(importRouter, withUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getImportConfig.mockResolvedValue(makeImportConfig({ overwriteExisting: true }));
  mockStorage.getPathMappings.mockResolvedValue([]);
  mockStorage.getEnabledDownloaders.mockResolvedValue([]);
  mockImportManager.confirmImport.mockResolvedValue(undefined);
  mockImportManager.planConfirmImport.mockResolvedValue({
    originalPath: "/local/game.iso",
    proposedPath: "/data/PC/My Game",
  });
});

// ─── Platform mapping CRUD ────────────────────────────────────────────────────

describe("GET /api/imports/mappings/platforms", () => {
  it("returns all platform mappings", async () => {
    mockStorage.getPlatformMappings.mockResolvedValue([
      { id: "pm-1", igdbPlatformId: 6, sourcePlatformName: "pc" },
    ]);

    const res = await request(createApp()).get("/api/imports/mappings/platforms");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "pm-1", igdbPlatformId: 6, sourcePlatformName: "pc" }]);
  });

  it("returns 500 on storage error", async () => {
    mockStorage.getPlatformMappings.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).get("/api/imports/mappings/platforms");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/fetch platform mappings/i);
  });
});

describe("POST /api/imports/mappings/platforms", () => {
  it("creates a platform mapping", async () => {
    mockStorage.addPlatformMapping.mockResolvedValue({
      id: "pm-2",
      igdbPlatformId: 19,
      sourcePlatformName: "snes",
    });

    const res = await request(createApp()).post("/api/imports/mappings/platforms").send({
      igdbPlatformId: 19,
      sourcePlatformName: "snes",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ igdbPlatformId: 19, sourcePlatformName: "snes" });
    expect(mockStorage.addPlatformMapping).toHaveBeenCalled();
  });

  it("returns 400 for invalid schema (missing igdbPlatformId)", async () => {
    const res = await request(createApp()).post("/api/imports/mappings/platforms").send({
      sourcePlatformName: "snes",
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 on storage error", async () => {
    mockStorage.addPlatformMapping.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).post("/api/imports/mappings/platforms").send({
      igdbPlatformId: 19,
      sourcePlatformName: "snes",
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/create platform mapping/i);
  });
});

describe("PATCH /api/imports/mappings/platforms/:id", () => {
  it("updates a platform mapping", async () => {
    mockPlatformMappingService.updateMapping.mockResolvedValue({
      id: "pm-1",
      igdbPlatformId: 6,
      sourcePlatformName: "win",
    });

    const res = await request(createApp())
      .patch("/api/imports/mappings/platforms/pm-1")
      .send({ sourcePlatformName: "win" });

    expect(res.status).toBe(200);
    expect(res.body.sourcePlatformName).toBe("win");
  });

  it("returns 404 when mapping not found", async () => {
    mockPlatformMappingService.updateMapping.mockResolvedValue(undefined);

    const res = await request(createApp())
      .patch("/api/imports/mappings/platforms/missing")
      .send({ sourcePlatformName: "win" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid schema", async () => {
    const res = await request(createApp())
      .patch("/api/imports/mappings/platforms/pm-1")
      .send({ unknownField: true });

    expect(res.status).toBe(400);
  });

  it("returns 500 on service error", async () => {
    mockPlatformMappingService.updateMapping.mockRejectedValue(new Error("db error"));

    const res = await request(createApp())
      .patch("/api/imports/mappings/platforms/pm-1")
      .send({ sourcePlatformName: "win" });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/update platform mapping/i);
  });
});

describe("DELETE /api/imports/mappings/platforms/:id", () => {
  it("deletes a platform mapping", async () => {
    mockStorage.removePlatformMapping.mockResolvedValue(true);

    const res = await request(createApp()).delete("/api/imports/mappings/platforms/pm-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 when mapping not found", async () => {
    mockStorage.removePlatformMapping.mockResolvedValue(false);

    const res = await request(createApp()).delete("/api/imports/mappings/platforms/missing");

    expect(res.status).toBe(404);
  });

  it("returns 500 on storage error", async () => {
    mockStorage.removePlatformMapping.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).delete("/api/imports/mappings/platforms/pm-1");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/delete platform mapping/i);
  });
});

// ─── Path mapping CRUD ────────────────────────────────────────────────────────

describe("GET /api/imports/mappings/paths", () => {
  it("returns all path mappings", async () => {
    mockStorage.getPathMappings.mockResolvedValue([
      { id: "pm-1", remotePath: "/downloads", localPath: "/mnt/downloads", remoteHost: null },
    ]);

    const res = await request(createApp()).get("/api/imports/mappings/paths");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 500 on storage error", async () => {
    mockStorage.getPathMappings.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).get("/api/imports/mappings/paths");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/fetch path mappings/i);
  });
});

describe("POST /api/imports/mappings/paths", () => {
  it("creates a path mapping", async () => {
    mockStorage.addPathMapping.mockResolvedValue({
      id: "pm-new",
      remotePath: "/downloads",
      localPath: "/mnt/downloads",
      remoteHost: null,
    });

    const res = await request(createApp()).post("/api/imports/mappings/paths").send({
      remotePath: "/downloads",
      localPath: "/mnt/downloads",
    });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("pm-new");
    expect(mockStorage.addPathMapping).toHaveBeenCalled();
  });

  it("returns 400 for invalid schema", async () => {
    const res = await request(createApp()).post("/api/imports/mappings/paths").send({
      invalidField: true,
    });

    expect(res.status).toBe(400);
  });

  it("returns 500 on storage error", async () => {
    mockStorage.addPathMapping.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).post("/api/imports/mappings/paths").send({
      remotePath: "/downloads",
      localPath: "/mnt/downloads",
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/create path mapping/i);
  });
});

describe("DELETE /api/imports/mappings/paths/:id", () => {
  it("deletes a path mapping", async () => {
    mockStorage.removePathMapping.mockResolvedValue(true);

    const res = await request(createApp()).delete("/api/imports/mappings/paths/pm-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 when mapping not found", async () => {
    mockStorage.removePathMapping.mockResolvedValue(false);

    const res = await request(createApp()).delete("/api/imports/mappings/paths/missing");

    expect(res.status).toBe(404);
  });

  it("returns 500 on storage error", async () => {
    mockStorage.removePathMapping.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).delete("/api/imports/mappings/paths/pm-1");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/delete path mapping/i);
  });
});

// ─── PATCH /config — createUserSettings branch ───────────────────────────────

describe("PATCH /api/imports/config — createUserSettings branch", () => {
  it("calls createUserSettings when no existing settings found", async () => {
    mockStorage.getUserSettings.mockResolvedValue(undefined);
    mockStorage.createUserSettings.mockResolvedValue({ id: "s-1", userId: "user-1" });

    const res = await request(createApp())
      .patch("/api/imports/config")
      .send({ renamePattern: "{Title}" });

    expect(res.status).toBe(200);
    expect(mockStorage.createUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", renamePattern: "{Title}" })
    );
    expect(mockStorage.updateUserSettings).not.toHaveBeenCalled();
  });
});

// ─── GET /:id/plan ────────────────────────────────────────────────────────────

describe("GET /api/imports/:id/plan", () => {
  it("returns the import plan for a download", async () => {
    mockImportManager.planConfirmImport.mockResolvedValue({
      originalPath: "/local/downloads/game.iso",
      proposedPath: "/data/PC/My Game",
    });

    const res = await request(createApp()).get("/api/imports/dl-1/plan");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      originalPath: "/local/downloads/game.iso",
      proposedPath: "/data/PC/My Game",
    });
    expect(mockImportManager.planConfirmImport).toHaveBeenCalledWith("dl-1", undefined, "user-1");
  });

  it("passes sourcePath query param to planConfirmImport", async () => {
    const res = await request(createApp()).get("/api/imports/dl-2/plan?sourcePath=/custom/source");

    expect(res.status).toBe(200);
    expect(mockImportManager.planConfirmImport).toHaveBeenCalledWith(
      "dl-2",
      "/custom/source",
      "user-1"
    );
  });

  it("returns 404 when download not found", async () => {
    mockImportManager.planConfirmImport.mockRejectedValue(new Error("Download dl-x not found"));

    const res = await request(createApp()).get("/api/imports/dl-x/plan");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 500 on unexpected error", async () => {
    mockImportManager.planConfirmImport.mockRejectedValue(new Error("unexpected failure"));

    const res = await request(createApp()).get("/api/imports/dl-err/plan");

    expect(res.status).toBe(500);
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

describe("DELETE /api/imports/:id", () => {
  it("marks the download as completed (skip import)", async () => {
    mockStorage.getGameDownload.mockResolvedValue({ id: "dl-1", gameId: "g1" });

    const res = await request(createApp()).delete("/api/imports/dl-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockStorage.updateGameDownloadStatus).toHaveBeenCalledWith("dl-1", "completed");
  });

  it("returns 404 when download not found", async () => {
    mockStorage.getGameDownload.mockResolvedValue(undefined);

    const res = await request(createApp()).delete("/api/imports/dl-missing");

    expect(res.status).toBe(404);
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalled();
  });

  it("returns 500 on storage error", async () => {
    mockStorage.getGameDownload.mockRejectedValue(new Error("db failure"));

    const res = await request(createApp()).delete("/api/imports/dl-err");

    expect(res.status).toBe(500);
  });
});

// ─── POST /:id/confirm — additional coverage ──────────────────────────────────

describe("POST /api/imports/:id/confirm — Source path error", () => {
  it("returns 400 when source path cannot be resolved", async () => {
    mockImportManager.confirmImport.mockRejectedValue(
      new Error(
        "Source path could not be resolved — the download may no longer be tracked by the download client. Please specify the source path manually."
      )
    );

    const res = await request(createApp()).post("/api/imports/dl-1/confirm").send({
      strategy: "pc",
      proposedPath: "/data/PC/game",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source path could not be resolved/i);
  });

  it("returns 404 when download not found during confirm", async () => {
    mockImportManager.confirmImport.mockRejectedValue(new Error("Download dl-x not found"));

    const res = await request(createApp()).post("/api/imports/dl-x/confirm").send({
      strategy: "pc",
      proposedPath: "/data/PC/game",
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 500 on unexpected confirm error", async () => {
    mockImportManager.confirmImport.mockRejectedValue(new Error("Something exploded"));

    const res = await request(createApp()).post("/api/imports/dl-err/confirm").send({
      strategy: "pc",
      proposedPath: "/data/PC/game",
    });

    expect(res.status).toBe(500);
  });
});
