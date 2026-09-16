import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import fs from "fs-extra";
import { logger } from "../logger.js";

type ArchiveTool = "7zip" | "unrar";
type ExecFileResult = { stdout: string; stderr: string };

const EXEC_TIMEOUT_MS = 30 * 60_000;
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

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

// Marks errors that retrying can never fix (missing binary, unsupported format) so the
// integrity-test retry loop below can fail fast on them instead of burning several seconds
// re-running a check that will deterministically fail the same way every time.
class NonRetryableArchiveError extends Error {}

// A password-protected archive fails the exact same way every attempt — retrying it burns
// the same ~11s of delay as a genuinely corrupt archive for no benefit, and the generic
// "corrupt or incomplete, re-download" message this file's testArchive() throws afterward
// is actively wrong for this case (the archive is fine, it's just encrypted). Callers
// (ImportManager) catch this specifically to route the download to manual review with a
// password prompt instead of the generic failure message.
export class ArchivePasswordRequiredError extends Error {}

// Both unrar and 7-Zip mention "password" in every message they produce for an encrypted
// archive they can't read (unrar: e.g. a prompt-refusal or "wrong password" notice; 7-Zip:
// "Wrong password?"). Matching on the bare word "password" would also fire on a genuinely
// corrupt archive whose path/filename happens to contain it (e.g. "MyPasswordVault.rar"),
// since runTool's error text can include the file path — so this requires one of the actual
// diagnostic phrases both tools use for an encryption failure, not just the word appearing
// anywhere in the message.
function isPasswordProtectedError(message: string): boolean {
  return /wrong password|password protected|password is incorrect|password required|enter password/i.test(
    message
  );
}

// Resolves a CLI tool to a fixed, unwriteable absolute path — rather than letting execFile
// search $PATH for a bare command name — to avoid executing an attacker-controlled binary
// that could be placed earlier on the PATH. Mirrors server/apprise.ts's resolveAppriseBinary.
function makeBinaryResolver(envVar: string, candidates: string[]): () => string | null {
  let cached: string | null | undefined;
  return () => {
    if (cached !== undefined) {
      return cached;
    }
    // An explicit override replaces the built-in candidates entirely rather than adding to
    // them: if an operator points this at a specific binary, a typo'd or missing path should
    // fail loudly instead of silently falling back to a different tool they didn't ask for.
    const envPath = process.env[envVar];
    const searchList = envPath ? [envPath] : candidates;
    cached =
      searchList.find((candidate) => {
        try {
          accessSync(candidate, fsConstants.X_OK);
          return true;
        } catch {
          return false;
        }
      }) ?? null;
    return cached;
  };
}

// Alpine's `node:*-alpine` base is musl-libc only — it ships no
// /lib64/ld-linux-x86-64.so.2, so a glibc-linked binary (like the one the npm `7zip-bin`
// package bundles) can never execute there regardless of its permission bits; every attempt
// fails with ENOENT on the missing loader, not EACCES. Alpine's own `7zip` package (`apk add
// 7zip`) ships a musl-native build instead — command-line compatible with legacy 7za/7z — so
// resolve that on disk rather than depending on the npm package's binary.
const resolveSevenZipBinary = makeBinaryResolver("SEVENZIP_PATH", [
  "/usr/bin/7zz",
  "/usr/bin/7z",
  "/usr/lib/7zip/7zz",
]);

// Alpine dropped its own `unrar` package (RARLAB's license doesn't meet Alpine's packaging
// policy for main/community, even though it's free to use and redistribute), so this image
// bundles RARLAB's official Linux binary directly (see Dockerfile) rather than relying on an
// apk package. unrar reads legacy and RAR5 archives, including multi-volume sets — both
// classic `.rNN` and modern `.partN.rar` naming — automatically, as long as every volume
// sits alongside the base archive (which it does: they're all in the same download folder).
const resolveUnrarBinary = makeBinaryResolver("UNRAR_PATH", [
  "/usr/local/bin/unrar",
  "/usr/bin/unrar",
]);

function resolveTool(filePath: string): ArchiveTool {
  return path.extname(filePath).toLowerCase() === ".rar" ? "unrar" : "7zip";
}

function runTool(binary: string, args: string[], toolLabel: string): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: "utf8",
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: EXEC_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).trim().slice(0, 500);
          reject(new Error(`${toolLabel} failed: ${detail}`));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function runSevenZip(args: string[]): Promise<ExecFileResult> {
  const binary = resolveSevenZipBinary();
  if (!binary) {
    return Promise.reject(
      new NonRetryableArchiveError(
        "Archive extraction requires 7-Zip but no binary was found. Install the `7zip` apk package or set SEVENZIP_PATH."
      )
    );
  }
  return runTool(binary, args, "7-Zip");
}

function runUnrar(args: string[]): Promise<ExecFileResult> {
  const binary = resolveUnrarBinary();
  if (!binary) {
    return Promise.reject(
      new NonRetryableArchiveError(
        "RAR archive detected but no unrar binary was found. Install it (see Dockerfile) or set UNRAR_PATH."
      )
    );
  }
  return runTool(binary, args, "unrar");
}

