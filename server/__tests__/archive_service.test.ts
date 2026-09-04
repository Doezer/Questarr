import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { extractFullMock, testMock, emptyDirMock, readdirMock, loggerMocks } = vi.hoisted(() => ({
  extractFullMock: vi.fn(),
  testMock: vi.fn(),
  emptyDirMock: vi.fn().mockResolvedValue(undefined),
  readdirMock: vi.fn().mockResolvedValue([]),
  loggerMocks: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node-7z", () => ({
  default: {
    extractFull: extractFullMock,
    test: testMock,
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    emptyDir: emptyDirMock,
    readdir: readdirMock,
  },
}));

vi.mock("7zip-bin", () => ({
  default: {
    path7za: "/mock/7za",
  },
}));

vi.mock("../logger.js", () => ({
  logger: loggerMocks,
}));

vi.mock("node:child_process", () => {
  const execFileMock = vi.fn();
  return {
    execFile: execFileMock,
    default: { execFile: execFileMock },
  };
});

import { ArchiveService } from "../services/ArchiveService.js";

// Auto-resolves the node-7z `test` stream on the next tick, so existing tests that only
// drive the `extractFull` stream don't need to change: by the time they reach their
// `setTimeout(0)` wait, the (now-mandatory) pre-extraction test step has already resolved.
function autoResolveTestStream(): void {
  testMock.mockImplementation(() => {
    const stream = new EventEmitter();
    process.nextTick(() => stream.emit("end"));
    return stream;
  });
}

// resolveBsdtarBinary() caches its result at module scope. Tests that need a specific
// resolution outcome (binary found vs. not found) load a fresh module instance instead of
// relying on test execution order, mirroring apprise.test.ts's cache-reset pattern.
async function freshArchiveService(): Promise<ArchiveService> {
  vi.resetModules();
  const mod = await import("../services/ArchiveService.js");
  return new mod.ArchiveService();
}

