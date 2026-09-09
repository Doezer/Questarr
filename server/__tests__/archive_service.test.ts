// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractFullMock, ensureDirMock } = vi.hoisted(() => ({
  extractFullMock: vi.fn(),
  ensureDirMock: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Helper: create a mock 7z stream with a killable child process.
 * The stream mimics node-7z's Readable + _childProcess.
 */
function makeMockStream(): EventEmitter {
  const stream = new EventEmitter();
  // node-7z attaches the spawned child process to the stream
  (stream as unknown as { _childProcess: { kill: () => void; pid: number } })._childProcess = {
    kill: vi.fn(),
    pid: 12345,
  };
  return stream;
}

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
    const stream = makeMockStream();
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
    const stream = makeMockStream();
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
    const stream = makeMockStream();
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
    const stream = makeMockStream();
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
    const stream = makeMockStream();
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
    const stream = makeMockStream();
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
    const stream = makeMockStream();
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
});

describe("ArchiveService timeout and restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill");
    // Fully reset mocks (clearAllMocks doesn't clear mockReturnValueOnce queues)
    extractFullMock.mockReset();
    ensureDirMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("kills the process and restarts when extraction exceeds the timeout", async () => {
    // First stream: hangs (never emits "end")
    const hangingStream = makeMockStream();
    // Second stream: completes normally
    const successStream = makeMockStream();

    extractFullMock.mockReturnValueOnce(hangingStream).mockReturnValueOnce(successStream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.rar", "/tmp/out", {
      timeoutMs: 60000,
      maxRetries: 1,
    });

    // Let async setup complete (ensureDir + extractFull + listeners)
    await vi.advanceTimersByTimeAsync(0);

    // Verify first extraction started
    expect(extractFullMock).toHaveBeenCalledTimes(1);

    // Advance past the timeout — this should trigger the kill + restart
    await vi.advanceTimersByTimeAsync(61000);

    // Verify the hanging process was killed via process.kill (process group)
    // process.kill(-pid) is attempted first; in test env it throws ESRCH,
    // so it falls back to child.kill()
    const hangingChild = (
      hangingStream as unknown as { _childProcess: { kill: ReturnType<typeof vi.fn> } }
    )._childProcess;
    expect(hangingChild.kill).toHaveBeenCalledWith("SIGKILL");

    // Verify second extraction started (retry)
    expect(extractFullMock).toHaveBeenCalledTimes(2);

    // Complete the second extraction
    successStream.emit("data", { status: "extracted", file: "game.rom" });
    successStream.emit("end");

    const result = await resultPromise;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/tmp[\\/]out[\\/]game\.rom$/);
  });

  it("throws timeout error when all retries are exhausted", async () => {
    // Both streams hang — neither completes
    const hangingStream1 = makeMockStream();
    const hangingStream2 = makeMockStream();

    extractFullMock.mockReturnValueOnce(hangingStream1).mockReturnValueOnce(hangingStream2);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.rar", "/tmp/out", {
      timeoutMs: 60000,
      maxRetries: 1,
    });

    // Prevent unhandled rejection warning: attach handler before timers advance
    resultPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    // First timeout fires — kills first process, starts retry
    await vi.advanceTimersByTimeAsync(61000);

    // Second timeout fires — retry exhausted
    await vi.advanceTimersByTimeAsync(61000);

    await expect(resultPromise).rejects.toThrow(/timed out/i);

    // Both processes should have been killed
    const child1 = (
      hangingStream1 as unknown as { _childProcess: { kill: ReturnType<typeof vi.fn> } }
    )._childProcess;
    const child2 = (
      hangingStream2 as unknown as { _childProcess: { kill: ReturnType<typeof vi.fn> } }
    )._childProcess;
    expect(child1.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child2.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not restart if extraction completes before timeout", async () => {
    const stream = makeMockStream();
    extractFullMock.mockReturnValue(stream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.rar", "/tmp/out", {
      timeoutMs: 60000,
      maxRetries: 1,
    });

    await vi.advanceTimersByTimeAsync(0);

    // Complete extraction before timeout
    stream.emit("data", { status: "extracted", file: "game.rom" });
    stream.emit("end");

    const result = await resultPromise;
    expect(result).toHaveLength(1);

    // Only one extraction attempt
    expect(extractFullMock).toHaveBeenCalledTimes(1);

    // Process should NOT have been killed
    const child = (stream as unknown as { _childProcess: { kill: ReturnType<typeof vi.fn> } })
      ._childProcess;
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses default 60s timeout and 1 retry when no options specified", async () => {
    const hangingStream = makeMockStream();
    const successStream = makeMockStream();

    extractFullMock.mockReturnValueOnce(hangingStream).mockReturnValueOnce(successStream);

    const service = new ArchiveService();
    const resultPromise = service.extract("/downloads/game.rar", "/tmp/out");

    await vi.advanceTimersByTimeAsync(0);

    // Advance just under the default 60s — should NOT trigger yet
    await vi.advanceTimersByTimeAsync(59999);
    expect(extractFullMock).toHaveBeenCalledTimes(1);

    // Advance past 60s — triggers timeout + restart
    await vi.advanceTimersByTimeAsync(1000);
    expect(extractFullMock).toHaveBeenCalledTimes(2);

    // Complete the retry
    successStream.emit("data", { status: "extracted", file: "game.rom" });
    successStream.emit("end");

    const result = await resultPromise;
    expect(result).toHaveLength(1);
  });
});