export class ArchiveService {
  // -y: assume yes on any prompt; -p<password> supplies a password when one is given,
  // otherwise -p- refuses to prompt for one (fail instead of hanging on an encrypted
  // archive); --: end of switches, so a filename starting with "-" can't be parsed as a flag.
  private async runSingleTest(
    filePath: string,
    tool: ArchiveTool,
    password?: string
  ): Promise<void> {
    if (tool === "unrar") {
      await runUnrar(["t", "-y", password ? `-p${password}` : "-p-", "--", filePath]);
    } else {
      await runSevenZip(["t", "-y", ...(password ? [`-p${password}`] : []), "--", filePath]);
    }
  }

  // Some failures short-circuit the retry loop entirely because retrying can never change the
  // outcome: a missing binary won't appear, and a password-protected archive fails identically
  // every time. Both re-throw as a more specific error type for the caller; anything else
  // returns normally so testArchive's loop can retry it as a possible transient read.
  private classifyNonRetryableFailure(err: unknown, password?: string): void {
    if (err instanceof NonRetryableArchiveError) {
      throw err;
    }
    if (err instanceof Error && isPasswordProtectedError(err.message)) {
      throw new ArchivePasswordRequiredError(
        password
          ? "The provided password was rejected — it may be incorrect."
          : "This archive is password-protected — a password is required to extract it."
      );
    }
  }

  private async testArchive(filePath: string, tool: ArchiveTool, password?: string): Promise<void> {
    logger.debug({ filePath, tool, hasPassword: !!password }, "Testing archive before extraction");

    let lastErr: unknown;
    for (let attempt = 1; attempt <= ARCHIVE_TEST_MAX_ATTEMPTS; attempt++) {
      try {
        await this.runSingleTest(filePath, tool, password);
        if (attempt > 1) {
          logger.info({ filePath, tool, attempt }, "Archive test succeeded after retry");
        }
        return;
      } catch (err) {
        this.classifyNonRetryableFailure(err, password);
        lastErr = err;
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

    // By this point retries are exhausted, so a transient "still settling on disk" read is
    // ruled out — whatever's left genuinely can't be extracted (corrupt, truncated, or an
    // unsupported variant). Surface that plainly instead of the bare tool error text.
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(
      `${detail} (the archive is corrupt or incomplete — re-download the release, extraction cannot recover this file)`
    );
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

  private async extractWithUnrar(
    filePath: string,
    outputDir: string,
    password?: string
  ): Promise<string[]> {
    // Trailing separator tells unrar the operand is a destination directory. -idq suppresses
    // the per-file "Extracting..." progress output — without it, a large multi-file archive
    // can exceed execFile's maxBuffer and fail with ERR_CHILD_PROCESS_STDIO_MAXBUFFER after
    // extraction has already started.
    await runUnrar([
      "x",
      "-idq",
      "-y",
      password ? `-p${password}` : "-p-",
      "--",
      filePath,
      outputDir + path.sep,
    ]);
    return this.listExtractedFiles(outputDir);
  }

  private async extractWith7zip(
    filePath: string,
    outputDir: string,
    password?: string
  ): Promise<string[]> {
    // -bso0/-bsp0 silence 7-Zip's normal output and progress streams for the same
    // maxBuffer-overflow reason as unrar's -idq above.
    await runSevenZip([
      "x",
      "-bso0",
      "-bsp0",
      "-y",
      ...(password ? [`-p${password}`] : []),
      `-o${outputDir}`,
      "--",
      filePath,
    ]);
    return this.listExtractedFiles(outputDir);
  }

  /**
   * Extracts an archive to a specified output directory.
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @param password Password to supply for an encrypted archive. Omit for an unencrypted
   *   one; if the archive turns out to require one, `extract` rejects with
   *   {@link ArchivePasswordRequiredError} rather than the generic corruption message.
   * @returns Paths of files reported as extracted.
   */
  async extract(filePath: string, outputDir: string, password?: string): Promise<string[]> {
    const tool = resolveTool(filePath);
    logger.debug({ filePath, outputDir, tool, hasPassword: !!password }, "Extracting archive");

    // Validate before touching the filesystem, so a failing/unsupported archive never
    // leaves behind an empty output directory.
    await this.testArchive(filePath, tool, password);

    // Always start from an empty directory: a prior extraction attempt that was killed
    // before its own cleanup ran (e.g. a container restart) can leave stale files behind at
    // this same "<archive>_extracted" path, which would otherwise get reported alongside —
    // or instead of — the files this run actually extracts.
    await fs.emptyDir(outputDir);

    let extractedFiles: string[];
    try {
      extractedFiles =
        tool === "unrar"
          ? await this.extractWithUnrar(filePath, outputDir, password)
          : await this.extractWith7zip(filePath, outputDir, password);
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
