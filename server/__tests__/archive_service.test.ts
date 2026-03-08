import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractFullMock, ensureDirMock } = vi.hoisted(() => ({
  extractFullMock: vi.fn(),
  ensureDirMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node-7z", () => ({
  default: {
    extractFull: extractFullMock,
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    ensureDir: ensureDirMock,
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
    const resultPromise = service.extract("/downloads/game.zip", "/tmp/out");

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

    expect(ensureDirMock).toHaveBeenCalledWith("/tmp/out");
    expect(extractFullMock).toHaveBeenCalledWith(
      "/downloads/game.zip",
      "/tmp/out",
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
    const resultPromise = service.extract("/downloads/bad.zip", "/tmp/out");

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
});
