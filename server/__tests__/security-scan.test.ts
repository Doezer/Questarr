import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsExtra from "fs-extra";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

vi.mock("../logger.js", () => ({
  logger: {
    child: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
  resolveSafeAddress: vi.fn(),
  normalizeHostname: (h: string) => h,
}));

const clamAvTestState = vi.hoisted(() => ({
  responseQueue: [] as string[],
  forceConnectError: null as string | null,
  createdSockets: [] as unknown[],
}));

vi.mock("node:net", () => {
  // A minimal EventEmitter substitute, defined inline (rather than imported
  // from "node:events") because vi.mock factories are hoisted above all
  // imports — referencing an imported binding here would throw a TDZ error.
  class MiniEmitter {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, cb: (...args: unknown[]) => void) {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      const wrapper = (...args: unknown[]) => {
        this.off(event, wrapper);
        cb(...args);
      };
      return this.on(event, wrapper);
    }
    off(event: string, cb: (...args: unknown[]) => void) {
      const arr = this.listeners.get(event);
      if (arr)
        this.listeners.set(
          event,
          arr.filter((fn) => fn !== cb)
        );
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
      return true;
    }
  }

  class FakeSocket extends MiniEmitter {
    destroyed = false;
    constructor() {
      super();
      clamAvTestState.createdSockets.push(this);
    }
    connect(_port: number, _address: string, cb: () => void) {
      if (clamAvTestState.forceConnectError) {
        const message = clamAvTestState.forceConnectError;
        queueMicrotask(() => this.emit("error", new Error(message)));
        return this;
      }
      queueMicrotask(cb);
      return this;
    }
    write(data: Buffer | string) {
      if (Buffer.isBuffer(data) && data.length === 4 && data.readUInt32BE(0) === 0) {
        const queued = clamAvTestState.responseQueue.shift() ?? "stream: OK\0";
        // "RESET:" replies mimic clamd refusing a stream: it answers, then resets
        // the connection, which Node reports as an error before the close.
        const reset = queued.startsWith("RESET:");
        const resp = reset ? queued.slice("RESET:".length) : queued;
        queueMicrotask(() => {
          this.emit("data", Buffer.from(resp));
          if (reset) this.emit("error", new Error("read ECONNRESET"));
          this.emit("close");
        });
      }
      return true;
    }
    setTimeout() {
      return this;
    }
    destroy() {
      this.destroyed = true;
    }
  }

  return { default: { Socket: FakeSocket }, Socket: FakeSocket };
});

import { safeFetch, resolveSafeAddress } from "../ssrf.js";
import {
  computeFileSha256,
  checkVirusTotalHash,
  readVirusTotalSettings,
  readClamAvSettings,
  SecurityScanService,
  MAX_CLAMAV_SCAN_FILES,
  CLAMAV_TOTAL_SCAN_BUDGET_MS,
} from "../security-scan.js";

function mockStorage(config: Record<string, string | undefined>) {
  return {
    getSystemConfig: vi.fn(async (key: string) => config[key]),
  };
}

describe("computeFileSha256", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-scan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("computes the correct SHA-256 hash of a file's contents", async () => {
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "hello world");
    const expected = crypto.createHash("sha256").update("hello world").digest("hex");
    await expect(computeFileSha256(filePath)).resolves.toBe(expected);
  });

  it("rejects when the file does not exist", async () => {
    await expect(computeFileSha256(path.join(tmpDir, "missing.txt"))).rejects.toThrow();
  });
});

describe("readVirusTotalSettings / readClamAvSettings", () => {
  it("returns safe defaults when nothing is configured", async () => {
    const storage = mockStorage({});
    await expect(readVirusTotalSettings(storage)).resolves.toEqual({
      enabled: false,
      apiKey: null,
      threshold: 2,
      blockUnknownHashes: false,
    });
    await expect(readClamAvSettings(storage)).resolves.toEqual({
      enabled: false,
      host: null,
      port: 3310,
    });
  });

  it("parses stored values", async () => {
    const storage = mockStorage({
      "security.vt.enabled": "true",
      "security.vt.apiKey": " abc123 ",
      "security.vt.threshold": "5",
      "security.vt.blockUnknownHashes": "true",
      "security.clamav.enabled": "true",
      "security.clamav.host": "clamav",
      "security.clamav.port": "1234",
    });
    await expect(readVirusTotalSettings(storage)).resolves.toEqual({
      enabled: true,
      apiKey: "abc123",
      threshold: 5,
      blockUnknownHashes: true,
    });
    await expect(readClamAvSettings(storage)).resolves.toEqual({
      enabled: true,
      host: "clamav",
      port: 1234,
    });
  });
});

