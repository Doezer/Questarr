import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockStorage, mockImportManager } = vi.hoisted(() => ({
  mockStorage: {
    getImportConfig: vi.fn(),
  },
  mockImportManager: {
    confirmImport: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({
  storage: mockStorage,
}));

vi.mock("../services/index.js", () => ({
  importManager: mockImportManager,
  platformMappingService: {
    initializeDefaults: vi.fn(),
  },
}));

import { importRouter } from "../routes/import.js";

describe("importRouter confirmImport security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getImportConfig.mockResolvedValue({
      libraryRoot: "/data",
      enablePostProcessing: true,
      autoUnpack: false,
      renamePattern: "{Title} ({Region})",
      overwriteExisting: false,
      deleteSource: true,
      ignoredExtensions: [],
      minFileSize: 0,
    });
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { user?: { id: string } }).user = { id: "user-1" };
      next();
    });
    app.use("/api/imports", importRouter);
    return app;
  }

  it("rejects path traversal in proposedPath", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-1/confirm").send({
      strategy: "pc",
      proposedPath: "../../etc/passwd",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid proposed path");
    expect(mockImportManager.confirmImport).not.toHaveBeenCalled();
  });

  it("accepts in-root absolute path", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-2/confirm").send({
      strategy: "romm",
      proposedPath: "/data/roms/game.rom",
      deleteSource: false,
    });

    expect(response.status).toBe(200);
    expect(mockImportManager.confirmImport).toHaveBeenCalledWith(
      "dl-2",
      expect.objectContaining({
        strategy: "romm",
        proposedPath: expect.stringMatching(/roms[\\/]game\.rom$/),
      })
    );
  });
});
