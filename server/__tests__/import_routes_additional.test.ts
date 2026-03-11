import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockStorage, mockImportManager, mockPlatformMappingService, isSafeUrlMock } = vi.hoisted(
  () => ({
    mockStorage: {
      getImportConfig: vi.fn(),
      getDownloadingGameDownloads: vi.fn(),
      getGame: vi.fn(),
      getPlatformMappings: vi.fn(),
      getPathMappings: vi.fn(),
      removePathMapping: vi.fn(),
      getUserSettings: vi.fn(),
      updateUserSettings: vi.fn(),
      getRomMConfig: vi.fn(),
    },
    mockImportManager: {
      confirmImport: vi.fn(),
    },
    mockPlatformMappingService: {
      initializeDefaults: vi.fn(),
    },
    isSafeUrlMock: vi.fn(),
  })
);

vi.mock("../storage.js", () => ({
  storage: mockStorage,
}));

vi.mock("../services/index.js", () => ({
  importManager: mockImportManager,
  platformMappingService: mockPlatformMappingService,
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: isSafeUrlMock,
}));

import { importRouter } from "../routes/import.js";

describe("importRouter additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getImportConfig.mockResolvedValue({
      libraryRoot: "/data",
      enablePostProcessing: true,
      autoUnpack: false,
      renamePattern: "{Title}",
      overwriteExisting: true,
      transferMode: "move",
      importPlatformIds: [],
      ignoredExtensions: [],
      minFileSize: 0,
      integrationProvider: "romm",
      integrationLibraryRoot: "/data/romm",
      integrationTransferMode: "hardlink",
      integrationPlatformIds: [],
    });
  });

  function createApp(withUser = true) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (withUser) {
        (req as express.Request & { user?: { id: string } }).user = { id: "user-1" };
      }
      next();
    });
    app.use("/api/imports", importRouter);
    return app;
  }

  it("returns unauthorized for GET /config without user", async () => {
    const app = createApp(false);
    const response = await request(app).get("/api/imports/config");

    expect(response.status).toBe(401);
  });

  it("returns pending manual-review imports with game title fallback", async () => {
    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "d1",
        gameId: "g1",
        downloadTitle: "Download 1",
        status: "manual_review_required",
        downloaderId: "down-1",
        addedAt: "2026-01-01",
      },
      {
        id: "d2",
        gameId: "g2",
        downloadTitle: "Download 2",
        status: "downloading",
        downloaderId: "down-1",
        addedAt: "2026-01-02",
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
      { id: "m1", igdbPlatformId: 19, rommPlatformName: "snes" },
    ]);
    const app = createApp();

    const response = await request(app).post("/api/imports/mappings/platforms/init").send({});

    expect(response.status).toBe(200);
    expect(mockPlatformMappingService.initializeDefaults).toHaveBeenCalled();
    expect(response.body.count).toBe(1);
  });

  it("rejects unsafe RomM URL in PATCH /romm", async () => {
    isSafeUrlMock.mockResolvedValue(false);
    const app = createApp();

    const response = await request(app).patch("/api/imports/romm").send({
      enabled: true,
      url: "http://169.254.169.254/latest/meta-data/",
      apiKey: "k",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsafe/i);
  });

  it("returns 400 for invalid /config patch payload", async () => {
    const app = createApp();

    const response = await request(app).patch("/api/imports/config").send({
      invalidField: true,
    });

    expect(response.status).toBe(400);
  });

  it("updates import config using authenticated userId", async () => {
    mockStorage.getUserSettings.mockResolvedValue({
      id: "settings-1",
      userId: "user-1",
      rommEnabled: false,
      rommUrl: null,
      rommApiKey: null,
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

  it("updates romm config using authenticated userId", async () => {
    mockStorage.getUserSettings.mockResolvedValue({
      id: "settings-1",
      userId: "user-1",
      rommEnabled: false,
      rommUrl: null,
      rommApiKey: null,
    });
    mockStorage.updateUserSettings.mockResolvedValue({ id: "settings-1", userId: "user-1" });
    isSafeUrlMock.mockResolvedValue(true);

    const app = createApp();
    const response = await request(app).patch("/api/imports/romm").send({
      enabled: true,
      url: "http://localhost:8080",
      apiKey: "test-key",
    });

    expect(response.status).toBe(200);
    expect(mockStorage.updateUserSettings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        rommEnabled: true,
        rommUrl: "http://localhost:8080",
        rommApiKey: "test-key",
      })
    );
  });
});
