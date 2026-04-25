import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { mockStorage, mockImportManager, mockPlatformMappingService, fsMock } = vi.hoisted(() => ({
  mockStorage: {
    getImportConfig: vi.fn(),
    getEnabledDownloaders: vi.fn(),
    getPendingImportReviews: vi.fn(),
    getGame: vi.fn(),
    getPlatformMappings: vi.fn(),
    getPathMappings: vi.fn(),
    removePathMapping: vi.fn(),
    getUserSettings: vi.fn(),
    updateUserSettings: vi.fn(),
  },
  mockImportManager: {
    confirmImport: vi.fn(),
  },
  mockPlatformMappingService: {
    initializeDefaults: vi.fn(),
  },
  fsMock: {
    stat: vi.fn(),
    writeFile: vi.fn(),
    link: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({
  storage: mockStorage,
}));

vi.mock("../services/index.js", () => ({
  importManager: mockImportManager,
  platformMappingService: mockPlatformMappingService,
}));

vi.mock("fs-extra", () => ({
  default: fsMock,
}));

import { importRouter } from "../routes/import.js";
import { makeImportConfig, createImportTestApp } from "./helpers/import-test-helpers.js";

describe("importRouter additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getEnabledDownloaders.mockResolvedValue([]);
    mockStorage.getImportConfig.mockResolvedValue(makeImportConfig({ overwriteExisting: true }));
    mockStorage.getPathMappings.mockResolvedValue([]);
  });

  const createApp = (withUser = true) => createImportTestApp(importRouter, withUser);

  it("returns unauthorized for GET /config without user", async () => {
    const app = createApp(false);
    const response = await request(app).get("/api/imports/config");

    expect(response.status).toBe(401);
  });

  it("returns pending manual-review imports with game title fallback", async () => {
    mockStorage.getPendingImportReviews.mockResolvedValue([
      {
        id: "d1",
        gameId: "g1",
        downloadTitle: "Download 1",
        status: "manual_review_required",
        downloaderId: "down-1",
        addedAt: "2026-01-01",
      },
    ]);
    mockStorage.getGame.mockResolvedValueOnce({ title: "Known Game" });

    const app = createApp();
    const response = await request(app).get("/api/imports/pending");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "d1",
        gameTitle: "Known Game",
        status: "manual_review_required",
      }),
    ]);
  });

  it("initializes platform mappings via /mappings/platforms/init", async () => {
    mockStorage.getPlatformMappings.mockResolvedValue([
      { id: "m1", igdbPlatformId: 19, sourcePlatformName: "snes" },
    ]);
    const app = createApp();

    const response = await request(app).post("/api/imports/mappings/platforms/init").send({});

    expect(response.status).toBe(200);
    expect(mockPlatformMappingService.initializeDefaults).toHaveBeenCalled();
    expect(response.body.count).toBe(1);
  });

  it("returns 400 for invalid /config patch payload", async () => {
    const app = createApp();

    const response = await request(app).patch("/api/imports/config").send({
      invalidField: true,
    });

    expect(response.status).toBe(400);
  });

  it("returns neutral hardlink check when no downloader paths are configured", async () => {
    const app = createApp();

    const response = await request(app).get("/api/imports/hardlink/check");

    expect(response.status).toBe(200);
    expect(response.body.generic.supportedForAll).toBeNull();
  });

  it("updates import config using authenticated userId", async () => {
    mockStorage.getUserSettings.mockResolvedValue({
      id: "settings-1",
      userId: "user-1",
    });
    mockStorage.updateUserSettings.mockResolvedValue({ id: "settings-1", userId: "user-1" });

    const app = createApp();
    const response = await request(app).patch("/api/imports/config").send({
      renamePattern: "{Title} - {Platform}",
    });

    expect(response.status).toBe(200);
    expect(mockStorage.updateUserSettings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ renamePattern: "{Title} - {Platform}" })
    );
  });

  // --- GET /api/imports/config happy path ---

  it("GET /config returns the import config for the user", async () => {
    const config = makeImportConfig({
      overwriteExisting: false,
      renamePattern: "{Title} ({Year})",
    });
    mockStorage.getImportConfig.mockResolvedValue(config);

    const app = createApp();
    const response = await request(app).get("/api/imports/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ renamePattern: "{Title} ({Year})" }));
    expect(mockStorage.getImportConfig).toHaveBeenCalledWith("user-1");
  });

  // --- POST /:id/confirm — path traversal and Windows absolute path ---

  it("POST /:id/confirm returns 400 for path traversal in proposedPath", async () => {
    mockStorage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/data" }));

    const app = createApp();
    const response = await request(app).post("/api/imports/dl-1/confirm").send({
      strategy: "pc",
      proposedPath: "../../etc/passwd",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/invalid proposed path/i);
  });

  it("POST /:id/confirm returns 400 for Windows absolute path in proposedPath", async () => {
    mockStorage.getImportConfig.mockResolvedValue(makeImportConfig({ libraryRoot: "/data" }));

    const app = createApp();
    const response = await request(app).post("/api/imports/dl-2/confirm").send({
      strategy: "pc",
      proposedPath: "C:/games",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/invalid proposed path/i);
  });

  // --- GET /api/imports/pending — empty array ---

  it("GET /pending returns count 0 and empty items when storage returns empty array", async () => {
    mockStorage.getPendingImportReviews.mockResolvedValue([]);

    const app = createApp();
    const response = await request(app).get("/api/imports/pending");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  // --- GET /api/imports/hardlink/check ---

  it("GET /hardlink/check returns 200 with sameDevice:true when paths are on the same device", async () => {
    mockStorage.getEnabledDownloaders.mockResolvedValue([
      { id: "dl-1", downloadPath: "/downloads", url: "http://localhost:8080" },
    ]);
    mockStorage.getPathMappings.mockResolvedValue([]);

    const sharedStat = { dev: 42, isDirectory: () => true };
    fsMock.stat.mockResolvedValue(sharedStat);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.link.mockResolvedValue(undefined);
    fsMock.remove.mockResolvedValue(undefined);

    const app = createApp();
    const response = await request(app).get("/api/imports/hardlink/check");

    expect(response.status).toBe(200);
    expect(response.body.generic.supportedForAll).toBe(true);
    expect(response.body.generic.checkedSources).toHaveLength(1);
    expect(response.body.generic.checkedSources[0].sameDevice).toBe(true);
  });

  it("GET /hardlink/check returns sameDevice:false when paths are on different devices", async () => {
    mockStorage.getEnabledDownloaders.mockResolvedValue([
      { id: "dl-1", downloadPath: "/downloads", url: "http://localhost:8080" },
    ]);
    mockStorage.getPathMappings.mockResolvedValue([]);

    fsMock.stat.mockImplementation((p: string) => {
      if (p.endsWith("downloads") || p.includes("downloads")) {
        return Promise.resolve({ dev: 1, isDirectory: () => true });
      }
      return Promise.resolve({ dev: 2, isDirectory: () => true });
    });

    const app = createApp();
    const response = await request(app).get("/api/imports/hardlink/check");

    expect(response.status).toBe(200);
    expect(response.body.generic.supportedForAll).toBe(false);
    expect(response.body.generic.checkedSources[0].sameDevice).toBe(false);
    expect(response.body.generic.checkedSources[0].reason).toMatch(/different filesystems/i);
  });

  it("GET /hardlink/check returns 500 when getEnabledDownloaders rejects", async () => {
    mockStorage.getEnabledDownloaders.mockRejectedValue(new Error("db failure"));

    const app = createApp();
    const response = await request(app).get("/api/imports/hardlink/check");

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/hardlink/i);
  });
});
