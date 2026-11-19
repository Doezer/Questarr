import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import { safeFetch } from "../ssrf.js";
import {
  parseRealDebridCredentials,
  refreshRealDebridToken,
  serializeRealDebridCredentials,
  REAL_DEBRID_API_BASE,
  type RealDebridCredentials,
} from "./realdebrid-auth.js";
import type {
  DownloadRequest,
  DownloadResult,
  DownloaderActionResult,
  DownloaderClient,
} from "./types.js";
import {
  DOWNLOAD_CLIENT_USER_AGENT,
  fetchWithMagnetDetection,
  findTorrentByTagNull,
  getErrorMessage,
} from "./utils.js";

/** Written into a staged torrent's folder once every file has been fetched. */
export const STAGING_MARKER = ".questarr-staged";
const TEMP_DIR = ".questarr-tmp";
const REFRESH_MARGIN_MS = 60_000;
const STAGING_TIMEOUT_MS = 6 * 60 * 60 * 1000;

interface RealDebridTorrent {
  id: string;
  filename: string;
  original_filename?: string;
  hash?: string;
  bytes: number;
  original_bytes?: number;
  progress: number;
  status: string;
  added?: string;
  ended?: string;
  speed?: number;
  seeders?: number;
  files?: Array<{ id: number; path: string; bytes: number; selected: number }>;
  links?: string[];
}

interface UnrestrictedLink {
  filename: string;
  filesize: number;
  download: string;
}

interface StagingJob {
  state: "running" | "failed";
  bytesDone: number;
  bytesTotal: number;
  startedAt: number;
  attempts: number;
  failedAt?: number;
  error?: string;
  /** Set by removeDownload: the job is being torn down and must not restart. */
  cancelled: boolean;
  abort: AbortController;
  /** Settles (never rejects) once the copy has stopped. */
  done: Promise<void>;
}

const MAX_STAGING_ATTEMPTS = 5;
/** Wait before retry n (1-based): 1, 2, 4... minutes, capped at 10. */
const retryDelayMs = (attempts: number) => Math.min(10, 2 ** (attempts - 1)) * 60_000;

// Staging outlives any one client instance (the manager builds a fresh client per call),
// so progress is tracked per process, keyed by downloader and torrent.
const stagingJobs = new Map<string, StagingJob>();

const jobKey = (downloaderId: string, torrentId: string) => `${downloaderId}:${torrentId}`;

/** Makes one path segment safe to create on disk. */
function sanitizeSegment(segment: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = segment.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return cleaned === "." || cleaned === ".." ? "_" : cleaned;
}

/**
 * Splits a Real-Debrid path ("/Folder/file.bin") into safe relative segments. Names starting
 * with ".questarr-" are reserved for the completion marker and temp folder, so a payload file
 * can never be mistaken for them.
 */
function toSafeSegments(rawPath: string): string[] {
  const segments = rawPath
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map(sanitizeSegment);
  if (segments[0]?.startsWith(".questarr-")) segments[0] = `_${segments[0]}`;
  return segments;
}

function selectedFiles(torrent: RealDebridTorrent) {
  return (torrent.files ?? []).filter((file) => file.selected === 1);
}

/**
 * Real-Debrid downloader. The torrent is fetched by Real-Debrid's servers; once it reports
 * "downloaded", the files are copied over HTTPS into `<downloadPath>/<torrent id>/` and only
 * then reported as completed, so the regular import pipeline sees ordinary local files.
 */
export class RealDebridClient implements DownloaderClient {
  private credentials: RealDebridCredentials | null;

  constructor(private readonly downloader: Downloader) {
    this.credentials = parseRealDebridCredentials(downloader.password);
  }

  // -- HTTP ---------------------------------------------------------------

  private async persistCredentials(
    previous: RealDebridCredentials,
    credentials: RealDebridCredentials
  ): Promise<void> {
    this.credentials = credentials;
    try {
      // Imported lazily: storage pulls in the whole database layer.
      const { storage } = await import("../storage.js");
      // A reconnect may have stored new credentials while this refresh was in flight:
      // never overwrite those with a token derived from the old connection.
      const stored = parseRealDebridCredentials(
        (await storage.getDownloader(this.downloader.id))?.password
      );
      if (stored && stored.accessToken !== previous.accessToken) {
        this.credentials = stored;
        return;
      }
      await storage.updateDownloader(this.downloader.id, {
        password: serializeRealDebridCredentials(credentials),
      });
    } catch (error) {
      downloadersLogger.warn(
        { error, downloaderId: this.downloader.id },
        "Could not save the refreshed Real-Debrid token"
      );
    }
  }

