import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { probeRootFolder } from "../root-folders.js";

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
