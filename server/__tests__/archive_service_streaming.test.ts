import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("ArchiveService streamed listings", () => {
  let directory: string;
  let binary: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "questarr-listing-"));
    binary = path.join(directory, "archive-tool");
    vi.stubEnv("SEVENZIP_PATH", binary);
    vi.stubEnv("UNRAR_PATH", binary);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function fixture(script: string) {
    await writeFile(binary, `#!${process.execPath}\n${script}`);
    await chmod(binary, 0o755);
    const { ArchiveService } = await import("../services/ArchiveService.js");
    return new ArchiveService();
  }

  it("lists over 10 MiB of valid 7-Zip metadata below the configured archive limits", async () => {
    const service = await fixture(`
      const { once } = require("node:events");
      (async () => {
        process.stdout.write("Path = game.zip\\nType = zip\\n\\n");
        for (let i = 0; i < 43462; i++) {
          const record = "Path = Game/file-" + i + ".bin\\nFolder = -\\nSize = 1024\\nComment = " + "x".repeat(256) + "\\n\\n";
          if (!process.stdout.write(record)) await once(process.stdout, "drain");
        }
      })();`);
    const entries = await service.listEntries("/downloads/game.zip");
    expect(entries).toHaveLength(43462);
    expect(entries[0]).toEqual({ name: "Game/file-0.bin", size: 1024 });
    expect(entries.at(-1)).toEqual({ name: "Game/file-43461.bin", size: 1024 });
  });

  it("preserves RAR split-volume continuations across chunk boundaries without dropping ordinary duplicates", async () => {
    const service = await fixture(`
      (async () => {
        for (const ratio of ["-->", "<->", "<--", "50%", "50%"]) {
          for (const line of ["Archive: volume.rar", "", "Name: Game/big.bin", "Type: File", "Size: 100", "Ratio: " + ratio, "", ""]) {
            process.stdout.write(line + "\\r\\n");
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      })();`);
    expect(await service.listEntries("/downloads/game.rar")).toEqual([
      { name: "Game/big.bin", size: 100 },
      { name: "Game/big.bin", size: 100 },
      { name: "Game/big.bin", size: 100 },
    ]);
  });

  it("refuses excess entries while listing and does not retry or start extraction", async () => {
    vi.stubEnv("ARCHIVE_MAX_ENTRIES", "2");
    const calls = path.join(directory, "calls");
    const destination = path.join(directory, "destination");
    const service = await fixture(`
      require("node:fs").appendFileSync(${JSON.stringify(calls)}, process.argv[2] + "\\n");
      process.stdout.write("Path = a\\nSize = 1\\n\\nPath = b\\nSize = 1\\n\\nPath = c\\nSize = 1\\n\\n");`);
    await expect(service.extract("/downloads/game.zip", destination)).rejects.toThrow(
      "too many entries (limit: 2)"
    );
    expect(await readFile(calls, "utf8")).toBe("l\n");
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not retry an oversized metadata record or create an extraction directory", async () => {
    const calls = path.join(directory, "calls");
    const destination = path.join(directory, "destination");
    const service = await fixture(`
      require("node:fs").appendFileSync(${JSON.stringify(calls)}, process.argv[2] + "\\n");
      process.stdout.write("Path = " + "x".repeat(65537));`);
    await expect(service.extract("/downloads/game.zip", destination)).rejects.toThrow(
      "record exceeds the metadata limit"
    );
    expect(await readFile(calls, "utf8")).toBe("l\n");
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds retained filename metadata independently of the configured entry limit", async () => {
    const service = await fixture(`
      const { once } = require("node:events");
      (async () => {
        for (let i = 0; i < 1100; i++) {
          if (!process.stdout.write("Path = " + "x".repeat(32768) + i + "\\nSize = 1\\n\\n")) await once(process.stdout, "drain");
        }
      })();`);
    await expect(service.listEntries("/downloads/game.zip")).rejects.toThrow(
      "names exceed the metadata limit"
    );
  });
});
