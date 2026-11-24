import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

const { storageMock, managerMock, rommMock, scannerMock, pathSecurityMock } = vi.hoisted(() => ({
  pathSecurityMock: { isSensitivePath: vi.fn<(p: string) => Promise<boolean>>() },
  storageMock: {
    getImportConfig: vi.fn(),
    getUserGames: vi.fn(),
    getGame: vi.fn(),
    updateGame: vi.fn().mockResolvedValue(undefined),
  },
  managerMock: {
    getGamePlatformIds: vi.fn(),
    resolveLibraryPlatformFolder: vi.fn(),
    acquireGameLock: vi.fn(async () => () => undefined),
  },
  rommMock: {
    isRommPlatformFoldersEnabled: vi.fn<() => Promise<boolean>>(),
    requestRommScanAfterImport: vi.fn(),
  },
  scannerMock: { replaceGameFilesFromPath: vi.fn().mockResolvedValue(1) },
}));

vi.mock("../storage.js", () => ({ storage: storageMock }));
vi.mock("../services/index.js", () => ({ importManager: managerMock }));
vi.mock("../romm.js", () => rommMock);
vi.mock("../library-scanner.js", () => scannerMock);
vi.mock("../path-security.js", () => pathSecurityMock);

import { applyRommFolderRepair, previewRommFolderRepair } from "../romm-folder-repair.js";

let root: string;

function game(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    userId: "u1",
    title: "Pokopia",
    platforms: [{ id: 508 }],
    targetPlatformId: null,
    libraryPath: path.join(root, "win", "Pokopia"),
    ...over,
  };
}

describe("RomM folder repair", () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "romm-repair-"));
    await fs.ensureDir(path.join(root, "win", "Pokopia"));
    await fs.writeFile(path.join(root, "win", "Pokopia", "a.nup"), "x");
    vi.clearAllMocks();
    pathSecurityMock.isSensitivePath.mockResolvedValue(false);
    rommMock.isRommPlatformFoldersEnabled.mockResolvedValue(true);
    storageMock.getImportConfig.mockResolvedValue({ libraryRoot: root, importPlatformIds: [] });
    storageMock.getUserGames.mockResolvedValue([game()]);
    storageMock.getGame.mockImplementation(async () => game());
    managerMock.getGamePlatformIds.mockImplementation((g: { platforms: { id: number }[] }) =>
      g.platforms.map((p) => p.id)
    );
    managerMock.resolveLibraryPlatformFolder.mockResolvedValue("switch-2");
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it("proposes moving a Switch 2 game out of win", async () => {
    const [p] = await previewRommFolderRepair("u1");
    expect(p).toMatchObject({
      gameId: "g1",
      currentFolder: "win",
      expectedFolder: "switch-2",
      to: path.join(root, "switch-2", "Pokopia"),
      destinationExists: false,
    });
  });

  it("leaves games alone when the folder belongs to one of their platforms", async () => {
    storageMock.getUserGames.mockResolvedValue([game({ platforms: [{ id: 6 }, { id: 508 }] })]);
    expect(await previewRommFolderRepair("u1")).toEqual([]);
  });

  it("makes no proposal without platform information or outside the library root", async () => {
    storageMock.getUserGames.mockResolvedValue([
      game({ platforms: [] }),
      game({ id: "g2", libraryPath: "/elsewhere/win/Pokopia" }),
      game({ id: "g3", libraryPath: path.join(root, "My Folder", "Pokopia") }),
    ]);
    expect(await previewRommFolderRepair("u1")).toEqual([]);
  });

  it("refuses to run with RomM platform folders off", async () => {
    rommMock.isRommPlatformFoldersEnabled.mockResolvedValue(false);
    await expect(previewRommFolderRepair("u1")).rejects.toThrow(/platform folders/);
  });

  it("moves the files, updates the game and asks RomM to rescan", async () => {
    const [r] = await applyRommFolderRepair("u1", ["g1"]);
    expect(r).toMatchObject({ moved: true, to: path.join(root, "switch-2", "Pokopia") });
    expect(await fs.pathExists(path.join(root, "switch-2", "Pokopia", "a.nup"))).toBe(true);
    expect(await fs.pathExists(path.join(root, "win", "Pokopia"))).toBe(false);
    expect(storageMock.updateGame).toHaveBeenCalledWith("g1", {
      libraryPath: path.join(root, "switch-2", "Pokopia"),
    });
    expect(scannerMock.replaceGameFilesFromPath).toHaveBeenCalledWith(
      "g1",
      path.join(root, "switch-2", "Pokopia"),
      path.join(root, "win", "Pokopia")
    );
    expect(rommMock.requestRommScanAfterImport).toHaveBeenCalledOnce();
  });

  it("puts the files back when the database update fails", async () => {
    storageMock.updateGame.mockRejectedValueOnce(new Error("db down"));
    const [r] = await applyRommFolderRepair("u1", ["g1"]);
    expect(r).toMatchObject({ moved: false, error: "db down" });
    expect(await fs.pathExists(path.join(root, "win", "Pokopia", "a.nup"))).toBe(true);
    expect(await fs.pathExists(path.join(root, "switch-2", "Pokopia"))).toBe(false);
    expect(rommMock.requestRommScanAfterImport).not.toHaveBeenCalled();
  });

  it("never overwrites an existing destination", async () => {
    await fs.ensureDir(path.join(root, "switch-2", "Pokopia"));
    const [r] = await applyRommFolderRepair("u1", ["g1"]);
    expect(r?.moved).toBe(false);
    expect(r?.error).toMatch(/already exists/);
    expect(await fs.pathExists(path.join(root, "win", "Pokopia", "a.nup"))).toBe(true);
    expect(storageMock.updateGame).not.toHaveBeenCalled();
  });

  it("rejects another user's game", async () => {
    storageMock.getGame.mockResolvedValue(game({ userId: "someone-else" }));
    const [r] = await applyRommFolderRepair("u1", ["g1"]);
    expect(r).toMatchObject({ moved: false, error: "Game not found" });
  });

  it("records a failed lookup for that game and keeps going", async () => {
    storageMock.getGame
      .mockRejectedValueOnce(new Error("db busy"))
      .mockImplementation(async () => game({ id: "g2" }));
    const results = await applyRommFolderRepair("u1", ["g1", "g2"]);
    expect(results[0]).toMatchObject({ gameId: "g1", moved: false, error: "db busy" });
    expect(results[1]).toMatchObject({ gameId: "g2", moved: true });
    expect(rommMock.requestRommScanAfterImport).toHaveBeenCalledOnce();
  });

  it("refuses a sensitive destination and takes the game lock", async () => {
    const release = vi.fn();
    managerMock.acquireGameLock.mockResolvedValueOnce(release);
    pathSecurityMock.isSensitivePath.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const [r] = await applyRommFolderRepair("u1", ["g1"]);
    expect(r?.error).toMatch(/sensitive/);
    expect(managerMock.acquireGameLock).toHaveBeenCalledWith("g1");
    expect(release).toHaveBeenCalledOnce();
    expect(await fs.pathExists(path.join(root, "win", "Pokopia", "a.nup"))).toBe(true);
  });

  it("refuses a platform folder that is a link leading outside the library", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "romm-outside-"));
    try {
      await fs.symlink(outside, path.join(root, "switch-2"));
      const [r] = await applyRommFolderRepair("u1", ["g1"]);
      expect(r).toMatchObject({
        moved: false,
        error: "The game's folder leads outside the library",
      });
      expect(await fs.pathExists(path.join(root, "win", "Pokopia", "a.nup"))).toBe(true);
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.remove(outside);
    }
  });
});
