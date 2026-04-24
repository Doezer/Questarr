import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
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
import { makeImportConfig, createImportTestApp } from "./helpers/import-test-helpers.js";

describe("importRouter confirmImport security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getImportConfig.mockResolvedValue(
      makeImportConfig({ renamePattern: "{Title} ({Region})" })
    );
  });

  const createApp = () => createImportTestApp(importRouter);

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

  it("accepts in-root absolute path for pc strategy", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-2/confirm").send({
      strategy: "pc",
      proposedPath: "/data/PC/game",
      transferMode: "hardlink",
    });

    expect(response.status).toBe(200);
    expect(mockImportManager.confirmImport).toHaveBeenCalledWith(
      "dl-2",
      expect.objectContaining({
        strategy: "pc",
        proposedPath: expect.stringMatching(/PC[\\/]game$/),
      }),
      "user-1"
    );
  });

  // --- URL-encoded traversal ---

  it("rejects URL-encoded traversal sequence %2F..%2F in proposedPath", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-3/confirm").send({
      strategy: "pc",
      proposedPath: "%2F..%2Fetc%2Fpasswd",
    });

    if (response.status === 400) {
      expect(response.body.error).toMatch(/invalid proposed path/i);
      expect(mockImportManager.confirmImport).not.toHaveBeenCalled();
    } else {
      expect(response.status).toBe(200);
      const libraryRoot = path.resolve("/data");
      const called = mockImportManager.confirmImport.mock.calls[0];
      const resolvedPath: string = called[1].proposedPath;
      expect(resolvedPath === libraryRoot || resolvedPath.startsWith(libraryRoot + path.sep)).toBe(
        true
      );
      expect(resolvedPath).not.toMatch(/etc[/\\]passwd/);
    }
  });

  // --- Backslash traversal ---

  it("does not escape root via backslash separator traversal on non-Windows", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-4/confirm").send({
      strategy: "pc",
      proposedPath: "..\\..\\etc\\passwd",
    });

    if (response.status === 400) {
      expect(response.body.error).toMatch(/invalid proposed path/i);
      expect(mockImportManager.confirmImport).not.toHaveBeenCalled();
    } else {
      expect(response.status).toBe(200);
      const libraryRoot = path.resolve("/data");
      const called = mockImportManager.confirmImport.mock.calls[0];
      const resolvedPath: string = called[1].proposedPath;
      expect(resolvedPath === libraryRoot || resolvedPath.startsWith(libraryRoot + path.sep)).toBe(
        true
      );
    }
  });

  // --- Dot-dot traversal via absolute path ---

  it("rejects absolute proposedPath that traverses above the library root via ..", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-5/confirm").send({
      strategy: "pc",
      proposedPath: "/data/safe/../../../etc",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/invalid proposed path/i);
    expect(mockImportManager.confirmImport).not.toHaveBeenCalled();
  });

  // --- Oversized proposedPath ---

  it("handles an oversized proposedPath (>1024 chars) without crashing", async () => {
    const app = createApp();
    const longSegment = "a".repeat(1025);

    const response = await request(app).post("/api/imports/dl-6/confirm").send({
      strategy: "pc",
      proposedPath: longSegment,
    });

    expect([200, 400]).toContain(response.status);
    expect(response.status).not.toBe(500);
  });
});
