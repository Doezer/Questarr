import fs from "node:fs/promises";
import path from "node:path";
import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import { safeFetch } from "../ssrf.js";
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
import {
  MAX_STAGING_ATTEMPTS,
  STAGING_MARKER,
  TEMP_DIR,
  beginStagingJob,
  copyRemoteFile,
  jobKey,
  resolveStagedPaths,
  stagingJobs,
  type StagingJob,
} from "./debrid-staging.js";

export const TORBOX_API_BASE = "https://api.torbox.app/v1/api";

const IS_TEST = process.env.NODE_ENV === "test";
const REQUEST_SPACING_MS = IS_TEST ? 0 : 250;
const RATE_LIMIT_BACKOFF_MS = IS_TEST ? 1 : 2_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const LIST_PAGE_SIZE = 1000;

/** A TorBox torrent as `torrents/mylist` returns it (only the fields used here). */
interface TorBoxTorrent {
  id: number;
  hash?: string;
  name: string;
  size: number;
  /** 0 to 1. */
  progress: number;
  download_state?: string;
  download_finished?: boolean;
  download_present?: boolean;
  download_speed?: number;
  seeds?: number;
  eta?: number;
  created_at?: string;
  updated_at?: string;
  files?: Array<{ id: number; name: string; short_name?: string; size: number }>;
}

/** TorBox wraps every answer as `{ success, error, detail, data }`. */
interface TorBoxEnvelope<T = unknown> {
  success?: boolean;
  error?: string | null;
  detail?: string | null;
  data?: T;
}

interface TorBoxReply<T = unknown> {
  status: number;
  body: TorBoxEnvelope<T> | null;
}

const sleep = (ms: number, signal?: AbortSignal) =>
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

const nextRequestSlot = new Map<string, number>();

const NOT_FOUND = /not.?found|no.?torrent|no.?item/i;

/**
 * TorBox downloader (torrents). TorBox fetches the torrent on its servers; once it reports the
 * files as present they are copied over HTTPS into `<downloadPath>/<torrent id>/` and only then
 * reported as completed, so the regular import pipeline sees ordinary local files. The same
 * staging as Real-Debrid is used (see debrid-staging.ts).
 *
 * The API key lives in the downloader's (encrypted) password field.
 */
export class TorBoxClient implements DownloaderClient {
  constructor(private readonly downloader: Downloader) {}

  // -- HTTP ---------------------------------------------------------------

  private apiKey(): string {
    const key = this.downloader.password?.trim();
    if (!key) throw new Error("TorBox needs an API key (the downloader's password field).");
    return key;
  }

  private async pace(signal?: AbortSignal): Promise<void> {
    const id = this.downloader.id;
    const slot = Math.max(Date.now(), nextRequestSlot.get(id) ?? 0);
    nextRequestSlot.set(id, slot + REQUEST_SPACING_MS);
    if (slot > Date.now()) await sleep(slot - Date.now(), signal);
  }

