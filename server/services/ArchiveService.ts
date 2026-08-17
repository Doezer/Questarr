import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import node7z from "node-7z";
const { extractFull, test: run7zTest } = node7z;
import pathTo7zip from "7zip-bin";
import fs from "fs-extra";
import { logger } from "../logger.js";

const sevenZipPath = pathTo7zip.path7za;

type ArchiveTool = "7za" | "bsdtar";
type ExecFileResult = { stdout: string; stderr: string };

const BSDTAR_TIMEOUT_MS = 30 * 60_000;
const BSDTAR_MAX_BUFFER = 10 * 1024 * 1024;

// A download client marking a transfer "complete" doesn't guarantee the file is fully
// synced/renamed into its final location yet — e.g. NFS/SMB write-back lag between the
// downloader's host and Questarr's, or a client doing a last move/rename right as the
// completion event fires. Reading the archive at that instant can see a truncated file,
// which surfaces as the exact same decode error a genuinely corrupt archive would produce.
// Retry the integrity test a couple of times with a short gap before concluding the archive
// itself is bad — cheap for a real failure (which fails fast, as seen in practice), and
// turns a spurious "corrupt" report into a successful import if it was just a timing race.
const ARCHIVE_TEST_MAX_ATTEMPTS = 3;
const ARCHIVE_TEST_RETRY_DELAYS_MS = [3_000, 8_000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Known absolute install locations for the bsdtar CLI (Alpine's `libarchive-tools` package).
// libarchive's RAR reader (archive_read_support_format_rar / _rar5) covers both legacy and
// RAR5 archives, including multi-volume sets, without needing the non-free RARLAB `unrar`
// binary — which is no longer available as an Alpine package at all. Resolving to a fixed,
// unwriteable path — rather than letting execFile search $PATH for a bare "bsdtar" command —
// avoids executing an attacker-controlled binary that could be placed earlier on the PATH.
// Mirrors server/apprise.ts's resolveAppriseBinary.
const BSDTAR_BINARY_CANDIDATES = ["/usr/bin/bsdtar", "/usr/local/bin/bsdtar"];

let cachedBsdtarBinary: string | null | undefined;

function resolveBsdtarBinary(): string | null {
  if (cachedBsdtarBinary !== undefined) {
    return cachedBsdtarBinary;
  }

  const candidates = process.env.BSDTAR_PATH
    ? [process.env.BSDTAR_PATH, ...BSDTAR_BINARY_CANDIDATES]
    : BSDTAR_BINARY_CANDIDATES;

  cachedBsdtarBinary =
    candidates.find((candidate) => {
      try {
        accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null;

  return cachedBsdtarBinary;
}

function resolveTool(filePath: string): ArchiveTool {
  return path.extname(filePath).toLowerCase() === ".rar" ? "bsdtar" : "7za";
}

// libarchive's RAR reader surfaces terse internal error strings — e.g. "Prefix found" is
// raised by its Huffman decode-tree builder (archive_read_support_format_rar.c) when it hits
// a leaf node while still expecting to descend further, which only happens when the archive's
// compressed data itself is malformed. That always means the RAR payload is corrupt or
// truncated (an incomplete/damaged download) — libarchive genuinely cannot decode it, so
// retrying extraction as-is will never succeed. Detect the marker and append an actionable
// hint rather than surfacing the bare libarchive wording, which reads as an internal bug.
const RAR_CORRUPTION_MARKER = "Prefix found";

// Marks errors that retrying can never fix (missing binary, unsupported format) so the
// integrity-test retry loop below can fail fast on them instead of burning several seconds
// re-running a check that will deterministically fail the same way every time.
class NonRetryableArchiveError extends Error {}

function runBsdtar(args: string[]): Promise<ExecFileResult> {
  const binary = resolveBsdtarBinary();
  if (!binary) {
    return Promise.reject(
      new NonRetryableArchiveError(
        "RAR archive detected but no bsdtar binary was found. Install libarchive-tools or set BSDTAR_PATH."
      )
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: "utf8",
        timeout: BSDTAR_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: BSDTAR_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Check the corruption marker against the full diagnostic before truncating —
          // bsdtar can write it to whichever stream isn't picked first, or past the 500-char
          // display limit, and a marker check against the already-truncated text would miss it.
          const diagnostic = [stderr, stdout, error.message].filter(Boolean).join("\n").trim();
          const detail = diagnostic.slice(0, 500);
          const hint = diagnostic.includes(RAR_CORRUPTION_MARKER)
            ? " (the RAR's compressed data is corrupt or incomplete — re-download the release, extraction cannot recover this file)"
            : "";
          reject(new Error(`bsdtar failed: ${detail}${hint}`));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export class ArchiveService {
  private testWith7z(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = run7zTest(filePath, { $bin: sevenZipPath });
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });
  }

  private async testArchive(filePath: string, tool: ArchiveTool): Promise<void> {
    logger.debug({ filePath, tool }, "Testing archive before extraction");

    let lastErr: unknown;
    for (let attempt = 1; attempt <= ARCHIVE_TEST_MAX_ATTEMPTS; attempt++) {
      try {
        if (tool === "bsdtar") {
          await runBsdtar(["-tf", filePath]);
        } else {
          await this.testWith7z(filePath);
        }
        if (attempt > 1) {
          logger.info({ filePath, tool, attempt }, "Archive test succeeded after retry");
        }
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof NonRetryableArchiveError) {
          throw err;
        }
        if (attempt < ARCHIVE_TEST_MAX_ATTEMPTS) {
          logger.warn(
            { err, filePath, tool, attempt },
            "Archive test failed — retrying in case the file is still settling on disk"
          );
          await delay(ARCHIVE_TEST_RETRY_DELAYS_MS[attempt - 1]);
          continue;
        }
        logger.error(
          { err, filePath, tool, attempts: attempt },
          "Archive test failed — archive will not be extracted"
        );
      }
    }
    throw lastErr;
  }

  private async listExtractedFiles(outputDir: string): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else {
          results.push(entryPath);
        }
      }
    };
    await walk(outputDir);
    return results;
  }

  private async extractWithBsdtar(filePath: string, outputDir: string): Promise<string[]> {
    await runBsdtar(["-xf", filePath, "-C", outputDir]);
    return this.listExtractedFiles(outputDir);
  }

  private extractWith7z(filePath: string, outputDir: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const extractedFiles: string[] = [];

      const stream = extractFull(filePath, outputDir, {
        $bin: sevenZipPath,
        $progress: true,
        recursive: true,
      });

      stream.on("data", (data: { status: string; file?: string }) => {
        // data.file is the relative path of the file being extracted
        if (data.status === "extracted" && data.file) {
          extractedFiles.push(path.join(outputDir, data.file));
        }
      });

      stream.on("end", () => resolve(extractedFiles));
      stream.on("error", (err: Error) => reject(err));
    });
  }

  /**
   * Extracts an archive to a specified output directory.
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @returns Paths of files reported as extracted.
   */
  async extract(filePath: string, outputDir: string): Promise<string[]> {
    const tool = resolveTool(filePath);
    logger.debug({ filePath, outputDir, tool }, "Extracting archive");

    // Validate before touching the filesystem, so a failing/unsupported archive never
    // leaves behind an empty output directory.
    await this.testArchive(filePath, tool);

    // Always start from an empty directory: a prior extraction attempt that was killed
    // before its own cleanup ran (e.g. a container restart) can leave stale files behind at
    // this same "<archive>_extracted" path, which would otherwise get reported alongside —
    // or instead of — the files this run actually extracts.
    await fs.emptyDir(outputDir);

    let extractedFiles: string[];
    try {
      extractedFiles =
        tool === "bsdtar"
          ? await this.extractWithBsdtar(filePath, outputDir)
          : await this.extractWith7z(filePath, outputDir);
    } catch (err) {
      logger.error({ err, filePath, tool }, "Extraction failed");
      throw err;
    }

    if (extractedFiles.length === 0) {
      logger.warn(
        { filePath, outputDir, tool },
        "Extraction reported success but produced no files — the archive format or contents may not be fully supported"
      );
    } else {
      logger.debug({ count: extractedFiles.length, tool }, "Extraction complete");
    }

    return extractedFiles;
  }

  isArchive(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".zip", ".7z", ".rar", ".gz", ".tar", ".iso", ".bz2"].includes(ext);
  }
}
