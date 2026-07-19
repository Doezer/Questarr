import { EventEmitter } from "node:events";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractFullMock, ensureDirMock, listMock, statMock } = vi.hoisted(() => ({
  extractFullMock: vi.fn(),
  ensureDirMock: vi.fn().mockResolvedValue(undefined),
  listMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("node-7z", () => ({
  default: {
    extractFull: extractFullMock,
    list: listMock,
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    ensureDir: ensureDirMock,
    stat: statMock,
  },
}));

vi.mock("7zip-bin", () => ({
  default: {
    path7za: "/mock/7za",
  },
}));

import { ArchiveService } from "../services/ArchiveService.js";

describe("ArchiveService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts files from emitted events", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.zip", "/tmp/out"); // NOSONAR - mocked fs, no real dir access

    // Let the async setup complete so stream listeners are attached.
    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("data", { status: "ignored", file: "not-used.txt" });
    stream.emit("data", { status: "extracted", file: "game.rom" });
    stream.emit("data", { status: "extracted", file: "sub/fanart.png" });
    stream.emit("end");

    await expect(resultPromise).resolves.toEqual([
      expect.stringMatching(/tmp[\\/]out[\\/]game\.rom$/),
      expect.stringMatching(/tmp[\\/]out[\\/]sub[\\/]fanart\.png$/),
    ]);

    expect(ensureDirMock).toHaveBeenCalledWith("/tmp/out"); // NOSONAR - mocked fs, no real dir access
    expect(extractFullMock).toHaveBeenCalledWith(
      "/downloads/game.zip",
      "/tmp/out", // NOSONAR - mocked fs, no real dir access
      expect.objectContaining({
        $bin: "/mock/7za",
        recursive: true,
      })
    );
  });

  it("rejects when extraction stream emits an error", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/bad.zip", "/tmp/out"); // NOSONAR - mocked fs, no real dir access

    // Let the async setup complete so stream listeners are attached.
    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("error", new Error("bad archive"));

    await expect(resultPromise).rejects.toThrow("bad archive");
  });

  it("detects supported archive extensions", () => {
    const service = new ArchiveService();

    expect(service.isArchive("file.ZIP")).toBe(true);
    expect(service.isArchive("file.7z")).toBe(true);
    expect(service.isArchive("file.iso")).toBe(true);
    expect(service.isArchive("file.txt")).toBe(false);
  });

  // Gap 1: unsupported archive format — .exe is not in the supported list
  it("isArchive returns false for unsupported extensions like .exe", () => {
    const service = new ArchiveService();

    expect(service.isArchive("installer.exe")).toBe(false);
    expect(service.isArchive("image.png")).toBe(false);
    expect(service.isArchive("data.bin")).toBe(false);
  });

  // Gap 2: extraction produces no files (empty output) — stream ends without any "extracted" events
  it("resolves with an empty array when no files are extracted", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/empty.zip", "/tmp/empty-out"); // NOSONAR - mocked fs, no real dir access

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Emit only non-extracted status events, then end — no files collected
    stream.emit("data", { status: "processing", file: "something.txt" });
    stream.emit("end");

    await expect(resultPromise).resolves.toEqual([]);
  });

  // Gap 3: non-archive file input — isArchive returns false for .txt
  it("isArchive returns false for plain text files", () => {
    const service = new ArchiveService();

    expect(service.isArchive("readme.txt")).toBe(false);
    expect(service.isArchive("notes.md")).toBe(false);
    // iso IS treated as an archive by the service
    expect(service.isArchive("image.iso")).toBe(true);
  });

  // Gap 4: destination directory pre-exists — ensureDir is always called (idempotent)
  it("calls ensureDir even when the destination directory already exists", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);
    // ensureDirMock is already set up to resolve; simulate pre-existing dir (no-op behaviour)
    ensureDirMock.mockResolvedValue(undefined);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.zip", "/tmp/existing-dir"); // NOSONAR - mocked fs, no real dir access

    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("end");

    await resultPromise;

    expect(ensureDirMock).toHaveBeenCalledOnce();
    expect(ensureDirMock).toHaveBeenCalledWith("/tmp/existing-dir"); // NOSONAR - mocked fs, no real dir access
  });

  // Gap 5: 7zip binary exits with a non-zero code — stream emits an error with stderr output
  it("rejects with stderr message when 7zip exits with non-zero code", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/corrupt.zip", "/tmp/out"); // NOSONAR - mocked fs, no real dir access

    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("error", new Error("7zip exited with code 2: cannot open file as archive"));

    await expect(resultPromise).rejects.toThrow(
      "7zip exited with code 2: cannot open file as archive"
    );
  });

  // Requested: .zip extension is treated as archive
  it("isArchive returns true for .zip files", () => {
    const service = new ArchiveService();
    expect(service.isArchive("game.zip")).toBe(true);
    expect(service.isArchive("ARCHIVE.ZIP")).toBe(true);
  });

  // Requested: .7z extension is treated as archive
  it("isArchive returns true for .7z files", () => {
    const service = new ArchiveService();
    expect(service.isArchive("game.7z")).toBe(true);
  });

  // Requested: .exe extension is NOT treated as archive
  it("isArchive returns false for .exe files — extraction is not triggered", () => {
    const service = new ArchiveService();
    expect(service.isArchive("setup.exe")).toBe(false);
  });

  // Requested: archive with a single file inside — extraction produces exactly one file
  it("extractIfArchive — archive with a single file inside produces exactly one path", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/single.zip", "/tmp/single-out"); // NOSONAR - mocked fs, no real dir access

    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("data", { status: "extracted", file: "rom.bin" });
    stream.emit("end");

    const files = await resultPromise;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/tmp[\\/]single-out[\\/]rom\.bin$/);
  });

  // Gap 6: archive with nested directories — returned paths include full nested structure
  it("returns full nested paths for files inside subdirectories", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/nested.zip", "/tmp/nested-out"); // NOSONAR - mocked fs, no real dir access

    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("data", { status: "extracted", file: "level1/level2/deep.rom" });
    stream.emit("data", { status: "extracted", file: "level1/level2/level3/extra.bin" });
    stream.emit("data", { status: "extracted", file: "root.cfg" });
    stream.emit("end");

    const files = await resultPromise;

    expect(files).toHaveLength(3);
    expect(files[0]).toMatch(/tmp[\\/]nested-out[\\/]level1[\\/]level2[\\/]deep\.rom$/);
    expect(files[1]).toMatch(/tmp[\\/]nested-out[\\/]level1[\\/]level2[\\/]level3[\\/]extra\.bin$/);
    expect(files[2]).toMatch(/tmp[\\/]nested-out[\\/]root\.cfg$/);
  });

  describe("isAlreadyExtracted", () => {
    it("returns true when every entry matches a loose file by name and size", async () => {
      const stream = new EventEmitter();
      listMock.mockReturnValue(stream);
      statMock.mockImplementation(async (p: string) => {
        if (p.endsWith("rom.bin")) return { isDirectory: () => false, size: 100 };
        if (p.endsWith("readme.txt")) return { isDirectory: () => false, size: 20 };
        throw new Error("ENOENT");
      });

      const service = new ArchiveService();
      const resultPromise = service.isAlreadyExtracted("/downloads/game.zip", "/library/game"); // NOSONAR - mocked fs, no real dir access

      await new Promise((resolve) => setTimeout(resolve, 0));
      stream.emit("data", { file: "rom.bin", size: 100, attributes: "A" });
      stream.emit("data", { file: "readme.txt", size: 20, attributes: "A" });
      stream.emit("end");

      await expect(resultPromise).resolves.toBe(true);
    });

    it("returns false when an entry's size differs from the loose file on disk", async () => {
      const stream = new EventEmitter();
      listMock.mockReturnValue(stream);
      statMock.mockImplementation(async () => ({ isDirectory: () => false, size: 999 }));

      const service = new ArchiveService();
      const resultPromise = service.isAlreadyExtracted("/downloads/game.zip", "/library/game"); // NOSONAR - mocked fs, no real dir access

      await new Promise((resolve) => setTimeout(resolve, 0));
      stream.emit("data", { file: "rom.bin", size: 100, attributes: "A" });
      stream.emit("end");

      await expect(resultPromise).resolves.toBe(false);
    });

    it("returns false when an entry is missing from disk", async () => {
      const stream = new EventEmitter();
      listMock.mockReturnValue(stream);
      statMock.mockImplementation(async () => {
        throw new Error("ENOENT");
      });

      const service = new ArchiveService();
      const resultPromise = service.isAlreadyExtracted("/downloads/game.zip", "/library/game"); // NOSONAR - mocked fs, no real dir access

      await new Promise((resolve) => setTimeout(resolve, 0));
      stream.emit("data", { file: "rom.bin", size: 100, attributes: "A" });
      stream.emit("end");

      await expect(resultPromise).resolves.toBe(false);
    });

    it("returns false when an entry resolves to a directory instead of a file", async () => {
      const stream = new EventEmitter();
      listMock.mockReturnValue(stream);
      statMock.mockImplementation(async () => ({ isDirectory: () => true, size: 0 }));

      const service = new ArchiveService();
      const resultPromise = service.isAlreadyExtracted("/downloads/game.zip", "/library/game"); // NOSONAR - mocked fs, no real dir access

      await new Promise((resolve) => setTimeout(resolve, 0));
      stream.emit("data", { file: "subdir", size: 0, attributes: "A" });
      stream.emit("end");

      await expect(resultPromise).resolves.toBe(false);
    });

    it("returns false for an empty archive", async () => {
      const stream = new EventEmitter();
      listMock.mockReturnValue(stream);

      const service = new ArchiveService();
      const resultPromise = service.isAlreadyExtracted("/downloads/empty.zip", "/library/game"); // NOSONAR - mocked fs, no real dir access

      await new Promise((resolve) => setTimeout(resolve, 0));
      stream.emit("end");

      await expect(resultPromise).resolves.toBe(false);
      expect(statMock).not.toHaveBeenCalled();
    });

    it("normalizes foreign path separators in archive entry names before matching", async () => {
      const stream = new EventEmitter();
      listMock.mockReturnValue(stream);
      const expectedPath = path.join("/library/game", "sub", "deep", "file.txt");
      statMock.mockImplementation(async (p: string) => {
        if (p === expectedPath) return { isDirectory: () => false, size: 42 };
        throw new Error(`unexpected stat path: ${p}`);
      });

      const service = new ArchiveService();
      const resultPromise = service.isAlreadyExtracted("/downloads/game.zip", "/library/game"); // NOSONAR - mocked fs, no real dir access

      await new Promise((resolve) => setTimeout(resolve, 0));
      // Archive entries may report backslash separators regardless of the host OS.
      stream.emit("data", { file: "sub\\deep\\file.txt", size: 42, attributes: "A" });
      stream.emit("end");

      await expect(resultPromise).resolves.toBe(true);
    });
  });

  describe("findVolumeSiblings", () => {
    it("recognizes .partN.rar continuation volumes as siblings of .part1.rar", () => {
      const service = new ArchiveService();

      const siblings = service.findVolumeSiblings("/library/game/Game.part1.rar", [
        "/library/game/Game.part1.rar",
        "/library/game/Game.part2.rar",
        "/library/game/Game.part10.rar",
        "/library/game/readme.txt",
      ]);

      expect(siblings.sort()).toEqual(
        [
          "/library/game/Game.part1.rar",
          "/library/game/Game.part2.rar",
          "/library/game/Game.part10.rar",
        ].sort()
      );
    });
  });
});