  private async refresh(): Promise<void> {
    if (!this.credentials) throw new Error("Real-Debrid is not connected");
    const previous = this.credentials;
    await this.persistCredentials(previous, await refreshRealDebridToken(previous));
  }

  private async api(
    pathname: string,
    init: RequestInit = {},
    options: { allowStatus?: number[] } = {}
  ): Promise<Response> {
    if (!this.credentials) {
      throw new Error("Real-Debrid is not connected. Authorize the account first.");
    }
    if (
      this.credentials.expiresAt !== undefined &&
      this.credentials.expiresAt - REFRESH_MARGIN_MS < Date.now() &&
      this.credentials.refreshToken
    ) {
      await this.refresh();
    }

    const send = () =>
      safeFetch(`${REAL_DEBRID_API_BASE}${pathname}`, {
        ...init,
        headers: {
          "User-Agent": DOWNLOAD_CLIENT_USER_AGENT,
          Authorization: `Bearer ${this.credentials?.accessToken ?? ""}`,
          ...init.headers,
        },
        requireHttps: true,
        timeoutMs: 30_000,
      });

    let response = await send();
    if (response.status === 401 && this.credentials.refreshToken) {
      await this.refresh();
      response = await send();
    }
    if (response.status === 401 || response.status === 403) {
      if (!options.allowStatus?.includes(response.status)) {
        throw new Error("Real-Debrid rejected the credentials. Reconnect the account.");
      }
    }
    if (!response.ok && !options.allowStatus?.includes(response.status)) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Real-Debrid request failed (HTTP ${response.status}): ${body.slice(0, 200)}`
      );
    }
    return response;
  }

  private async json<T>(pathname: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    const response = await this.api(pathname, signal ? { ...init, signal } : init);
    return (await response.json()) as T;
  }

  private form(values: Record<string, string>): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values).toString(),
    };
  }

  // -- Staging ------------------------------------------------------------

  private stagingRoot(): string {
    const root = this.downloader.downloadPath?.trim();
    if (!root) {
      throw new Error(
        "Real-Debrid needs a staging path (the downloader's download path) to copy files into."
      );
    }
    return root;
  }

  private stagingDir(torrentId: string): string {
    // Real-Debrid ids are plain alphanumerics; anything else is never a staging folder.
    if (!/^[A-Za-z0-9]+$/.test(torrentId)) {
      throw new Error("Invalid Real-Debrid torrent id");
    }
    const root = path.resolve(this.stagingRoot());
    const dir = path.resolve(root, torrentId);
    if (!dir.startsWith(root + path.sep)) {
      throw new Error("Staging folder escapes the staging path");
    }
    return dir;
  }

  private async isStaged(torrentId: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.stagingDir(torrentId), STAGING_MARKER));
      return true;
    } catch {
      return false;
    }
  }

  private startStaging(torrent: RealDebridTorrent): StagingJob {
    const key = jobKey(this.downloader.id, torrent.id);
    const existing = stagingJobs.get(key);
    if (existing) {
      if (existing.cancelled) return existing;
      const retryable =
        existing.state === "failed" &&
        existing.attempts < MAX_STAGING_ATTEMPTS &&
        Date.now() - (existing.failedAt ?? 0) >= retryDelayMs(existing.attempts);
      if (!retryable) return existing;
    }

    // Retrying resumes: files already fully copied are skipped by downloadFile.
    const job: StagingJob = {
      state: "running",
      bytesDone: 0,
      bytesTotal: torrent.bytes,
      startedAt: Date.now(),
      attempts: (existing?.attempts ?? 0) + 1,
      cancelled: false,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    stagingJobs.set(key, job);
    job.done = this.stageFiles(torrent, job).catch((error) => {
      if (job.cancelled) return;
      job.state = "failed";
      job.failedAt = Date.now();
      job.error = getErrorMessage(error);
      downloadersLogger.error(
        { error, downloaderId: this.downloader.id, torrentId: torrent.id },
        "Real-Debrid staging failed"
      );
    });
    return job;
  }

  private async stageFiles(torrent: RealDebridTorrent, job: StagingJob): Promise<void> {
    const dir = this.stagingDir(torrent.id);
    await fs.mkdir(dir, { recursive: true });

    const links = torrent.links ?? [];
    if (links.length === 0) throw new Error("Real-Debrid returned no download links");
    const files = selectedFiles(torrent);
    // Links come back in the order of the selected files, so their paths can be restored.
    const paths = files.length === links.length ? files.map((file) => file.path) : null;

    const used = new Set<string>();
    for (const [index, link] of links.entries()) {
      job.abort.signal.throwIfAborted();
      const unrestricted = await this.json<UnrestrictedLink>(
        "/unrestrict/link",
        this.form({ link }),
        job.abort.signal
      );
      const segments = toSafeSegments(paths?.[index] ?? unrestricted.filename);
      if (segments.length === 0) throw new Error("Real-Debrid returned an empty file name");
      let target = path.join(dir, ...segments);
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to write outside the staging folder: ${target}`);
      }
      // Two different remote files must never land on the same local path, even on a
      // case-insensitive filesystem: rename a case-only clash with a numeric suffix.
      if (used.has(target.toLowerCase())) {
        const { dir: parent, name, ext } = path.parse(target);
        let n = 2;
        while (used.has(path.join(parent, `${name} (${n})${ext}`).toLowerCase())) n++;
        target = path.join(parent, `${name} (${n})${ext}`);
      }
      used.add(target.toLowerCase());
      await this.downloadFile(unrestricted, target, dir, job);
    }

    job.abort.signal.throwIfAborted();
    await fs.rm(path.join(dir, TEMP_DIR), { recursive: true, force: true });
    await fs.writeFile(
      path.join(dir, STAGING_MARKER),
      JSON.stringify({ torrentId: torrent.id, stagedAt: new Date().toISOString() })
    );
    stagingJobs.delete(jobKey(this.downloader.id, torrent.id));
  }

  private async downloadFile(
    file: UnrestrictedLink,
    target: string,
    dir: string,
    job: StagingJob
  ): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const existing = await fs.stat(target).catch(() => null);
    if (existing && existing.size === file.filesize) {
      job.bytesDone += existing.size;
      return;
    }

    const response = await safeFetch(file.download, {
      headers: { "User-Agent": DOWNLOAD_CLIENT_USER_AGENT },
      requireHttps: true,
      timeoutMs: STAGING_TIMEOUT_MS,
      signal: job.abort.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Real-Debrid file download failed (HTTP ${response.status})`);
    }

    // The temp file lives outside the payload namespace so it can't clash with a real file.
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
      if (file.filesize > 0 && copied !== file.filesize) {
        throw new Error(
          `Incomplete copy of ${path.basename(target)}: ${copied}/${file.filesize} bytes`
        );
      }
      await fs.rename(partial, target);
    } catch (error) {
      await fs.rm(partial, { force: true });
      throw error;
    }
  }

  // -- Status mapping -----------------------------------------------------

  private async toStatus(torrent: RealDebridTorrent, tracked = true): Promise<DownloadStatus> {
    const base = {
      id: torrent.id,
      name: torrent.original_filename || torrent.filename,
      downloadType: "torrent" as const,
      size: torrent.bytes,
      category: this.downloader.category ?? undefined,
      seeders: torrent.seeders,
    };

    switch (torrent.status) {
      case "magnet_error":
      case "error":
      case "virus":
      case "dead":
        return {
          ...base,
          status: "error",
          progress: torrent.progress,
          error: `Real-Debrid reported status "${torrent.status}"`,
        };
      case "waiting_files_selection":
        if (tracked) await this.selectAllFiles(torrent.id);
        return { ...base, status: "downloading", progress: 0 };
      case "downloaded":
        return this.stagingStatus(torrent, base, tracked);
      default:
        return {
          ...base,
          status: "downloading",
          // Real-Debrid's own phase fills the first half of the bar, local staging the rest.
          progress: Math.min(50, Math.round(torrent.progress / 2)),
          downloadSpeed: torrent.speed,
          downloaded: Math.round((torrent.bytes * torrent.progress) / 100),
        };
    }
  }

  private async stagingStatus(
    torrent: RealDebridTorrent,
    base: Omit<DownloadStatus, "status" | "progress">,
    tracked: boolean
  ): Promise<DownloadStatus> {
    if (await this.isStaged(torrent.id)) {
      return { ...base, status: "completed", progress: 100, downloaded: torrent.bytes };
    }
    // The account may hold torrents Questarr never added: never copy those on its own.
    if (!tracked) return { ...base, status: "paused", progress: 50 };
    const job = this.startStaging(torrent);
    // A failed copy is retried with a backoff, so a transient error stays "downloading".
    if (job.state === "failed" && job.attempts >= MAX_STAGING_ATTEMPTS) {
      return { ...base, status: "error", progress: 50, error: job.error ?? "Staging failed" };
    }
    const fraction = job.bytesTotal > 0 ? Math.min(1, job.bytesDone / job.bytesTotal) : 0;
    const elapsed = Math.max(1, (Date.now() - job.startedAt) / 1000);
    const speed = job.bytesDone / elapsed;
    return {
      ...base,
      status: "downloading",
      progress: Math.min(99, 50 + Math.round(fraction * 50)),
      downloaded: job.bytesDone,
      downloadSpeed: Math.round(speed),
      eta: speed > 0 ? Math.round((job.bytesTotal - job.bytesDone) / speed) : undefined,
    };
  }

  private async selectAllFiles(id: string): Promise<void> {
    await this.api(`/torrents/selectFiles/${encodeURIComponent(id)}`, this.form({ files: "all" }));
  }

  // -- DownloaderClient ---------------------------------------------------

  async testConnection(): Promise<DownloaderActionResult> {
    try {
      this.stagingRoot();
      const user = await this.json<{ username?: string; type?: string; premium?: number }>("/user");
      if (user.type !== "premium") {
        return {
          success: false,
          message: `Connected as ${user.username ?? "unknown"}, but the account is not premium`,
        };
      }
      return { success: true, message: `Connected to Real-Debrid as ${user.username ?? "user"}` };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  async logVersionInfo(): Promise<void> {
    const result = await this.testConnection();
    downloadersLogger.info(
      { downloaderId: this.downloader.id, success: result.success },
      `Real-Debrid: ${result.message}`
    );
  }

  async addDownload(request: DownloadRequest): Promise<DownloadResult> {
    try {
      this.stagingRoot();
      let id: string;
      let magnet: string | undefined = request.url.startsWith("magnet:") ? request.url : undefined;
      let torrentBytes: ArrayBuffer | undefined;

      if (!magnet) {
        const fetched = await fetchWithMagnetDetection(request.url);
        if (fetched.magnetLink) {
          magnet = fetched.magnetLink;
        } else if (fetched.response?.ok) {
          torrentBytes = await fetched.response.arrayBuffer();
        } else {
          return {
            success: false,
            message: `Could not fetch the torrent file (HTTP ${fetched.response?.status ?? "?"})`,
          };
        }
      }

      if (magnet) {
        const added = await this.json<{ id: string }>("/torrents/addMagnet", this.form({ magnet }));
        id = added.id;
      } else {
        const response = await this.api("/torrents/addTorrent", {
          method: "PUT",
          headers: { "Content-Type": "application/x-bittorrent" },
          body: torrentBytes as ArrayBuffer,
        });
        id = ((await response.json()) as { id: string }).id;
      }

      // A magnet is usually not ready to be selected yet; the status poll retries.
      await this.selectAllFiles(id).catch(() => undefined);
      return { success: true, message: "Added to Real-Debrid", id };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  async getDownloadStatus(
    id: string,
    options?: { throwOnError?: boolean }
  ): Promise<DownloadStatus | null> {
    try {
      const response = await this.api(
        `/torrents/info/${encodeURIComponent(id)}`,
        {},
        { allowStatus: [404] }
      );
      if (response.status === 404) return null;
      const torrent = (await response.json()) as RealDebridTorrent;
      return await this.toStatus(torrent, await this.isTracked(torrent.id));
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error, id }, "Real-Debrid status lookup failed");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const response = await this.api(
      `/torrents/info/${encodeURIComponent(id)}`,
      {},
      { allowStatus: [404] }
    );
    if (response.status === 404) return null;
    const torrent = (await response.json()) as RealDebridTorrent;
    const status = await this.toStatus(torrent, await this.isTracked(torrent.id));
    const staged = status.status === "completed";
    return {
      ...status,
      hash: torrent.hash,
      addedDate: torrent.added,
      completedDate: torrent.ended,
      // Only set once the files are really on disk, so nothing is imported half-copied.
      downloadDir: staged ? this.stagingDir(torrent.id) : undefined,
      files: selectedFiles(torrent).map((file) => ({
        name: toSafeSegments(file.path).join("/"),
        size: file.bytes,
        progress: staged ? 100 : 0,
        priority: "normal" as const,
        wanted: true,
      })),
      filesSupport: "supported",
      trackers: [],
    };
  }

  async getAllDownloads(options?: { throwOnError?: boolean }): Promise<DownloadStatus[]> {
    try {
      const torrents = await this.listTorrents();
      const tracked = await this.trackedTorrentIds();
      return await Promise.all(
        torrents.map((torrent) => this.hydrate(torrent, tracked.has(torrent.id)))
      );
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error }, "Real-Debrid download list failed");
      return [];
    }
  }

  /** The list endpoint omits `files` and `links`; staging needs them, so fetch full info. */
  private async hydrate(torrent: RealDebridTorrent, tracked: boolean): Promise<DownloadStatus> {
    // Untracked or already-staged torrents never use files/links: skip the per-torrent call so a
    // large account cannot trigger a burst of requests (and 429s) on every poll.
    if (torrent.status !== "downloaded" || !tracked || (await this.isStaged(torrent.id))) {
      return this.toStatus(torrent, tracked);
    }
    const full = await this.json<RealDebridTorrent>(
      `/torrents/info/${encodeURIComponent(torrent.id)}`
    );
    return this.toStatus(full, tracked);
  }

  private async isTracked(id: string): Promise<boolean> {
    return (await this.trackedTorrentIds()).has(id);
  }

  /** Every torrent in the account, page by page (the API caps a page at 100). */
  private async listTorrents(): Promise<RealDebridTorrent[]> {
    const pageSize = 100;
    const all: RealDebridTorrent[] = [];
    for (let page = 0; page < 50; page++) {
      const response = await this.api(`/torrents?limit=${pageSize}&offset=${page * pageSize}`);
      // 204 means an empty page.
      const batch = response.status === 204 ? [] : ((await response.json()) as RealDebridTorrent[]);
      all.push(...batch);
      if (batch.length < pageSize) break;
    }
    return all;
  }

  /** Torrent ids Questarr itself is tracking on this downloader. */
  private async trackedTorrentIds(): Promise<Set<string>> {
    const { storage } = await import("../storage.js");
    const rows = await storage.getDownloadingGameDownloads();
    return new Set(
      rows.filter((row) => row.downloaderId === this.downloader.id).map((row) => row.downloadHash)
    );
  }

  async pauseDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "Real-Debrid does not support pausing downloads" };
  }

  async resumeDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "Real-Debrid does not support resuming downloads" };
  }

  async removeDownload(id: string, deleteFiles = false): Promise<DownloaderActionResult> {
    const key = jobKey(this.downloader.id, id);
    const job = stagingJobs.get(key);
    try {
      // Stop an active copy first, and keep the job registered until cleanup is done so a
      // poll can't start a replacement while the folder is being removed.
      if (job) {
        job.cancelled = true;
        job.abort.abort();
        await job.done;
      }
      await this.api(
        `/torrents/delete/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        { allowStatus: [404] }
      );
      if (deleteFiles) {
        await fs.rm(this.stagingDir(id), { recursive: true, force: true });
      }
      return { success: true, message: "Download removed" };
    } catch (error) {
      return { success: false, message: `Failed to remove download: ${getErrorMessage(error)}` };
    } finally {
      if (job) stagingJobs.delete(key);
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const stats = await fs.statfs(this.stagingRoot());
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return 0;
    }
  }

  findTorrentByTag = findTorrentByTagNull;
}