  /**
   * One call to the API. Throws on a rejected key, a server error or a network failure; an
   * ordinary "no" from TorBox (success false) is returned for the caller to interpret.
   */
  private async request<T = unknown>(
    pathname: string,
    init: RequestInit = {},
    options: { query?: Record<string, string>; signal?: AbortSignal } = {}
  ): Promise<TorBoxReply<T>> {
    const key = this.apiKey();
    const url = new URL(`${TORBOX_API_BASE}${pathname}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }

    const send = async () => {
      await this.pace(options.signal);
      return safeFetch(url.toString(), {
        ...init,
        headers: {
          "User-Agent": DOWNLOAD_CLIENT_USER_AGENT,
          Authorization: `Bearer ${key}`,
          ...init.headers,
        },
        requireHttps: true,
        timeoutMs: 30_000,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    };

    let response = await send();
    for (let retry = 1; response.status === 429 && retry <= MAX_RATE_LIMIT_RETRIES; retry++) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : RATE_LIMIT_BACKOFF_MS * 2 ** (retry - 1);
      await response.body?.cancel().catch(() => undefined);
      await sleep(wait, options.signal);
      response = await send();
    }

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("TorBox rejected the API key. Check it in the downloader settings.");
    }
    const text = await response.text().catch(() => "");
    let body: TorBoxEnvelope<T> | null;
    try {
      body = text ? (JSON.parse(text) as TorBoxEnvelope<T>) : null;
    } catch {
      body = null;
    }
    if (response.status >= 500 || (!response.ok && body === null)) {
      throw new Error(`TorBox request failed (HTTP ${response.status})`);
    }
    return { status: response.status, body };
  }

  /** A request that must succeed: anything but `success: true` becomes an error. */
  private async call<T = unknown>(
    pathname: string,
    init?: RequestInit,
    options?: { query?: Record<string, string>; signal?: AbortSignal }
  ): Promise<T> {
    const reply = await this.request<T>(pathname, init, options);
    if (!reply.body?.success) throw new Error(this.describeFailure(reply));
    return reply.body.data as T;
  }

  private describeFailure(reply: TorBoxReply): string {
    const detail = reply.body?.detail || reply.body?.error;
    return `TorBox: ${detail ? String(detail).slice(0, 200) : `request failed (HTTP ${reply.status})`}`;
  }

  private form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) data.set(name, value);
    return data;
  }

  // -- Staging ------------------------------------------------------------

  private stagingRoot(): string {
    const root = this.downloader.downloadPath?.trim();
    if (!root) {
      throw new Error(
        "TorBox needs a staging path (the downloader's download path) to copy files into."
      );
    }
    return root;
  }

  private stagingDir(torrentId: string): string {
    // TorBox ids are plain integers; anything else is never a staging folder.
    if (!/^[0-9]+$/.test(torrentId)) throw new Error("Invalid TorBox torrent id");
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

  private startStaging(torrent: TorBoxTorrent): StagingJob {
    return beginStagingJob({
      downloaderId: this.downloader.id,
      id: String(torrent.id),
      bytesTotal: torrent.size,
      run: (job) => this.stageFiles(torrent, job),
      label: "TorBox",
    });
  }

  private async stageFiles(torrent: TorBoxTorrent, job: StagingJob): Promise<void> {
    const id = String(torrent.id);
    const dir = this.stagingDir(id);
    await fs.mkdir(dir, { recursive: true });

    const files = torrent.files ?? [];
    if (files.length === 0) throw new Error("TorBox returned no files for this torrent");
    const resolved = resolveStagedPaths(files.map((file) => file.name));

    for (const [index, file] of files.entries()) {
      job.abort.signal.throwIfAborted();
      const link = await this.call<string>("/torrents/requestdl", undefined, {
        query: {
          // requestdl takes the key as a query parameter instead of a header.
          token: this.apiKey(),
          torrent_id: id,
          file_id: String(file.id),
        },
        signal: job.abort.signal,
      });
      if (typeof link !== "string" || link.length === 0) {
        throw new Error(`TorBox returned no download link for "${file.short_name ?? file.name}"`);
      }
      const target = path.join(dir, ...(resolved[index] ?? []));
      if (!target.startsWith(dir + path.sep)) {
        throw new Error(`Refusing to write outside the staging folder: ${target}`);
      }
      await copyRemoteFile({ url: link, size: file.size, label: "TorBox" }, target, dir, job);
    }

    job.abort.signal.throwIfAborted();
    await fs.rm(path.join(dir, TEMP_DIR), { recursive: true, force: true });
    await fs.writeFile(
      path.join(dir, STAGING_MARKER),
      JSON.stringify({ torrentId: id, stagedAt: new Date().toISOString() })
    );
    stagingJobs.delete(jobKey(this.downloader.id, id));
  }

  // -- Status mapping -----------------------------------------------------

  /** Whether TorBox holds the finished files, ready to be copied. */
  private isReady(torrent: TorBoxTorrent): boolean {
    return torrent.download_finished === true && torrent.download_present !== false;
  }

  private async toStatus(torrent: TorBoxTorrent, tracked = true): Promise<DownloadStatus> {
    const percent = Math.max(0, Math.min(100, Math.round((torrent.progress ?? 0) * 100)));
    const state = (torrent.download_state ?? "").toLowerCase();
    const base = {
      id: String(torrent.id),
      name: torrent.name,
      downloadType: "torrent" as const,
      size: torrent.size,
      category: this.downloader.category ?? undefined,
      seeders: torrent.seeds,
    };

    if (/^(error|failed)/.test(state) || state === "expired") {
      return {
        ...base,
        status: "error",
        progress: percent,
        error: `TorBox reported status "${torrent.download_state}"`,
      };
    }
    if (this.isReady(torrent)) return this.stagingStatus(torrent, base, tracked);
    if (state.startsWith("paused")) {
      return { ...base, status: "paused", progress: Math.min(50, Math.round(percent / 2)) };
    }
    return {
      ...base,
      status: "downloading",
      // TorBox's own phase fills the first half of the bar, local staging the rest.
      progress: Math.min(50, Math.round(percent / 2)),
      downloadSpeed: torrent.download_speed,
      downloaded: Math.round(torrent.size * (torrent.progress ?? 0)),
      eta: torrent.eta && torrent.eta > 0 ? torrent.eta : undefined,
    };
  }

  private async stagingStatus(
    torrent: TorBoxTorrent,
    base: Omit<DownloadStatus, "status" | "progress">,
    tracked: boolean
  ): Promise<DownloadStatus> {
    const id = String(torrent.id);
    if (await this.isStaged(id)) {
      return { ...base, status: "completed", progress: 100, downloaded: torrent.size };
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

  // -- DownloaderClient ---------------------------------------------------

  async testConnection(): Promise<DownloaderActionResult> {
    try {
      this.stagingRoot();
      await this.call("/user/me");
      return { success: true, message: "Connected to TorBox" };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  async logVersionInfo(): Promise<void> {
    const result = await this.testConnection();
    downloadersLogger.info(
      { downloaderId: this.downloader.id, success: result.success },
      `TorBox: ${result.message}`
    );
  }

  async addDownload(request: DownloadRequest): Promise<DownloadResult> {
    try {
      this.stagingRoot();
      const fields: Record<string, string> = { as_queued: "false" };
      let body: FormData;

      if (request.url.startsWith("magnet:")) {
        body = this.form({ ...fields, magnet: request.url });
      } else {
        const fetched = await fetchWithMagnetDetection(request.url);
        if (fetched.magnetLink) {
          body = this.form({ ...fields, magnet: fetched.magnetLink });
        } else if (fetched.response?.ok) {
          body = this.form(fields);
          body.set(
            "file",
            new Blob([await fetched.response.arrayBuffer()], { type: "application/x-bittorrent" }),
            "release.torrent"
          );
        } else {
          return {
            success: false,
            message: `Could not fetch the torrent file (HTTP ${fetched.response?.status ?? "?"})`,
          };
        }
      }

      const data = await this.call<{ torrent_id?: number; queued_id?: number }>(
        "/torrents/createtorrent",
        { method: "POST", body }
      );
      if (data?.torrent_id === undefined) {
        return {
          success: false,
          message: "TorBox queued the torrent instead of starting it (active download limit)",
        };
      }
      return { success: true, message: "Added to TorBox", id: String(data.torrent_id) };
    } catch (error) {
      return { success: false, message: getErrorMessage(error) };
    }
  }

  /** One torrent by id, or null when TorBox does not know it. */
  private async fetchTorrent(id: string): Promise<TorBoxTorrent | null> {
    if (!/^[0-9]+$/.test(id)) return null;
    const reply = await this.request<TorBoxTorrent | TorBoxTorrent[] | null>(
      "/torrents/mylist",
      {},
      {
        query: { id, bypass_cache: "true" },
      }
    );
    if (!reply.body?.success) {
      if (reply.status === 404 || NOT_FOUND.test(`${reply.body?.error ?? ""}`)) return null;
      throw new Error(this.describeFailure(reply));
    }
    const data = reply.body.data;
    const torrent = Array.isArray(data) ? data[0] : data;
    return torrent && typeof torrent === "object" ? torrent : null;
  }

  async getDownloadStatus(
    id: string,
    options?: { throwOnError?: boolean }
  ): Promise<DownloadStatus | null> {
    try {
      const torrent = await this.fetchTorrent(id);
      if (!torrent) return null;
      return await this.toStatus(torrent, await this.isTracked(String(torrent.id)));
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error, id }, "TorBox status lookup failed");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const torrent = await this.fetchTorrent(id);
    if (!torrent) return null;
    const status = await this.toStatus(torrent, await this.isTracked(String(torrent.id)));
    const staged = status.status === "completed";
    const files = torrent.files ?? [];
    const resolvedPaths = resolveStagedPaths(files.map((file) => file.name));
    return {
      ...status,
      hash: torrent.hash,
      addedDate: torrent.created_at,
      completedDate: staged ? torrent.updated_at : undefined,
      // Only set once the files are really on disk, so nothing is imported half-copied.
      downloadDir: staged ? this.stagingDir(String(torrent.id)) : undefined,
      files: files.map((file, index) => ({
        name: (resolvedPaths[index] ?? []).join("/"),
        size: file.size,
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
        torrents.map((torrent) => this.toStatus(torrent, tracked.has(String(torrent.id))))
      );
    } catch (error) {
      if (options?.throwOnError) throw error;
      downloadersLogger.warn({ error }, "TorBox download list failed");
      return [];
    }
  }

  /** Every torrent in the account, page by page. */
  private async listTorrents(): Promise<TorBoxTorrent[]> {
    const all: TorBoxTorrent[] = [];
    for (let page = 0; page < 50; page++) {
      const batch = await this.call<TorBoxTorrent[] | null>("/torrents/mylist", undefined, {
        query: {
          bypass_cache: "true",
          limit: String(LIST_PAGE_SIZE),
          offset: String(page * LIST_PAGE_SIZE),
        },
      });
      const items = Array.isArray(batch) ? batch : [];
      all.push(...items);
      if (items.length < LIST_PAGE_SIZE) break;
    }
    return all;
  }

  private async isTracked(id: string): Promise<boolean> {
    return (await this.trackedTorrentIds()).has(id);
  }

  /** Torrent ids Questarr itself is tracking on this downloader. */
  private async trackedTorrentIds(): Promise<Set<string>> {
    // Imported lazily: storage pulls in the whole database layer.
    const { storage } = await import("../storage.js");
    const rows = await storage.getDownloadingGameDownloads();
    return new Set(
      rows.filter((row) => row.downloaderId === this.downloader.id).map((row) => row.downloadHash)
    );
  }

  async pauseDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "TorBox does not support pausing downloads" };
  }

  async resumeDownload(_id: string): Promise<DownloaderActionResult> {
    return { success: false, message: "TorBox does not support resuming downloads" };
  }

  async removeDownload(id: string, deleteFiles = false): Promise<DownloaderActionResult> {
    const key = jobKey(this.downloader.id, id);
    // Reserve the key before the first await, even when nothing is running, so an overlapping
    // status poll can't start a copy while the torrent and its folder are being removed.
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
      if (!/^[0-9]+$/.test(id)) throw new Error("Invalid TorBox torrent id");
      // Stop an active copy first, and keep the job registered until cleanup is done.
      job.cancelled = true;
      job.abort.abort();
      await job.done;
      const reply = await this.request("/torrents/controltorrent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "delete", torrent_id: Number(id) }),
      });
      // A torrent TorBox no longer has is already gone.
      if (
        !reply.body?.success &&
        !NOT_FOUND.test(`${reply.body?.error ?? ""}`) &&
        reply.status !== 404
      ) {
        throw new Error(this.describeFailure(reply));
      }
      if (deleteFiles) {
        await fs.rm(this.stagingDir(id), { recursive: true, force: true });
      }
      return { success: true, message: "Download removed" };
    } catch (error) {
      return { success: false, message: `Failed to remove download: ${getErrorMessage(error)}` };
    } finally {
      stagingJobs.delete(key);
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
