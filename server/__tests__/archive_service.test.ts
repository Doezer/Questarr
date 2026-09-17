import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { emptyDirMock, readdirMock, statMock, removeMock, loggerMocks } = vi.hoisted(() => ({
  emptyDirMock: vi.fn().mockResolvedValue(undefined),
  readdirMock: vi.fn().mockResolvedValue([]),
  statMock: vi.fn(),
  removeMock: vi.fn().mockResolvedValue(undefined),
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
    stat: statMock,
    remove: removeMock,
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

// A path guaranteed not to exist on any machine — used to force "binary not found" instead of
// deleting the env var and relying on the hardcoded fallback candidates (/usr/bin/7zz,
// /usr/bin/7z, /usr/local/bin/unrar, /usr/bin/unrar) being absent. That assumption doesn't
// hold everywhere: a bare CI runner or dev machine can genuinely have a system 7-Zip
// installed (p7zip is a common preinstall), which made this exact test flaky in CI.
const NONEXISTENT_BINARY_PATH = "/definitely/does/not/exist/questarr-archive-tool-test";

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
    removeMock.mockResolvedValue(undefined);
    process.env.SEVENZIP_PATH = fakeSevenZipPath;
    process.env.UNRAR_PATH = fakeUnrarPath;
  });

  // Several tests below call vi.useFakeTimers() and restore real timers manually at the end
  // of the test body. If an assertion throws first, that restore is skipped, leaving fake
  // timers active for every test that runs afterward in the same worker — a real setTimeout
  // elsewhere would then never fire. Force a reset unconditionally so one failure here can't
  // cascade into unrelated tests/files sharing this worker.
  afterEach(() => {
    vi.useRealTimers();
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

  it("isArchive recognizes numbered multi-volume continuations with no plain archive extension", () => {
    // path.extname("game.7z.001") is ".001", not a recognized archive extension on its
    // own — without this, a directory containing only numbered volumes (no separate
    // plain .rar/.7z/.zip file) would never be seen as containing an archive at all.
    const service = new ArchiveService();
    expect(service.isArchive("game.7z.001")).toBe(true);
    expect(service.isArchive("game.7z.010")).toBe(true);
    expect(service.isArchive("game.zip.002")).toBe(true);
    expect(service.isArchive("game.r00")).toBe(true);
    expect(service.isArchive("game.r99")).toBe(true);
    expect(service.isArchive("game.001")).toBe(true);
    expect(service.isArchive("readme.001")).toBe(true);
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
      expect(calls[1][1]).toEqual([
        "x",
        "-bso0",
        "-bsp0",
        "-y",
        "-o/tmp/out",
        "--",
        "/downloads/game.zip",
      ]);
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

    it("does not delete the archive when it already lives inside outputDir (move/copy extract-in-place)", async () => {
      // Regression test: ImportManager's move/copy import modes relocate the raw archive
      // into the library destination before calling extract() there, so outputDir and the
      // archive's own directory are the same path. Unconditionally emptying outputDir
      // would delete the archive before the tool ever reads it.
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      // First readdir: this method's own pre-cleanup listing of outputDir, containing the
      // archive plus a stale leftover from a killed prior attempt.
      readdirMock.mockResolvedValueOnce([
        { name: "game.zip", isDirectory: () => false },
        { name: "stale.tmp", isDirectory: () => false },
      ]);
      // Second readdir: listExtractedFiles's post-extraction listing.
      readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

      const files = await service.extract("/tmp/library/game.zip", "/tmp/library"); // NOSONAR - mocked fs

      expect(emptyDirMock).not.toHaveBeenCalled();
      expect(removeMock).toHaveBeenCalledExactlyOnceWith(path.join("/tmp/library", "stale.tmp"));
      expect(files).toEqual([expect.stringMatching(/library[\\/]game\.rom$/)]);
    });

    it("preserves other volumes of a multi-part archive already extracted in place", async () => {
      // Regression test: the in-place cleanup above only protected the exact archive
      // file passed in (archiveBasename), so extracting "game.7z.001" would delete its
      // sibling volume "game.7z.002" before 7-Zip ever got to read it.
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([
        { name: "game.7z.001", isDirectory: () => false },
        { name: "game.7z.002", isDirectory: () => false },
        { name: "stale.tmp", isDirectory: () => false },
      ]);
      readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

      await service.extract("/tmp/library/game.7z.001", "/tmp/library"); // NOSONAR - mocked fs

      expect(emptyDirMock).not.toHaveBeenCalled();
      expect(removeMock).toHaveBeenCalledExactlyOnceWith(path.join("/tmp/library", "stale.tmp"));
    });

    it("still empties the whole output directory when the archive lives elsewhere", async () => {
      // Regression guard for the test above: the in-place branch must only trigger when
      // the archive's own directory matches outputDir, not whenever outputDir is non-empty.
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");
      readdirMock.mockResolvedValueOnce([]);

      await service.extract("/downloads/game.zip", "/tmp/out"); // NOSONAR - mocked fs, no real dir access

      expect(emptyDirMock).toHaveBeenCalledWith("/tmp/out"); // NOSONAR - mocked fs, no real dir access
      expect(removeMock).not.toHaveBeenCalled();
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
      process.env.SEVENZIP_PATH = NONEXISTENT_BINARY_PATH;
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
        "-idq",
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
      process.env.UNRAR_PATH = NONEXISTENT_BINARY_PATH;
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

  describe("Password-protected archives", () => {
    it.each([
      ["unrar", "/downloads/game.rar", "/tmp/rar-out", "Cannot open <game.rar>\nwrong password"],
      ["7-Zip", "/downloads/game.zip", "/tmp/out", "Wrong password?"],
    ])(
      "rejects with ArchivePasswordRequiredError, without retrying, when %s reports a password issue",
      async (_tool, filePath, outDir, stderr) => {
        const service = await freshArchiveService();
        const { ArchivePasswordRequiredError } = await import("../services/ArchiveService.js");
        mockExecAlways(new Error("exit code 2"), "", stderr);

        await expect(
          service.extract(filePath, outDir) // NOSONAR - mocked fs
        ).rejects.toThrow(ArchivePasswordRequiredError);

        // No retries — a password failure is deterministic, so only the first test attempt runs.
        expect(vi.mocked(execFile).mock.calls).toHaveLength(1);
        expect(emptyDirMock).not.toHaveBeenCalled();
      }
    );

    it("does not misclassify a corrupt archive as password-protected just because its path contains the word 'password'", async () => {
      const service = await freshArchiveService();
      const { ArchivePasswordRequiredError } = await import("../services/ArchiveService.js");
      mockExecAlways(
        new Error("exit code 2"),
        "",
        "Cannot open the file MyPasswordVault.rar as archive: CRC failed"
      );

      vi.useFakeTimers();
      const resultPromise = service.extract("/downloads/MyPasswordVault.rar", "/tmp/out"); // NOSONAR - mocked fs
      const assertion = expect(resultPromise).rejects.not.toThrow(ArchivePasswordRequiredError);
      await vi.runAllTimersAsync();
      await assertion;
      vi.useRealTimers();

      // Falls through to the normal retry loop (3 attempts) and the generic
      // corruption message, exactly like any other non-password failure.
      expect(vi.mocked(execFile).mock.calls).toHaveLength(3);
    });

    it.each([
      [
        "unrar",
        "/downloads/game.rar",
        "/tmp/rar-out",
        ["t", "-y", "-phunter2", "--", "/downloads/game.rar"],
        ["x", "-idq", "-y", "-phunter2", "--", "/downloads/game.rar", "/tmp/rar-out" + path.sep],
      ],
      [
        "7-Zip",
        "/downloads/game.zip",
        "/tmp/out",
        ["t", "-y", "-phunter2", "--", "/downloads/game.zip"],
        ["x", "-bso0", "-bsp0", "-y", "-phunter2", "-o/tmp/out", "--", "/downloads/game.zip"],
      ],
    ])(
      "passes a given password to %s via -p<password> on both test and extract",
      async (_tool, filePath, outDir, expectedTestArgs, expectedExtractArgs) => {
        const service = await freshArchiveService();
        mockExecAlways(null, "", "");
        readdirMock.mockResolvedValueOnce([{ name: "game.rom", isDirectory: () => false }]);

        await service.extract(filePath, outDir, "hunter2"); // NOSONAR - mocked fs

        const calls = vi.mocked(execFile).mock.calls;
        expect(calls[0][1]).toEqual(expectedTestArgs);
        expect(calls[1][1]).toEqual(expectedExtractArgs);
      }
    );

    it("reports a rejected-password message distinct from the initial 'required' message on a wrong retry password", async () => {
      const service = await freshArchiveService();
      mockExecAlways(new Error("exit code 3"), "", "wrong password for the archive");

      await expect(
        service.extract("/downloads/game.rar", "/tmp/rar-out", "wrongpass") // NOSONAR - mocked fs
      ).rejects.toThrow(/incorrect/i);
    });
  });

  describe("listEntries()", () => {
    // A real `7z l -slt` transcript: a blank-line-delimited archive-header block
    // followed by one block per entry (files and, for "sub", a directory).
    const SLT_OUTPUT = [
      "Path = test.zip",
      "Type = zip",
      "Physical Size = 569",
      "",
      "----------",
      "Path = config.cfg",
      "Folder = -",
      "Size = 12",
      "Packed Size = 12",
      "",
      "Path = sub",
      "Folder = +",
      "Size = 0",
      "Packed Size = 0",
      "",
      "Path = sub/deep.dat",
      "Folder = -",
      "Size = 7",
      "Packed Size = 7",
      "",
    ].join("\n");

    it("parses -slt output into leaf-file entries, excluding directories", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, SLT_OUTPUT, "");

      const entries = await service.listEntries("/downloads/test.zip"); // NOSONAR - mocked fs

      expect(entries).toEqual([
        { name: "config.cfg", size: 12 },
        { name: "sub/deep.dat", size: 7 },
      ]);
      const calls = vi.mocked(execFile).mock.calls;
      expect(calls[0][0]).toBe(fakeSevenZipPath);
      expect(calls[0][1]).toEqual(["l", "-slt", "-p-", "--", "/downloads/test.zip"]);
    });

    it("routes listing through 7-Zip even for a .rar path", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, SLT_OUTPUT, "");

      await service.listEntries("/downloads/game.rar"); // NOSONAR - mocked fs

      // Extraction routes .rar to unrar, but listing always goes through 7-Zip — its
      // -slt format is the same regardless of archive type, unlike unrar's own
      // column-aligned list commands.
      expect(vi.mocked(execFile).mock.calls[0][0]).toBe(fakeSevenZipPath);
    });

    it("rejects when 7-Zip fails to list the archive", async () => {
      const service = await freshArchiveService();
      mockExecAlways(new Error("exit code 2"), "", "Cannot open the file as archive");

      await expect(
        service.listEntries("/downloads/corrupt.zip") // NOSONAR - mocked fs
      ).rejects.toThrow("Cannot open the file as archive");
    });
  });

  describe("isAlreadyExtracted()", () => {
    const SLT_OUTPUT = [
      "Path = test.zip",
      "Type = zip",
      "",
      "----------",
      "Path = game.rom",
      "Folder = -",
      "Size = 12",
      "",
    ].join("\n");

    it("returns true when every entry matches a loose file by name and size", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, SLT_OUTPUT, "");
      statMock.mockResolvedValue({ isDirectory: () => false, size: 12 });

      const result = await service.isAlreadyExtracted("/downloads/test.zip", "/downloads"); // NOSONAR - mocked fs

      expect(result).toBe(true);
    });

    it("returns false when a matching-name file has a different size (partial/incomplete extraction)", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, SLT_OUTPUT, "");
      statMock.mockResolvedValue({ isDirectory: () => false, size: 5 });

      const result = await service.isAlreadyExtracted("/downloads/test.zip", "/downloads"); // NOSONAR - mocked fs

      expect(result).toBe(false);
    });

    it("returns false when the candidate loose file doesn't exist", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, SLT_OUTPUT, "");
      statMock.mockRejectedValue(new Error("ENOENT"));

      const result = await service.isAlreadyExtracted("/downloads/test.zip", "/downloads"); // NOSONAR - mocked fs

      expect(result).toBe(false);
    });

    it("returns false when the archive has no entries at all", async () => {
      const service = await freshArchiveService();
      mockExecAlways(null, "", "");

      const result = await service.isAlreadyExtracted("/downloads/empty.zip", "/downloads"); // NOSONAR - mocked fs

      expect(result).toBe(false);
    });

    it("returns false (never throws) when listing the archive fails", async () => {
      const service = await freshArchiveService();
      mockExecAlways(new Error("exit code 2"), "", "Cannot open the file as archive");

      const result = await service.isAlreadyExtracted("/downloads/corrupt.zip", "/downloads"); // NOSONAR - mocked fs

      expect(result).toBe(false);
    });

    it("returns false for an entry whose name escapes baseDir, without stat-ing outside it", async () => {
      // entry.name comes from the archive's own listing, which is attacker-controllable
      // content — a crafted "../../elsewhere/passwd"-style entry must not let an
      // unrelated file outside baseDir satisfy the already-extracted check.
      const service = await freshArchiveService();
      mockExecAlways(
        null,
        [
          "Path = test.zip",
          "Type = zip",
          "",
          "----------",
          "Path = ../../etc/passwd",
          "Folder = -",
          "Size = 12",
          "",
        ].join("\n"),
        ""
      );
      statMock.mockResolvedValue({ isDirectory: () => false, size: 12 });

      const result = await service.isAlreadyExtracted("/downloads/test.zip", "/downloads/sub"); // NOSONAR - mocked fs

      expect(result).toBe(false);
      expect(statMock).not.toHaveBeenCalled();
    });
  });

  describe("findVolumeSiblings()", () => {
    it("matches classic .rNN split-volume siblings", () => {
      const service = new ArchiveService();

      const result = service.findVolumeSiblings("/dl/Game.rar", [
        "/dl/Game.rar",
        "/dl/Game.r00",
        "/dl/Game.r01",
        "/dl/readme.txt",
        "/dl/Other.rar",
      ]);

      expect(result.sort()).toEqual(["/dl/Game.r00", "/dl/Game.r01", "/dl/Game.rar"].sort());
    });

    it("matches .partN.rar siblings including double-digit part numbers (regression: stem used to keep .part1 attached)", () => {
      const service = new ArchiveService();

      const result = service.findVolumeSiblings("/dl/Game.part1.rar", [
        "/dl/Game.part1.rar",
        "/dl/Game.part2.rar",
        "/dl/Game.part10.rar",
        "/dl/readme.txt",
      ]);

      expect(result.sort()).toEqual(
        ["/dl/Game.part1.rar", "/dl/Game.part2.rar", "/dl/Game.part10.rar"].sort()
      );
    });

    it("matches .7z.NNN split-volume siblings", () => {
      const service = new ArchiveService();

      const result = service.findVolumeSiblings("/dl/Game.7z.001", [
        "/dl/Game.7z.001",
        "/dl/Game.7z.002",
        "/dl/Other.7z.001",
      ]);

      expect(result.sort()).toEqual(["/dl/Game.7z.001", "/dl/Game.7z.002"].sort());
    });

    it("does not match an unrelated archive that merely shares a prefix", () => {
      const service = new ArchiveService();

      const result = service.findVolumeSiblings("/dl/Game.rar", [
        "/dl/Game.rar",
        "/dl/Game Extended.rar",
      ]);

      expect(result).toEqual(["/dl/Game.rar"]);
    });

    it("does not match a different archive family sharing the same stem (regression: any numbered suffix used to match regardless of type)", () => {
      const service = new ArchiveService();

      // "Game.rar" (classic RAR) and "Game.7z.001"/"Game.zip.001" are three entirely
      // unrelated archives that only happen to share the "Game" filename stem — matching
      // across families would wrongly exclude/delete the other formats' volumes when
      // only one of them was actually selected for import.
      const result = service.findVolumeSiblings("/dl/Game.rar", [
        "/dl/Game.rar",
        "/dl/Game.r00",
        "/dl/Game.7z.001",
        "/dl/Game.zip.001",
        "/dl/Game.001",
      ]);

      expect(result.sort()).toEqual(["/dl/Game.r00", "/dl/Game.rar"].sort());
    });

    it("scopes 7z.NNN matching to the 7z family only", () => {
      const service = new ArchiveService();

      const result = service.findVolumeSiblings("/dl/Game.7z.001", [
        "/dl/Game.7z.001",
        "/dl/Game.7z.002",
        "/dl/Game.rar",
        "/dl/Game.zip.001",
      ]);

      expect(result.sort()).toEqual(["/dl/Game.7z.001", "/dl/Game.7z.002"].sort());
    });
  });
});