describe("checkVirusTotalHash", () => {
  beforeEach(() => {
    vi.mocked(safeFetch).mockReset();
  });

  it("returns 'unknown' on a 404", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ status: 404, ok: false } as never);
    await expect(checkVirusTotalHash("hash", "key")).resolves.toEqual({ status: "unknown" });
  });

  it("returns 'flagged' with the malicious engine count on success", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 7 } } } }),
    } as never);
    await expect(checkVirusTotalHash("hash", "key")).resolves.toEqual({
      status: "flagged",
      positives: 7,
    });
  });

  it("returns 'clean' when VirusTotal reports zero detections", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 0 } } } }),
    } as never);
    await expect(checkVirusTotalHash("hash", "key")).resolves.toEqual({
      status: "clean",
      positives: 0,
    });
  });

  it("returns 'error' on a non-ok, non-404 response", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ status: 500, ok: false } as never);
    const result = await checkVirusTotalHash("hash", "key");
    expect(result.status).toBe("error");
  });

  it("returns 'error' when the request throws (timeout/network failure)", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("timed out"));
    const result = await checkVirusTotalHash("hash", "key");
    expect(result).toEqual({ status: "error", error: "timed out" });
  });

  it("passes a 10s timeout and requireHttps to safeFetch", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ status: 404, ok: false } as never);
    await checkVirusTotalHash("deadbeef", "my-key");
    expect(safeFetch).toHaveBeenCalledWith(
      "https://www.virustotal.com/api/v3/files/deadbeef",
      expect.objectContaining({
        headers: { "x-apikey": "my-key" },
        timeoutMs: 10_000,
        requireHttps: true,
      })
    );
  });
});