describe("ArchiveService", () => {
  let fakeBinaryDir: string;
  let fakeBsdtarPath: string;

  beforeAll(() => {
    fakeBinaryDir = mkdtempSync(path.join(tmpdir(), "questarr-bsdtar-bin-"));
    fakeBsdtarPath = path.join(fakeBinaryDir, "bsdtar");
    writeFileSync(fakeBsdtarPath, "#!/bin/sh\n");
    chmodSync(fakeBsdtarPath, 0o755);
  });

  afterAll(() => {
    delete process.env.BSDTAR_PATH;
    rmSync(fakeBinaryDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    emptyDirMock.mockResolvedValue(undefined);
    readdirMock.mockResolvedValue([]);
    autoResolveTestStream();
    delete process.env.BSDTAR_PATH;
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

    expect(emptyDirMock).toHaveBeenCalledWith("/tmp/out"); // NOSONAR - mocked fs, no real dir access
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
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "7za" }),
      expect.stringContaining("produced no files")
    );
  });

  // Gap 3: non-archive file input — isArchive returns false for .txt
  it("isArchive returns false for plain text files", () => {
    const service = new ArchiveService();

    expect(service.isArchive("readme.txt")).toBe(false);
    expect(service.isArchive("notes.md")).toBe(false);
    // iso IS treated as an archive by the service
    expect(service.isArchive("image.iso")).toBe(true);
  });

  // Gap 4: destination directory pre-exists — emptyDir is always called (clears stale files)
  it("empties the destination directory even when it pre-exists", async () => {
    const stream = new EventEmitter();
    extractFullMock.mockReturnValue(stream);
    // emptyDirMock is already set up to resolve; simulate a pre-existing dir getting cleared
    emptyDirMock.mockResolvedValue(undefined);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.zip", "/tmp/existing-dir"); // NOSONAR - mocked fs, no real dir access

    await new Promise((resolve) => setTimeout(resolve, 0));

    stream.emit("end");

    await resultPromise;

    expect(emptyDirMock).toHaveBeenCalledOnce();
    expect(emptyDirMock).toHaveBeenCalledWith("/tmp/existing-dir"); // NOSONAR - mocked fs, no real dir access
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

  describe("RAR support", () => {
    it("routes .rar files to bsdtar for test and extraction", async () => {
      process.env.BSDTAR_PATH = fakeBsdtarPath;
      const service = await freshArchiveService();

      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        callback(null, "", "");
        return {} as never;
      });
      readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

      const files = await service.extract("/downloads/game.rar", "/tmp/rar-out"); // NOSONAR - mocked fs

      expect(files).toEqual([expect.stringMatching(/tmp[\\/]rar-out[\\/]game\.rom$/)]);

      const calls = vi.mocked(execFile).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(fakeBsdtarPath);
      expect(calls[0][1]).toEqual(["-tf", "/downloads/game.rar"]);
      expect(calls[1][0]).toBe(fakeBsdtarPath);
      expect(calls[1][1]).toEqual(["-xf", "/downloads/game.rar", "-C", "/tmp/rar-out"]);
      expect(emptyDirMock).toHaveBeenCalledWith("/tmp/rar-out");
    });

    it("does not create the output directory when the RAR integrity test fails on every attempt", async () => {
      process.env.BSDTAR_PATH = fakeBsdtarPath;
      const service = await freshArchiveService();

      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        callback(new Error("exit code 1"), "", "Damaged RAR archive");
        return {} as never;
      });

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/broken.rar", "/tmp/broken-out"); // NOSONAR - mocked fs
      const assertion = expect(resultPromise).rejects.toThrow(/bsdtar failed/);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();

      expect(emptyDirMock).not.toHaveBeenCalled();
      // Test invocation ran on every retry attempt — extraction was never attempted.
      expect(vi.mocked(execFile).mock.calls).toHaveLength(3);
    });

    it("appends a corruption hint when bsdtar reports a Huffman decode failure on every attempt", async () => {
      process.env.BSDTAR_PATH = fakeBsdtarPath;
      const service = await freshArchiveService();

      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        callback(
          new Error("exit code 1"),
          "",
          "SLES_52585.ISO: Prefix found: Illegal byte sequence\nbsdtar: Error exit delayed from previous errors"
        );
        return {} as never;
      });

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/corrupt.rar", "/tmp/corrupt-out"); // NOSONAR - mocked fs, no real dir access
      const assertion = expect(resultPromise).rejects.toThrow(/corrupt or incomplete/);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();
    });

    it("still appends the corruption hint when the marker falls past the 500-char display limit", async () => {
      process.env.BSDTAR_PATH = fakeBsdtarPath;
      const service = await freshArchiveService();

      // Padding pushes "Prefix found" well past the 500-char slice used for the displayed
      // detail — the marker must still be detected against the full diagnostic.
      const padding = "x".repeat(600);

      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        callback(new Error("exit code 1"), "", `${padding}\nSLES_52585.ISO: Prefix found`);
        return {} as never;
      });

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/corrupt-padded.rar", "/tmp/corrupt-out"); // NOSONAR - mocked fs, no real dir access
      const assertion = expect(resultPromise).rejects.toThrow(/corrupt or incomplete/);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();
    });

    it("retries the integrity test and succeeds once the file is no longer truncated", async () => {
      process.env.BSDTAR_PATH = fakeBsdtarPath;
      const service = await freshArchiveService();

      let call = 0;
      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        call += 1;
        if (call === 1) {
          // First attempt: the download client's completion event fired just before the
          // file finished syncing to disk — the same read-truncation signature as a
          // genuinely corrupt archive.
          callback(new Error("exit code 1"), "", "game.iso: Prefix found: Illegal byte sequence");
        } else {
          callback(null, "", "");
        }
        return {} as never;
      });
      readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/settling.rar", "/tmp/settling-out"); // NOSONAR - mocked fs
      await vi.runAllTimersAsync();
      const files = await resultPromise;
      vi.useRealTimers();

      expect(files).toEqual([expect.stringMatching(/tmp[\\/]settling-out[\\/]game\.rom$/)]);
      // Attempt 1 (test, fails) → attempt 2 (test, succeeds) → extract.
      expect(vi.mocked(execFile).mock.calls).toHaveLength(3);
      expect(loggerMocks.info).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2 }),
        "Archive test succeeded after retry"
      );
    });

    it("rejects with a clear error when no bsdtar binary is available", async () => {
      delete process.env.BSDTAR_PATH;
      const service = await freshArchiveService();

      await expect(
        service.extract("/downloads/game.rar", "/tmp/out") // NOSONAR - mocked fs
      ).rejects.toThrow("no bsdtar binary was found");

      expect(execFile).not.toHaveBeenCalled();
      expect(emptyDirMock).not.toHaveBeenCalled();
    });

    it("logs a warning when RAR extraction succeeds but produces no files", async () => {
      process.env.BSDTAR_PATH = fakeBsdtarPath;
      const service = await freshArchiveService();

      vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
        const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
        callback(null, "", "");
        return {} as never;
      });
      readdirMock.mockResolvedValueOnce([]);

      const files = await service.extract("/downloads/empty.rar", "/tmp/empty-rar-out"); // NOSONAR - mocked fs

      expect(files).toEqual([]);
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "bsdtar" }),
        expect.stringContaining("produced no files")
      );
    });
  });
});
