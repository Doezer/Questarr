import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { probeRootFolder, refreshAllRootFoldersHealth } from "../root-folders.js";
import type { RootFolder } from "../../shared/schema.js";

vi.mock("../storage.js", () => ({
  storage: {
    getAllRootFolders: vi.fn(),
    updateRootFolderHealth: vi.fn(),
  },
}));

describe("probeRootFolder", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-root-folder-"));
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("reports a real, readable directory as accessible", async () => {
    const health = await probeRootFolder(tmpDir);
    expect(health.accessible).toBe(true);
    expect(health.error).toBeUndefined();
  });

  it("reports a missing path as inaccessible with an error", async () => {
    const health = await probeRootFolder(path.join(tmpDir, "does-not-exist"));
    expect(health.accessible).toBe(false);
    expect(health.error).toBeTruthy();
  });

  it("reports a file (not a directory) as inaccessible", async () => {
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    await fs.promises.writeFile(filePath, "hello");
    const health = await probeRootFolder(filePath);
    expect(health.accessible).toBe(false);
    expect(health.error).toMatch(/not a directory/i);
  });
});

describe("refreshAllRootFoldersHealth", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "questarr-refresh-health-"));
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("probes and persists health for every stored root folder", async () => {
    const { storage } = await import("../storage.js");
    const folders: RootFolder[] = [
      {
        id: "rf-1",
        path: tmpDir,
        name: null,
        enabled: true,
        accessible: null,
        diskFreeBytes: null,
        diskTotalBytes: null,
        lastScannedAt: null,
        createdAt: new Date(),
      },
      {
        id: "rf-2",
        path: path.join(tmpDir, "does-not-exist"),
        name: null,
        enabled: true,
        accessible: null,
        diskFreeBytes: null,
        diskTotalBytes: null,
        lastScannedAt: null,
        createdAt: new Date(),
      },
    ];
    vi.mocked(storage.getAllRootFolders).mockResolvedValue(folders);
    vi.mocked(storage.updateRootFolderHealth).mockResolvedValue(undefined);

    await refreshAllRootFoldersHealth();

    expect(storage.updateRootFolderHealth).toHaveBeenCalledWith(
      "rf-1",
      expect.objectContaining({ accessible: true })
    );
    expect(storage.updateRootFolderHealth).toHaveBeenCalledWith(
      "rf-2",
      expect.objectContaining({ accessible: false })
    );
  });
});
