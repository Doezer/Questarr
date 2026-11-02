import { describe, expect, it } from "vitest";
import {
  ArchiveListingLimitError,
  ArchiveToolPasswordError,
  runArchiveTool,
} from "../services/archive-tool.js";

function runScript(
  script: string,
  options: Parameters<typeof runArchiveTool>[3] = {}
): Promise<void> {
  return runArchiveTool(process.execPath, ["-e", script], "fixture", options);
}

describe("streaming archive tools", () => {
  it("decodes split UTF-8 characters, CRLF and whitespace separators, and a final record without a newline", async () => {
    const records: string[] = [];
    await runScript(
      `const data = Buffer.from("Path = café\\r\\nSize = 1\\r\\n \\r\\nPath = final\\nSize = 2");
       (async () => {
         for (const byte of data) {
           process.stdout.write(Buffer.from([byte]));
           await new Promise(resolve => setTimeout(resolve, 1));
         }
       })();`,
      { onRecord: (record) => records.push(record) }
    );
    expect(records).toEqual(["Path = café\nSize = 1\n", "Path = final\nSize = 2\n"]);
  });

  it("drains large test/extraction output without buffering it", async () => {
    await expect(
      runScript(`for (let i = 0; i < 200; i++) process.stdout.write("x".repeat(65536));`)
    ).resolves.toBeUndefined();
  });

  it.each([
    'process.stdout.write("x".repeat(65537));',
    'for (let i = 0; i < 10000; i++) process.stdout.write("Size = 1\\n");',
  ])("refuses an oversized listing record, including unterminated output", async (script) => {
    await expect(runScript(script, { onRecord: () => {} })).rejects.toThrow(
      ArchiveListingLimitError
    );
  });

  it("retains the exit code and bounded diagnostic tail instead of the listing header", async () => {
    const error = await runScript(
      `process.stdout.write("HEADER\\n" + "x".repeat(12 * 1024 * 1024));
       process.stderr.write("y".repeat(12000) + "\\nUnexpected end of archive");
       process.exitCode = 2;`
    ).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("exit code 2");
    expect((error as Error).message).toContain("Unexpected end of archive");
    expect((error as Error).message).not.toContain("HEADER");
    expect((error as Error).message.length).toBeLessThan(4200);
  });

  it("does not include command arguments or supplied passwords in subprocess errors", async () => {
    await expect(
      runArchiveTool("/definitely/missing/archive-tool", ["-pprivate-password"], "fixture")
    ).rejects.toThrow("fixture failed: ENOENT");
    const error = await runArchiveTool(
      process.execPath,
      [
        "-e",
        'process.stderr.write("Wrong password: private-password"); process.exitCode = 2;',
        "--",
        "-pprivate-password",
      ],
      "fixture"
    ).catch((error: Error) => error);
    expect((error as Error).message).toContain("Wrong password: [redacted]");
    expect((error as Error).message).not.toContain("private-password");
    const invalidArgument = await runArchiveTool(
      process.execPath,
      ["-pprivate-password\0"],
      "fixture"
    ).catch((error: Error) => error);
    expect((invalidArgument as Error).message).toContain("invalid archive tool invocation");
    expect((invalidArgument as Error).message).not.toContain("private-password");
  });

  it.each(["password", "pass", "word", "a"])(
    "classifies password failures before redacting '%s' from diagnostics",
    async (password) => {
      const error = await runArchiveTool(
        process.execPath,
        [
          "-e",
          'process.stderr.write("Wrong password?"); process.exitCode = 2;',
          "--",
          `-p${password}`,
        ],
        "fixture"
      ).catch((error: Error) => error);
      expect(error).toBeInstanceOf(ArchiveToolPasswordError);
      expect((error as Error).message).toContain("[redacted]");
      expect((error as Error).message).not.toContain("Wrong password?");
      expect(error).not.toHaveProperty("rawDetail");
    }
  );

  it.each(["password required.txt", "wrong password.txt", "enter password.txt"])(
    "does not classify the listing filename '%s' as a password failure",
    async (name) => {
      const records: string[] = [];
      const error = await runScript(
        `process.stdout.write(${JSON.stringify("Path = ")} + ${JSON.stringify(name)} + "\\nSize = 1\\n\\n"); process.exitCode = 2;`,
        { onRecord: (record) => records.push(record) }
      ).catch((error: Error) => error);
      expect(records).toHaveLength(1);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ArchiveToolPasswordError);
      expect((error as Error).message).toContain(name);
    }
  );

  it.each([false, true])(
    "preserves real stderr password failures with record parsing %s",
    async (parseRecords) => {
      await expect(
        runScript(
          'process.stderr.write("Wrong password?"); process.exitCode = 2;',
          parseRecords ? { onRecord: () => {} } : {}
        )
      ).rejects.toBeInstanceOf(ArchiveToolPasswordError);
    }
  );

  it("preserves stdout password diagnostics for commands without listing records", async () => {
    await expect(
      runScript('process.stdout.write("Wrong password?"); process.exitCode = 2;')
    ).rejects.toBeInstanceOf(ArchiveToolPasswordError);
  });

  it("reaps a child that ignores SIGTERM when the record consumer refuses it", async () => {
    let pid: number | undefined;
    const refusal = new Error("unsafe listing");
    await expect(
      runScript(
        `process.on("SIGTERM", () => {});
         process.stdout.write(String(process.pid) + "\\n\\n");
         setInterval(() => {}, 1000);`,
        {
          onRecord: (record) => {
            pid = Number(record.trim());
            throw refusal;
          },
        }
      )
    ).rejects.toBe(refusal);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it("times out and reaps an unresponsive child", async () => {
    let pid: number | undefined;
    await expect(
      runScript(
        `process.on("SIGTERM", () => {});
         process.stdout.write(String(process.pid) + "\\n\\n");
         setInterval(() => {}, 1000);`,
        {
          timeoutMs: 500,
          onRecord: (record) => {
            pid = Number(record.trim());
          },
        }
      )
    ).rejects.toThrow("fixture failed: timed out.");
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid!, 0)).toThrow();
  });
});
