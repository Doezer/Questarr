import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadStatus } from "../../shared/schema.js";
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

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

/**
 * Answers a 429 by waiting (the server's Retry-After, else an exponential backoff) and sending
 * again, up to `maxRetries` times. Refused calls count against the provider's budget, so this
 * backs off instead of hammering. `beforeRetry` runs after the wait (e.g. to pace the next call).
 */
export async function retryOnRateLimit(
  first: Response,
  send: () => Promise<Response>,
  options: {
    signal?: AbortSignal | undefined;
    baseDelayMs: number;
    maxRetries: number;
    beforeRetry?: () => Promise<void>;
  }
): Promise<Response> {
  let response = first;
  for (let retry = 1; response.status === 429 && retry <= options.maxRetries; retry++) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : options.baseDelayMs * 2 ** (retry - 1);
    await response.body?.cancel().catch(() => undefined);
    await sleep(wait, options.signal);
    await options.beforeRetry?.();
    response = await send();
  }
  return response;
}

/**
 * The staging folder of one item: `<root>/<id>`. Ids must match `idPattern`, and the result can
 * never leave the staging root.
 */
export function resolveStagingDir(
  stagingRoot: string,
  id: string,
  idPattern: RegExp,
  label: string
): string {
  if (!idPattern.test(id)) throw new Error(`Invalid ${label} torrent id`);
  const root = path.resolve(stagingRoot);
  const dir = path.resolve(root, id);
  if (!dir.startsWith(root + path.sep)) {
    throw new Error("Staging folder escapes the staging path");
  }
  return dir;
}

/** Whether every file of the item has been copied (the completion marker exists). */
export async function hasStagingMarker(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, STAGING_MARKER));
    return true;
  } catch {
    return false;
  }
}

/** Publishes completion: drops the temp folder, writes the marker, forgets the job. */
export async function finishStaging(
  dir: string,
  downloaderId: string,
  id: string,
  marker: Record<string, unknown>
): Promise<void> {
  await fs.rm(path.join(dir, TEMP_DIR), { recursive: true, force: true });
  await fs.writeFile(
    path.join(dir, STAGING_MARKER),
    JSON.stringify({ ...marker, stagedAt: new Date().toISOString() })
  );
  stagingJobs.delete(jobKey(downloaderId, id));
}

/** The "second half" of the progress bar: what a running copy reports. */
export function stagingProgress(job: StagingJob) {
  const fraction = job.bytesTotal > 0 ? Math.min(1, job.bytesDone / job.bytesTotal) : 0;
  const elapsed = Math.max(1, (Date.now() - job.startedAt) / 1000);
  const speed = job.bytesDone / elapsed;
  return {
    progress: Math.min(99, 50 + Math.round(fraction * 50)),
    downloaded: job.bytesDone,
    downloadSpeed: Math.round(speed),
    eta: speed > 0 ? Math.round((job.bytesTotal - job.bytesDone) / speed) : undefined,
  };
}

/**
 * Removes an item: reserves its job key before the first await (even when nothing is running) so
 * an overlapping status poll can't start a copy while it is torn down, stops an active copy, then
 * runs `cleanup`. The key stays reserved until cleanup is done.
 */
export async function removeWithCleanup(
  downloaderId: string,
  id: string,
  cleanup: () => Promise<void>
): Promise<{ success: boolean; message: string }> {
  const key = jobKey(downloaderId, id);
  const job: StagingJob = stagingJobs.get(key) ?? {
    state: "running",
    bytesDone: 0,
    bytesTotal: 0,
    startedAt: Date.now(),
    attempts: 0,
    cancelled: true,
    abort: new AbortController(),
    done: Promise.resolve(),
  };
  stagingJobs.set(key, job);
  try {
    job.cancelled = true;
    job.abort.abort();
    await job.done;
    await cleanup();
    return { success: true, message: "Download removed" };
  } catch (error) {
    return { success: false, message: `Failed to remove download: ${getErrorMessage(error)}` };
  } finally {
    stagingJobs.delete(key);
  }
}

/** Free bytes on the staging volume, 0 when it cannot be read. */
export async function stagingFreeSpace(root: string): Promise<number> {
  try {
    const stats = await fs.statfs(root);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return 0;
  }
}

/** Ids (download hashes) Questarr itself is tracking on this downloader. */
export async function trackedDownloadIds(downloaderId: string): Promise<Set<string>> {
  // Imported lazily: storage pulls in the whole database layer.
  const { storage } = await import("../storage.js");
  const rows = await storage.getDownloadingGameDownloads();
  return new Set(
    rows.filter((row) => row.downloaderId === downloaderId).map((row) => row.downloadHash)
  );
}

/**
 * Status of an item the provider has finished fetching: completed once it is staged locally,
 * otherwise the state of the local copy (started on first call, retried with a backoff after a
 * failure, an error only once the attempts are used up).
 */
export async function stagedStatus(
  base: Omit<DownloadStatus, "status" | "progress">,
  item: {
    size: number;
    tracked: boolean;
    isStaged: () => Promise<boolean>;
    startStaging: () => StagingJob;
  }
): Promise<DownloadStatus> {
  if (await item.isStaged()) {
    return { ...base, status: "completed", progress: 100, downloaded: item.size };
  }
  // The account may hold items Questarr never added: never copy those on its own.
  if (!item.tracked) return { ...base, status: "paused", progress: 50 };
  const job = item.startStaging();
  if (job.state === "failed" && job.attempts >= MAX_STAGING_ATTEMPTS) {
    return { ...base, status: "error", progress: 50, error: job.error ?? "Staging failed" };
  }
  return { ...base, status: "downloading", ...stagingProgress(job) };
}
