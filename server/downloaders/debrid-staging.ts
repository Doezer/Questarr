import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadersLogger } from "../logger.js";
import { safeFetch } from "../ssrf.js";
import { DOWNLOAD_CLIENT_USER_AGENT, getErrorMessage } from "./utils.js";

// Shared by the cloud ("debrid") downloaders: the provider fetches the files on its servers, then
// they are copied over HTTPS into `<staging path>/<id>/` and only reported as completed once every
// file is on disk, so the regular import pipeline sees ordinary local files.

/** Written into a staged torrent's folder once every file has been fetched. */
export const STAGING_MARKER = ".questarr-staged";
export const TEMP_DIR = ".questarr-tmp";
export const STAGING_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export interface StagingJob {
  state: "running" | "failed";
  bytesDone: number;
  bytesTotal: number;
  startedAt: number;
  attempts: number;
  failedAt?: number;
  error?: string;
  /** Direct-link jobs: parts fetched so far, and the byte count/size of the part in flight. */
  partsDone?: number;
  partBase?: number;
  partSize?: number;
  /** Set by removeDownload: the job is being torn down and must not restart. */
  cancelled: boolean;
  abort: AbortController;
  /** Settles (never rejects) once the copy has stopped. */
  done: Promise<void>;
}

export const MAX_STAGING_ATTEMPTS = 5;
/** Wait before retry n (1-based): 1, 2, 4... minutes, capped at 10. */
export const retryDelayMs = (attempts: number) => Math.min(10, 2 ** (attempts - 1)) * 60_000;

// Staging outlives any one client instance (the manager builds a fresh client per call),
// so progress is tracked per process, keyed by downloader and torrent.
export const stagingJobs = new Map<string, StagingJob>();

export const jobKey = (downloaderId: string, torrentId: string) => `${downloaderId}:${torrentId}`;

/** Makes one path segment safe to create on disk. */
export function sanitizeSegment(segment: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = segment.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return cleaned === "." || cleaned === ".." ? "_" : cleaned;
}

/**
 * Splits a Real-Debrid path ("/Folder/file.bin") into safe relative segments. Names starting
 * with ".questarr-" are reserved for the completion marker and temp folder, so a payload file
 * can never be mistaken for them.
 */
export function toSafeSegments(rawPath: string): string[] {
  const segments = rawPath
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map(sanitizeSegment);
  if (segments[0]?.toLowerCase().startsWith(".questarr-")) segments[0] = `_${segments[0]}`;
  return segments;
}

/**
 * One distinct, safe relative path per selected file, in the same order. Paths that collide
 * once sanitized (compared case-insensitively, as the staging folder may live on a
 * case-insensitive filesystem) get a numeric suffix. Staging and the advertised file list
 * both use this, so they always agree.
 */
export function resolveStagedPaths(rawPaths: string[]): string[][] {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const key = (segments: string[], length = segments.length) =>
    segments.slice(0, length).join("/").toLowerCase();

  /** Index of the first segment that clashes with an earlier file or folder, or -1. */
  const conflictIndex = (segments: string[]): number => {
    for (let i = 1; i < segments.length; i++) {
      if (files.has(key(segments, i))) return i - 1; // a parent folder is already a file
    }
    const full = key(segments);
    return files.has(full) || dirs.has(full) ? segments.length - 1 : -1;
  };

  return rawPaths.map((raw, index) => {
    let segments = toSafeSegments(raw);
    if (segments.length === 0) segments = [`file-${index + 1}`];
    const original = segments;
    for (let guard = 0; guard < 1000; guard++) {
      const at = conflictIndex(segments);
      if (at < 0) break;
      // Always rename from the original name so suffixes never pile up ("a (2) (3).bin").
      const { name, ext } = path.parse(original[at] ?? "");
      segments = segments.map((segment, i) =>
        i === at ? `${name} (${guard + 2})${ext}` : segment
      );
    }
    // The last candidate is never re-checked by the loop above: refuse it rather than let two
    // files share a path (the second would be skipped as "already copied").
    if (conflictIndex(segments) >= 0) {
      throw new Error(`Could not find a unique local name for Real-Debrid file "${raw}"`);
    }
    files.add(key(segments));
    for (let i = 1; i < segments.length; i++) dirs.add(key(segments, i));
    return segments;
  });
}

/**
 * Starts (or, after a failure, retries with a backoff) the copy of one remote item. A running
 * or exhausted job is returned as is. Retrying resumes: files already fully copied are skipped
 * by copyRemoteFile.
 */
export function beginStagingJob(input: {
  downloaderId: string;
  id: string;
  bytesTotal: number;
  run: (job: StagingJob) => Promise<void>;
  /** Provider name used in log lines. */
  label: string;
}): StagingJob {
  const { downloaderId, id, bytesTotal, run, label } = input;
  const key = jobKey(downloaderId, id);
  const existing = stagingJobs.get(key);
  if (existing) {
    if (existing.cancelled) return existing;
    const retryable =
      existing.state === "failed" &&
      existing.attempts < MAX_STAGING_ATTEMPTS &&
      Date.now() - (existing.failedAt ?? 0) >= retryDelayMs(existing.attempts);
    if (!retryable) return existing;
  }

  const job: StagingJob = {
    state: "running",
    bytesDone: 0,
    bytesTotal,
    startedAt: Date.now(),
    attempts: (existing?.attempts ?? 0) + 1,
    cancelled: false,
    abort: new AbortController(),
    done: Promise.resolve(),
  };
  stagingJobs.set(key, job);
  job.done = run(job).catch((error) => {
    if (job.cancelled) return;
    job.state = "failed";
    job.failedAt = Date.now();
    job.error = getErrorMessage(error);
    downloadersLogger.error({ error, downloaderId, torrentId: id }, `${label} staging failed`);
  });
  return job;
}

/**
 * Copies one remote file to `target` through a temp file (kept outside the payload namespace),
 * skipping a file that is already there with the right size. A short copy is an error: a partial
 * file must never be renamed into place.
 */
export async function copyRemoteFile(
  file: { url: string; size: number; label: string },
  target: string,
  dir: string,
  job: StagingJob
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await fs.stat(target).catch(() => null);
  if (existing && existing.size === file.size) {
    job.bytesDone += existing.size;
    return;
  }

  const response = await safeFetch(file.url, {
    headers: { "User-Agent": DOWNLOAD_CLIENT_USER_AGENT },
    requireHttps: true,
    timeoutMs: STAGING_TIMEOUT_MS,
    signal: job.abort.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`${file.label} file download failed (HTTP ${response.status})`);
  }

  const tempDir = path.join(dir, TEMP_DIR);
  await fs.mkdir(tempDir, { recursive: true });
  const partial = path.join(tempDir, randomUUID());
  let copied = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      copied += chunk.length;
      job.bytesDone += chunk.length;
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      counter,
      createWriteStream(partial, { flags: "wx" }),
      { signal: job.abort.signal }
    );
    if (file.size > 0 && copied !== file.size) {
      throw new Error(`Incomplete copy of ${path.basename(target)}: ${copied}/${file.size} bytes`);
    }
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
}
