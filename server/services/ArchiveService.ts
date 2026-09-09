import node7z from "node-7z";
const { extractFull } = node7z;
import pathTo7zip from "7zip-bin";
import fs from "fs-extra";
import path from "node:path";
import { logger } from "../logger.js";

const sevenZipPath = pathTo7zip.path7za;

/**
 * Error thrown when an extraction exceeds the allowed timeout.
 * Used by the retry loop to distinguish timeouts from fatal errors.
 */
export class ExtractionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionTimeoutError";
  }
}

/** Default timeout: 60 seconds — if unrar/7zip hangs longer than this, restart. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Default max retries after a timeout (single restart). */
const DEFAULT_MAX_RETRIES = 1;

export interface ExtractOptions {
  /** Milliseconds before a hanging extraction is killed and restarted. Default 60_000. */
  timeoutMs?: number;
  /** Number of times to restart after a timeout. Default 1. */
  maxRetries?: number;
}

export class ArchiveService {
  /**
   * Extracts an archive to a specified output directory.
   * If extraction takes longer than `timeoutMs`, the 7zip process is killed
   * and the extraction is restarted (up to `maxRetries` times).
   *
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @param options Timeout and retry configuration.
   * @returns Paths of files reported as extracted by 7zip (constructed from event data).
   */
  async extract(
    filePath: string,
    outputDir: string,
    options: ExtractOptions = {}
  ): Promise<string[]> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.extractOnce(filePath, outputDir, timeoutMs);
      } catch (err) {
        if (err instanceof ExtractionTimeoutError && attempt < maxRetries) {
          logger.warn(
            { filePath, attempt: attempt + 1, timeoutMs },
            "Extraction timed out — restarting"
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    // All retries exhausted — rethrow the last timeout error.
    throw lastError;
  }

  /**
   * Single extraction attempt with a hard timeout.
   * If the timeout fires before "end" or "error", the child process is
   * killed (process group SIGKILL) and an ExtractionTimeoutError is thrown.
   */
  private async extractOnce(
    filePath: string,
    outputDir: string,
    timeoutMs: number
  ): Promise<string[]> {
    logger.debug({ filePath, outputDir }, "Extracting archive");

    await fs.ensureDir(outputDir);

    return new Promise((resolve, reject) => {
      const extractedFiles: string[] = [];

      const stream = extractFull(filePath, outputDir, {
        $bin: sevenZipPath,
        $progress: true,
        recursive: true,
      });

      let timeoutId: NodeJS.Timeout | undefined;
      let completed = false;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      // Hard timeout: if extraction hasn't finished by now, kill + reject.
      timeoutId = setTimeout(() => {
        if (completed) return;
        completed = true;

        this.killExtraction(stream);
        cleanup();

        reject(new ExtractionTimeoutError(`Extraction timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      stream.on("data", (data: { status: string; file?: string }) => {
        if (data.status === "extracted" && data.file) {
          extractedFiles.push(path.join(outputDir, data.file));
        }
      });

      stream.on("end", () => {
        if (completed) return;
        completed = true;
        cleanup();

        logger.debug({ count: extractedFiles.length }, "Extraction complete");
        resolve(extractedFiles);
      });

      stream.on("error", (err: Error) => {
        if (completed) return;
        completed = true;
        cleanup();

        logger.error({ err }, "Extraction failed");
        reject(err);
      });
    });
  }

  /**
   * Kills the 7zip child process spawned by node-7z.
   * Attempts a process-group kill first (the process is spawned detached),
   * falling back to a direct child.kill() if that fails.
   */
  private killExtraction(stream: NodeJS.ReadableStream): void {
    const child = (
      stream as unknown as { _childProcess?: { pid: number; kill: (signal?: string) => void } }
    )._childProcess;

    if (!child) {
      logger.warn("No child process found on extraction stream — cannot kill");
      return;
    }

    try {
      // node-7z spawns with detached: true, so the child leads its own process
      // group. Killing the group (-pid) takes down spawned helpers like unrar.
      process.kill(-child.pid, "SIGKILL");
      logger.debug({ pid: child.pid }, "Killed extraction process group");
    } catch {
      // Fallback: kill just the child process itself.
      child.kill("SIGKILL");
      logger.debug({ pid: child.pid }, "Killed extraction child process");
    }
  }

  isArchive(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".zip", ".7z", ".rar", ".gz", ".tar", ".iso", ".bz2"].includes(ext);
  }
}
