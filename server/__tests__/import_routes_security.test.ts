import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import request from "supertest";

const { mockStorage, mockImportManager } = vi.hoisted(() => ({
  mockStorage: {
    getImportConfig: vi.fn(),
    getRomMConfig: vi.fn(),
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
import {
  makeImportConfig,
  makeRommConfig,
  createImportTestApp,
} from "./helpers/import-test-helpers.js";

describe("importRouter confirmImport security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getImportConfig.mockResolvedValue(
      makeImportConfig({ renamePattern: "{Title} ({Region})" })
    );
    mockStorage.getRomMConfig.mockResolvedValue(makeRommConfig({ moveMode: "hardlink" }));
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

  it("accepts in-root absolute path", async () => {
    const app = createApp();

    const response = await request(app).post("/api/imports/dl-2/confirm").send({
      strategy: "romm",
      proposedPath: "/data/romm/roms/game.rom",
      transferMode: "hardlink",
    });

    expect(response.status).toBe(200);
    expect(mockImportManager.confirmImport).toHaveBeenCalledWith(
      "dl-2",
      expect.objectContaining({
        strategy: "romm",
        proposedPath: expect.stringMatching(/roms[\\/]game\.rom$/),
      }),
      "user-1"
    );
  });

  // --- URL-encoded traversal ---

  it("rejects URL-encoded traversal sequence %2F..%2F in proposedPath", async () => {
    // %2F is not decoded by JSON body parsing — it arrives as the literal string
    // "%2F..%2F". path.resolve treats % as a normal character, so the resolved
    // path is something like /data/%2F..%2Fetc which is inside /data and therefore
    // accepted. The important guarantee is that it does NOT reach /etc/passwd:
    // confirmImport must either be called with a safe in-root path or rejected.
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
      // The resolved path must remain inside the library root.
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
    // On POSIX, backslash is not a path separator. path.normalize("..\\..\\etc")
    // keeps backslashes as literal characters, so the resolved path stays inside
    // the library root. Either the path is accepted (safe) or rejected (also safe).
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
      // The backslash segments are treated as a literal filename on POSIX,
      // so the resolved path must still be inside the library root.
      expect(resolvedPath === libraryRoot || resolvedPath.startsWith(libraryRoot + path.sep)).toBe(
        true
      );
    }
  });

  // --- Dot-dot traversal via absolute path ---

  it("rejects absolute proposedPath that traverses above the library root via ..", async () => {
    // /data/safe/../../../etc resolves to /etc — outside the library root.
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
    // The confirm schema does not enforce a length limit on proposedPath, so a
    // very long string reaches resolveProposedPathWithinRoot. The route must
    // respond with either 400 (if it escapes the root) or 200 (if it lands
    // inside the root) — it must never crash (500).
    const app = createApp();
    const longSegment = "a".repeat(1025);

    const response = await request(app).post("/api/imports/dl-6/confirm").send({
      strategy: "pc",
      proposedPath: longSegment,
    });

    expect([200, 400]).toContain(response.status);
    // Must never be an unhandled 500 due to path length alone.
    expect(response.status).not.toBe(500);
  });
});
