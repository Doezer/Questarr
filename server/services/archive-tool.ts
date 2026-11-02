import { spawn } from "node:child_process";

const MAX_RECORD_BYTES = 64 * 1024;
const DIAGNOSTIC_TAIL_LENGTH = 4096;
const KILL_GRACE_MS = 1000;

export class ArchiveListingLimitError extends Error {}

export function runArchiveTool(
  binary: string,
  args: string[],
  label: string,
  options: { onRecord?: (record: string) => void; timeoutMs?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = (() => {
      try {
        return spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        throw new Error(`${label} failed: invalid archive tool invocation.`);
      }
    })();
    let failure: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let stdoutTail = "";
    let stderrTail = "";
    let pendingLine = "";
    let record = "";
    let recordBytes = 0;

    const fail = (error: unknown): void => {
      if (failure !== undefined) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timeout = setTimeout(
      () => fail(new Error(`${label} failed: timed out.`)),
      options.timeoutMs ?? 30 * 60_000
    );

    const emitRecord = (): void => {
      if (record) options.onRecord?.(record);
      record = "";
      recordBytes = 0;
    };
    const acceptLine = (line: string): void => {
      if (!line.trim()) {
        emitRecord();
      } else {
        record += line + "\n";
        recordBytes += Buffer.byteLength(line) + 1;
      }
    };
    const checkRecordSize = (): void => {
      if (recordBytes + Buffer.byteLength(pendingLine) > MAX_RECORD_BYTES) {
        throw new ArchiveListingLimitError(
          `Archive listing record exceeds the metadata limit (${MAX_RECORD_BYTES} bytes).`
        );
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutTail = (stdoutTail + chunk).slice(-DIAGNOSTIC_TAIL_LENGTH);
      if (!options.onRecord || failure !== undefined) return;
      try {
        let start = 0;
        let end: number;
        while ((end = chunk.indexOf("\n", start)) !== -1) {
          pendingLine += chunk.slice(start, end);
          checkRecordSize();
          acceptLine(pendingLine.replace(/\r$/, ""));
          pendingLine = "";
          start = end + 1;
        }
        pendingLine += chunk.slice(start);
        checkRecordSize();
      } catch (error) {
        fail(error);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-DIAGNOSTIC_TAIL_LENGTH);
    });
    child.stdout.on("error", () => fail(new Error(`${label} failed: stdout stream error.`)));
    child.stderr.on("error", () => fail(new Error(`${label} failed: stderr stream error.`)));
    child.on("error", (error: NodeJS.ErrnoException) => {
      // Node's error message can contain the password-bearing command line.
      fail(new Error(`${label} failed: ${error.code ?? "could not start archive tool"}.`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        let detail = (stderrTail || stdoutTail).trim();
        for (const arg of args) {
          if (arg.startsWith("-p") && arg.length > 2 && arg !== "-p-") {
            detail = detail.replaceAll(arg.slice(2), "[redacted]");
          }
        }
        reject(
          new Error(
            `${label} failed: ${signal ? `signal ${signal}` : `exit code ${code}`}${detail ? `: ${detail}` : ""}`
          )
        );
        return;
      }
      try {
        if (pendingLine) acceptLine(pendingLine.replace(/\r$/, ""));
        emitRecord();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}
