import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { ImportOperationRegistry } from "../services/ImportOperations.js";
import { computeFileSha256 } from "../security-scan.js";

describe("ImportOperationRegistry", () => {
  afterEach(() => vi.useRealTimers());

  it("tracks phase and bytes, resetting bytes when the phase changes", () => {
    const registry = new ImportOperationRegistry();
    const op = registry.create("dl-1", "u1");
    const progress = registry.progressFor(op.id);

    progress.setPhase("hashing");
    progress.setBytes(10, 100);
    expect(registry.get(op.id)).toMatchObject({
      phase: "hashing",
      bytesProcessed: 10,
      bytesTotal: 100,
    });

    progress.setPhase("extracting");
    expect(registry.get(op.id)).toMatchObject({ phase: "extracting", bytesProcessed: null });
  });

  it("scopes lookups to the owning user", () => {
    const registry = new ImportOperationRegistry();
    const op = registry.create("dl-1", "u1");
    expect(registry.get(op.id, "u1")?.id).toBe(op.id);
    expect(registry.get(op.id, "u2")).toBeUndefined();
    expect(registry.latestForDownload("dl-1", "u2")).toBeUndefined();
  });

  it("ignores progress updates once finished and records failure flags", () => {
    const registry = new ImportOperationRegistry();
    const op = registry.create("dl-1", "u1");
    registry.fail(op.id, "boom", { passwordRequired: true });
    registry.progressFor(op.id).setPhase("hashing");
    expect(registry.get(op.id)).toMatchObject({
      status: "failed",
      phase: "failed",
      error: "boom",
      passwordRequired: true,
      incompleteScan: false,
    });
  });

  it("returns the most recent operation for a download and prunes old finished ones", () => {
    vi.useFakeTimers();
    const registry = new ImportOperationRegistry();
    const first = registry.create("dl-1", "u1");
    registry.complete(first.id);
    vi.advanceTimersByTime(1000);
    const second = registry.create("dl-1", "u1");
    expect(registry.latestForDownload("dl-1", "u1")?.id).toBe(second.id);

    registry.complete(second.id);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(registry.latestForDownload("dl-1", "u1")).toBeUndefined();
  });
});

describe("computeFileSha256 progress", () => {
  it("reports cumulative bytes read up to the file size", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hash-progress-"));
    const file = path.join(dir, "data.bin");
    await fs.writeFile(file, Buffer.alloc(300_000, 1));
    const reads: number[] = [];
    const totals: Array<number | null> = [];
    const hash = await computeFileSha256(file, (n, total) => {
      reads.push(n);
      totals.push(total);
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.at(-1)).toBe(300_000);
    expect([...reads].sort((a, b) => a - b)).toEqual(reads);
    expect(totals.at(-1)).toBe(300_000);
    await fs.remove(dir);
  });
});