describe("SecurityScanService.scan", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "questarr-scan-service-"));
    filePath = path.join(tmpDir, "download.zip");
    fs.writeFileSync(filePath, "some archive bytes");
    vi.mocked(safeFetch).mockReset();
    vi.mocked(resolveSafeAddress).mockReset();
    clamAvTestState.responseQueue = [];
    clamAvTestState.forceConnectError = null;
    clamAvTestState.createdSockets.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not block when both providers are disabled", async () => {
    const service = new SecurityScanService(mockStorage({}));
    await expect(service.scan(filePath)).resolves.toEqual({ blocked: false });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("blocks when VirusTotal flags the file above the threshold", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 10 } } } }),
    } as never);
    const service = new SecurityScanService(
      mockStorage({
        "security.vt.enabled": "true",
        "security.vt.apiKey": "key",
        "security.vt.threshold": "2",
      })
    );
    const result = await service.scan(filePath);
    expect(result.blocked).toBe(true);
    expect(result.source).toBe("virustotal");
  });

  it("does not block when VirusTotal flags are at or below the threshold", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 1 } } } }),
    } as never);
    const service = new SecurityScanService(
      mockStorage({
        "security.vt.enabled": "true",
        "security.vt.apiKey": "key",
        "security.vt.threshold": "2",
      })
    );
    await expect(service.scan(filePath)).resolves.toEqual({ blocked: false });
  });

  it("blocks unknown hashes only when 'block unknown hashes' is enabled", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ status: 404, ok: false } as never);

    const permissive = new SecurityScanService(
      mockStorage({ "security.vt.enabled": "true", "security.vt.apiKey": "key" })
    );
    await expect(permissive.scan(filePath)).resolves.toEqual({ blocked: false });

    const strict = new SecurityScanService(
      mockStorage({
        "security.vt.enabled": "true",
        "security.vt.apiKey": "key",
        "security.vt.blockUnknownHashes": "true",
      })
    );
    const result = await strict.scan(filePath);
    expect(result.blocked).toBe(true);
    expect(result.source).toBe("virustotal");
  });

  it("fails open when VirusTotal errors out", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("network down"));
    const service = new SecurityScanService(
      mockStorage({ "security.vt.enabled": "true", "security.vt.apiKey": "key" })
    );
    await expect(service.scan(filePath)).resolves.toEqual({ blocked: false });
  });

  it("blocks when ClamAV reports an infection", async () => {
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = ["stream: Eicar-Test-Signature FOUND\0"];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(filePath);
    expect(result.blocked).toBe(true);
    expect(result.source).toBe("clamav");
    expect(result.reason).toContain("Eicar-Test-Signature");
  });

  it("does not block when ClamAV reports clean", async () => {
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = ["stream: OK\0"];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    await expect(service.scan(filePath)).resolves.toEqual({ blocked: false });
  });

  it("holds the download for review when ClamAV cannot be reached", async () => {
    vi.mocked(resolveSafeAddress).mockRejectedValue(new Error("unsafe host"));
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "evil" })
    );
    const result = await service.scan(filePath);
    expect(result).toMatchObject({ blocked: false, incomplete: true, source: "clamav" });
  });

  it("holds the download for review when the ClamAV socket errors mid-scan", async () => {
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.forceConnectError = "ECONNREFUSED";
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(filePath);
    expect(result).toMatchObject({ blocked: false, incomplete: true, source: "clamav" });
  });

  it("stops scanning a directory at the first ClamAV failure instead of retrying every file", async () => {
    const dir = path.join(tmpDir, "release-unreachable");
    fs.mkdirSync(dir);
    for (const name of ["a.bin", "b.bin", "c.bin"]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.forceConnectError = "ETIMEDOUT";
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(dir);
    expect(result).toMatchObject({ blocked: false, incomplete: true });
    expect(clamAvTestState.createdSockets).toHaveLength(1);
  });

  it("holds the download for review when clamd refuses a file and the rest are clean", async () => {
    const dir = path.join(tmpDir, "release-refused-clean");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.bin"), "x");
    fs.writeFileSync(path.join(dir, "b.bin"), "y");
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = ["RESET:INSTREAM size limit exceeded. ERROR\0", "stream: OK\0"];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(dir);
    expect(result).toMatchObject({ blocked: false, incomplete: true, source: "clamav" });
    expect(result.reason).toContain("1 file(s)");
    expect(result.reason).toContain("StreamMaxLength");
    expect(clamAvTestState.createdSockets).toHaveLength(2);
  });

  it("keeps scanning the other files when clamd refuses one file", async () => {
    const dir = path.join(tmpDir, "release-with-big-file");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.bin"), "x");
    fs.writeFileSync(path.join(dir, "b.bin"), "y");
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    // Whichever file is scanned first is refused; the other one is still checked.
    clamAvTestState.responseQueue = [
      "INSTREAM size limit exceeded. ERROR\0",
      "stream: Eicar-Test-Signature FOUND\0",
    ];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(dir);
    expect(result.blocked).toBe(true);
    expect(clamAvTestState.createdSockets).toHaveLength(2);
  });

  it("keeps scanning when clamd resets the connection after refusing an oversized file", async () => {
    const dir = path.join(tmpDir, "release-with-reset");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.bin"), "x");
    fs.writeFileSync(path.join(dir, "b.bin"), "y");
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = [
      "RESET:INSTREAM size limit exceeded. ERROR\0",
      "stream: Eicar-Test-Signature FOUND\0",
    ];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(dir);
    expect(result.blocked).toBe(true);
    expect(clamAvTestState.createdSockets).toHaveLength(2);
  });

  it("reports the download as incomplete once the total scan budget runs out", async () => {
    const dir = path.join(tmpDir, "release-slow-clamd");
    fs.mkdirSync(dir);
    for (const name of ["a.bin", "b.bin", "c.bin"]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = ["stream: OK\0", "stream: OK\0", "stream: OK\0"];
    // Each file takes longer than the whole budget, as with a slow but responsive clamd.
    let now = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      now += CLAMAV_TOTAL_SCAN_BUDGET_MS;
      return now;
    });
    try {
      const service = new SecurityScanService(
        mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
      );
      const result = await service.scan(dir);
      expect(result.blocked).toBe(false);
      expect(result.incomplete).toBe(true);
      expect(clamAvTestState.createdSockets.length).toBeLessThan(3);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("stops scanning when clamd closes the connection without a reply", async () => {
    const dir = path.join(tmpDir, "release-empty-reply");
    fs.mkdirSync(dir);
    for (const name of ["a.bin", "b.bin", "c.bin"]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = ["", "stream: OK\0", "stream: OK\0"];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(dir);
    expect(result).toMatchObject({ blocked: false, incomplete: true });
    expect(clamAvTestState.createdSockets).toHaveLength(1);
  });

  it("scans every file in a directory download", async () => {
    const dir = path.join(tmpDir, "release");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.bin"), "aaaa");
    fs.writeFileSync(path.join(dir, "b.bin"), "bbbb");
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = ["stream: OK\0", "stream: OK\0"];
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    await expect(service.scan(dir)).resolves.toEqual({ blocked: false });
    expect(clamAvTestState.createdSockets).toHaveLength(2);
  });

  it("scans and accepts a clean download with more than 100 files", async () => {
    const dir = path.join(tmpDir, "extracted-game");
    fs.mkdirSync(dir);
    for (let i = 0; i < 150; i++) {
      fs.writeFileSync(path.join(dir, `file-${i}.bin`), "x");
    }
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    clamAvTestState.responseQueue = Array.from({ length: 150 }, () => "stream: OK\0");
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    await expect(service.scan(dir)).resolves.toEqual({ blocked: false });
    expect(clamAvTestState.createdSockets).toHaveLength(150);
  });

  it("reports a directory past the scan cap as incomplete, not blocked", async () => {
    const dir = path.join(tmpDir, "huge-release");
    fs.mkdirSync(dir);
    // One more file than the cap so enumeration is truncated.
    for (let i = 0; i <= MAX_CLAMAV_SCAN_FILES; i++) {
      fs.writeFileSync(path.join(dir, `file-${i}.bin`), "x");
    }
    vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
    const service = new SecurityScanService(
      mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
    );
    const result = await service.scan(dir);
    expect(result.blocked).toBe(false);
    expect(result.incomplete).toBe(true);
    expect(result.source).toBe("clamav");
    // No file should have been scanned — a partial scan must never be
    // reported as "no infection found" instead of "not fully checked".
    expect(clamAvTestState.createdSockets).toHaveLength(0);
  });

  it("reports an unreadable subdirectory as incomplete rather than empty", async () => {
    const dir = path.join(tmpDir, "release-with-locked-subdir");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "readme.txt"), "hello");
    const lockedDir = path.join(dir, "payload");
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(path.join(lockedDir, "hidden.exe"), "x");

    const originalReaddir = fsExtra.readdir.bind(fsExtra);
    const readdirSpy = vi
      .spyOn(fsExtra, "readdir")
      .mockImplementation(async (dirPath: fs.PathLike, options?: unknown) => {
        if (dirPath === lockedDir) {
          const error = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        return (originalReaddir as (p: fs.PathLike, o?: unknown) => Promise<unknown>)(
          dirPath,
          options
        ) as never;
      });

    try {
      vi.mocked(resolveSafeAddress).mockResolvedValue({ address: "10.0.0.5", family: 4 });
      const service = new SecurityScanService(
        mockStorage({ "security.clamav.enabled": "true", "security.clamav.host": "clamav" })
      );
      const result = await service.scan(dir);
      expect(result.blocked).toBe(false);
      expect(result.incomplete).toBe(true);
      expect(result.source).toBe("clamav");
      // The unreadable subdirectory must never be silently treated as
      // empty — that would let a file hidden inside it bypass scanning.
      expect(clamAvTestState.createdSockets).toHaveLength(0);
    } finally {
      readdirSpy.mockRestore();
    }
  });
});
