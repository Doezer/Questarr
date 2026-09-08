import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { emptyDirMock, readdirMock, loggerMocks } = vi.hoisted(() => ({
  emptyDirMock: vi.fn().mockResolvedValue(undefined),
  readdirMock: vi.fn().mockResolvedValue([]),
  loggerMocks: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    emptyDir: emptyDirMock,
    readdir: readdirMock,
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

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecOnce(error: Error | null, stdout = "", stderr = ""): void {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    (args[3] as ExecCallback)(error, stdout, stderr);
    return {} as never;
  });
}

function mockExecAlways(error: Error | null, stdout = "", stderr = ""): void {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    (args[3] as ExecCallback)(error, stdout, stderr);
    return {} as never;
  });
}

// Both binary resolvers cache their result at module scope. Tests that need a specific
// resolution outcome (binary found vs. not found) load a fresh module instance instead of
// relying on test execution order, mirroring apprise.test.ts's cache-reset pattern.
async function freshArchiveService(): Promise<ArchiveService> {
  vi.resetModules();
  const mod = await import("../services/ArchiveService.js");
  return new mod.ArchiveService();
}

describe("ArchiveService", () => {
  let fakeBinaryDir: string;
  let fakeSevenZipPath: string;
  let fakeUnrarPath: string;

  beforeAll(() => {
    fakeBinaryDir = mkdtempSync(path.join(tmpdir(), "questarr-archive-bin-"));
    fakeSevenZipPath = path.join(fakeBinaryDir, "7zz");
    fakeUnrarPath = path.join(fakeBinaryDir, "unrar");
    for (const binPath of [fakeSevenZipPath, fakeUnrarPath]) {
      writeFileSync(binPath, "#!/bin/sh\n");
      chmodSync(binPath, 0o755);
    }
  });

  afterAll(() => {
    delete process.env.SEVENZIP_PATH;
    delete process.env.UNRAR_PATH;
    rmSync(fakeBinaryDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    emptyDirMock.mockResolvedValue(undefined);
    readdirMock.mockResolvedValue([]);
    process.env.SEVENZIP_PATH = fakeSevenZipPath;
    process.env.UNRAR_PATH = fakeUnrarPath;
  });

  it("detects supported archive extensions", () => {
    const service = new ArchiveService();

    expect(service.isArchive("file.ZIP")).toBe(true);
    expect(service.isArchive("file.7z")).toBe(true);
    expect(service.isArchive("file.iso")).toBe(true);
    expect(service.isArchive("file.txt")).toBe(false);
  });

  it("isArchive returns false for unsupported extensions like .exe", () => {
    const service = new ArchiveService();

    expect(service.isArchive("installer.exe")).toBe(false);
    expect(service.isArchive("image.png")).toBe(false);
    expect(service.isArchive("data.bin")).toBe(false);
  });

  it("isArchive returns false for plain text files", () => {
    const service = new ArchiveService();

    expect(service.isArchive("readme.txt")).toBe(false);
    expect(service.isArchive("notes.md")).toBe(false);
    // iso IS treated as an archive by the service
    expect(service.isArchive("image.iso")).toBe(true);
  });

  it("isArchive returns true for .zip files", () => {
    const service = new ArchiveService();
    expect(service.isArchive("game.zip")).toBe(true);
    expect(service.isArchive("ARCHIVE.ZIP")).toBe(true);
  });

  it("isArchive returns true for .7z files", () => {
    const service = new ArchiveService();
    expect(service.isArchive("game.7z")).toBe(true);
  });

  it("isArchive returns false for .exe files — extraction is not triggered", () => {
    const service = new ArchiveService();
    expect(service.isArchive("setup.exe")).toBe(false);
  });

  describe("7-Zip support (.zip/.7z/.iso/.tar/.gz/.bz2)", () => {
    it("routes non-RAR archives to the native 7-Zip binary for test and extraction", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

      const files = await service.extract("/downloads/game.zip", "/tmp/out"); // NOSONAR - mocked fs

      expect(files).toEqual([expect.stringMatching(/tmp[\\/]out[\\/]game\.rom$/)]);

      const calls = vi.mocked(execFile).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(fakeSevenZipPath);
      expect(calls[0][1]).toEqual(["t", "-y", "--", "/downloads/game.zip"]);
      expect(calls[1][0]).toBe(fakeSevenZipPath);
      expect(calls[1][1]).toEqual(["x", "-y", "-o/tmp/out", "--", "/downloads/game.zip"]);
      expect(emptyDirMock).toHaveBeenCalledWith("/tmp/out"); // NOSONAR - mocked fs, no real dir access
    });

    it("resolves with an empty array and warns when extraction produces no files", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([]);

      const files = await service.extract("/downloads/empty.zip", "/tmp/empty-out"); // NOSONAR - mocked fs

      expect(files).toEqual([]);
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "7zip" }),
        expect.stringContaining("produced no files")
      );
    });

    it("empties the destination directory even when it pre-exists", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([]);

      await service.extract("/downloads/game.zip", "/tmp/existing-dir"); // NOSONAR - mocked fs, no real dir access

      expect(emptyDirMock).toHaveBeenCalledOnce();
      expect(emptyDirMock).toHaveBeenCalledWith("/tmp/existing-dir"); // NOSONAR - mocked fs, no real dir access
    });

    it("rejects with the tool's error message when extraction fails", async () => {
      const service = await freshArchiveService();
      // The pre-extraction test succeeds, then extraction itself fails.
      mockExecOnce(null, "", "");
      mockExecOnce(new Error("exit code 2"), "", "Cannot open the file as archive");

      await expect(
        service.extract("/downloads/corrupt.zip", "/tmp/out") // NOSONAR - mocked fs, no real dir access
      ).rejects.toThrow("Cannot open the file as archive");
    });

    it("does not empty the output directory when the integrity test fails on every attempt", async () => {
      const service = await freshArchiveService();
      mockExecAlways(new Error("exit code 2"), "", "Cannot open the file as archive");

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/corrupt.zip", "/tmp/out"); // NOSONAR - mocked fs, no real dir access
      const assertion = expect(resultPromise).rejects.toThrow(/corrupt or incomplete/);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();

      expect(emptyDirMock).not.toHaveBeenCalled();
      // 3 retry attempts, extraction never attempted.
      expect(vi.mocked(execFile).mock.calls).toHaveLength(3);
    });

    it("rejects with a clear error when no 7-Zip binary is available", async () => {
      delete process.env.SEVENZIP_PATH;
      const service = await freshArchiveService();

      await expect(
        service.extract("/downloads/game.zip", "/tmp/out") // NOSONAR - mocked fs
      ).rejects.toThrow("no binary was found");

      expect(execFile).not.toHaveBeenCalled();
      expect(emptyDirMock).not.toHaveBeenCalled();
    });

    it("returns full nested paths for files inside subdirectories", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockImplementation(async (dir: string) => {
        if (dir === "/tmp/nested-out") {
          return [
            { name: "level1", isDirectory: () => true },
            { name: "root.cfg", isDirectory: () => false },
          ] as never;
        }
        if (dir === path.join("/tmp/nested-out", "level1")) {
          return [{ name: "deep.rom", isDirectory: () => false }] as never;
        }
        return [];
      });

      const files = await service.extract("/downloads/nested.zip", "/tmp/nested-out"); // NOSONAR - mocked fs, no real dir access

      expect(files).toHaveLength(2);
      expect(files).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/tmp[\\/]nested-out[\\/]level1[\\/]deep\.rom$/),
          expect.stringMatching(/tmp[\\/]nested-out[\\/]root\.cfg$/),
        ])
      );
    });
  });

  describe("RAR support", () => {
    it("routes .rar files to unrar for test and extraction", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

      const files = await service.extract("/downloads/game.rar", "/tmp/rar-out"); // NOSONAR - mocked fs

      expect(files).toEqual([expect.stringMatching(/tmp[\\/]rar-out[\\/]game\.rom$/)]);

      const calls = vi.mocked(execFile).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(fakeUnrarPath);
      expect(calls[0][1]).toEqual(["t", "-y", "-p-", "--", "/downloads/game.rar"]);
      expect(calls[1][0]).toBe(fakeUnrarPath);
      expect(calls[1][1]).toEqual([
        "x",
        "-y",
        "-p-",
        "--",
        "/downloads/game.rar",
        "/tmp/rar-out" + path.sep,
      ]);
      expect(emptyDirMock).toHaveBeenCalledWith("/tmp/rar-out");
    });

    it("does not create the output directory when the RAR integrity test fails on every attempt", async () => {
      const service = await freshArchiveService();
      mockExecAlways(new Error("exit code 1"), "", "Damaged RAR archive");

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/broken.rar", "/tmp/broken-out"); // NOSONAR - mocked fs
      const assertion = expect(resultPromise).rejects.toThrow(/unrar failed/);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();

      expect(emptyDirMock).not.toHaveBeenCalled();
      // Test invocation ran on every retry attempt — extraction was never attempted.
      expect(vi.mocked(execFile).mock.calls).toHaveLength(3);
    });

    it("appends a corruption hint once retries against a broken archive are exhausted", async () => {
      const service = await freshArchiveService();
      mockExecAlways(new Error("exit code 1"), "", "Unexpected end of archive");

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/corrupt.rar", "/tmp/corrupt-out"); // NOSONAR - mocked fs, no real dir access
      const assertion = expect(resultPromise).rejects.toThrow(/corrupt or incomplete/);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();
    });

    it("retries the integrity test and succeeds once the file is no longer truncated", async () => {
      const service = await freshArchiveService();

      // First attempt: the download client's completion event fired just before the file
      // finished syncing to disk, so unrar reads a truncated file — the same failure
      // signature a genuinely corrupt archive would produce.
      mockExecOnce(new Error("exit code 1"), "", "Unexpected end of archive");
      mockExecAlways(null, "", "");
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

    it("rejects with a clear error when no unrar binary is available", async () => {
      delete process.env.UNRAR_PATH;
      const service = await freshArchiveService();

      await expect(
        service.extract("/downloads/game.rar", "/tmp/out") // NOSONAR - mocked fs
      ).rejects.toThrow("no unrar binary was found");

      expect(execFile).not.toHaveBeenCalled();
      expect(emptyDirMock).not.toHaveBeenCalled();
    });

    it("logs a warning when RAR extraction succeeds but produces no files", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([]);

      const files = await service.extract("/downloads/empty.rar", "/tmp/empty-rar-out"); // NOSONAR - mocked fs

      expect(files).toEqual([]);
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "unrar" }),
        expect.stringContaining("produced no files")
      );
    });
  });
});
