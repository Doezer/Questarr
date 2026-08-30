import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { parseJsonObject } from "../../shared/json-object-utils.js";
import { downloadersLogger } from "../logger.js";
import https from "https";
import { isSafeUrl, resolveSafeAddress, safeFetch } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import {
  fixNzbUrlEncoding,
  logDownloaderDebugResponse,
  stripTrailingPathSeparators,
} from "./utils.js";

/**
 * Strips the `apikey` query param from a SABnzbd request URL before it's
 * passed to a logger -- getApiUrl() embeds the credential directly in the
 * URL, so logging it unredacted would leak the API key into log output.
 */
function redactApiKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("apikey")) {
      parsed.searchParams.set("apikey", "[redacted]");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Node TLS error codes that genuinely indicate a self-signed or otherwise
 * untrusted certificate chain -- the specific failure modes
 * allowSelfSignedCertificate exists to bypass. Deliberately excludes
 * CERT_HAS_EXPIRED and any other certificate-related code: an expired
 * certificate is a different, unrelated problem that this opt-in was never
 * meant to paper over.
 */
const SELF_SIGNED_TLS_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
]);

interface SABnzbdQueue {
  slots: Array<{
    nzo_id: string;
    filename: string;
    status: string;
    percentage: string;
    mb: string;
    mbleft: string;
    mbmissing: string;
    size: string;
    sizeleft: string;
    timeleft: string;
    eta: string;
    cat: string;
    priority: string;
    script: string;
    avg_age: string;
  }>;
  speed: string;
  size: string;
  sizeleft: string;
  mb: string;
  mbleft: string;
  noofslots: number;
  status: string;
  timeleft: string;
}

interface SABnzbdHistory {
  slots: Array<{
    nzo_id: string;
    name: string;
    status: string;
    fail_message: string;
    path: string;
    storage?: string;
    size: string;
    bytes: number;
    category: string;
    download_time: number;
    completed: number;
    action_line: string;
    stage_log: Array<{
      name: string;
      actions: string[];
    }>;
  }>;
}

export class SABnzbdClient implements DownloaderClient {
  private downloader: Downloader;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  private getBaseUrl(): string {
    let baseUrl = this.downloader.url;
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const protocol = this.downloader.useSsl ? "https://" : "http://";
      baseUrl = protocol + baseUrl;
    }

    try {
      const urlObj = new URL(baseUrl);
      if (this.downloader.port) {
        urlObj.port = this.downloader.port.toString();
      }
      return urlObj.toString().replace(/\/$/, "");
    } catch {
      return baseUrl.replace(/\/$/, "");
    }
  }

  private getApiUrl(mode: string, params: Record<string, string> = {}): string {
    const baseUrl = this.getBaseUrl();

    let apiPath = "/api";
    if (this.downloader.urlPath) {
      const path = this.downloader.urlPath.startsWith("/")
        ? this.downloader.urlPath
        : `/${this.downloader.urlPath}`;
      apiPath = `${path.replace(/\/$/, "")}/api`;
    }

    const url = new URL(`${baseUrl}${apiPath}`);
    url.searchParams.set("apikey", this.downloader.username || "");
    url.searchParams.set("mode", mode);
    url.searchParams.set("output", "json");

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private async fetchWithFallback(
    url: string,
    options: RequestInit = {},
    allowInsecureFallback = true
  ): Promise<Response> {
    const response = await this.doFetchWithFallback(url, options, allowInsecureFallback);
    await logDownloaderDebugResponse("sabnzbd", options.method ?? "GET", url, response);
    return response;
  }

  private async doFetchWithFallback(
    url: string,
    options: RequestInit = {},
    allowInsecureFallback = true
  ): Promise<Response> {
    try {
      return await safeFetch(url, { ...options, allowPrivate: true });
    } catch (error) {
      const isSslError =
        error instanceof Error &&
        // Only Node's self-signed/untrusted-chain TLS error codes qualify for
        // the insecure retry -- NOT a generic message.includes("certificate")
        // (too broad) or CERT_HAS_EXPIRED (an expired cert is a different,
        // unrelated failure that allowSelfSignedCertificate was never meant
        // to bypass).
        SELF_SIGNED_TLS_ERROR_CODES.has((error.cause as { code?: string })?.code ?? "");

      // The insecure fallback (rejectUnauthorized: false) accepts *any* certificate,
      // including one presented by an attacker impersonating the configured host. That's
      // an acceptable trade-off for routine status polling, but never for a request
      // carrying the archive password -- callers pass allowInsecureFallback: false there
      // so a cert failure surfaces as an error instead of silently downgrading transport
      // security for a credential.
      if (isSslError && allowInsecureFallback) {
        const redactedUrl = redactApiKey(url);
        if (!this.downloader.allowSelfSignedCertificate) {
          downloadersLogger.warn(
            { url: redactedUrl, downloaderId: this.downloader.id },
            "SSL verification failed; not retrying insecurely because " +
              "allowSelfSignedCertificate is disabled for this downloader"
          );
          throw error;
        }
        downloadersLogger.debug(
          { url: redactedUrl },
          "SSL verification failed, retrying with insecure connection (allowSelfSignedCertificate enabled)"
        );
        return this.fetchInsecure(url, options);
      }
      throw error;
    }
  }

  private async fetchInsecure(url: string, options: RequestInit): Promise<Response> {
    const parsedUrl = new URL(url);
    const { address, family } = await resolveSafeAddress(parsedUrl.hostname, true);
    const safeUrl = new URL(url);
    safeUrl.hostname = family === 6 ? `[${address}]` : address;

    const headers = new Headers(options.headers || {});
    headers.set("Host", parsedUrl.host);

    return new Promise((resolve, reject) => {
      const req = https.request(
        safeUrl.toString(),
        {
          method: options.method || "GET",
          headers: Object.fromEntries(headers.entries()) as import("http").OutgoingHttpHeaders,
          rejectUnauthorized: false,
          timeout: 30000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString();
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
              if (value === undefined) continue;
              for (const v of Array.isArray(value) ? value : [value]) {
                responseHeaders.append(name, v);
              }
            }
            // Build a native Response so downstream consumers (including
            // logDownloaderDebugResponse, which calls clone() and
            // headers.entries()) get the full standard Response surface.
            resolve(
              new Response(body, {
                status: res.statusCode || 200,
                statusText: res.statusMessage || "",
                headers: responseHeaders,
              })
            );
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });

      if (options.body) {
        req.write(options.body as Buffer | string);
      }
      req.end();
    });
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const data = await this.getVersionInfo();
      if (data.version) {
        return { success: true, message: `Connected to SABnzbd v${data.version}` };
      }

      return { success: false, message: "Invalid SABnzbd response - missing version field" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const redactedUrl = redactApiKey(this.getApiUrl("version"));
      downloadersLogger.error({ error, url: redactedUrl }, "SABnzbd connection test failed");
      return {
        success: false,
        message: `Failed to connect to SABnzbd at ${redactedUrl}: ${errorMessage}`,
      };
    }
  }

  async logVersionInfo(): Promise<void> {
    const data = await this.getVersionInfo();
    if (!data.version) {
      downloadersLogger.debug(
        { downloaderId: this.downloader.id, downloaderType: this.downloader.type },
        "SABnzbd version endpoint did not expose version info"
      );
      return;
    }

    downloadersLogger.info(
      {
        downloaderId: this.downloader.id,
        downloaderType: this.downloader.type,
        version: data.version,
      },
      "Downloader version probe completed"
    );
  }

  private async getVersionInfo(): Promise<Record<string, unknown>> {
    const url = this.getApiUrl("version");
    downloadersLogger.debug({ url: redactApiKey(url) }, "Testing SABnzbd connection");
    const response = await this.fetchWithFallback(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details");
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  private getArchivePassword(): string | undefined {
    const { archivePassword } = parseJsonObject(this.downloader.settings);
    return typeof archivePassword === "string" ? archivePassword || undefined : undefined;
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    if (!(await isSafeUrl(request.url))) {
      return { success: false, message: `Unsafe URL blocked: ${request.url}` };
    }

    try {
      // Fetch the NZB in Questarr and upload via addfile so SABnzbd never needs
      // direct indexer access. Keep &file= intact — Prowlarr uses it for link validation.
      const nzbUrl = fixNzbUrlEncoding(request.url);
      const nzbResponse = await safeFetch(nzbUrl);
      if (!nzbResponse.ok) {
        return { success: false, message: `Failed to fetch NZB: ${nzbResponse.statusText}` };
      }
      const nzbContent = await nzbResponse.arrayBuffer();

      // Many usenet releases (e.g. G4U) ship as password-protected archives. SABnzbd
      // can unpack them automatically if we hand it the extraction password up front —
      // configured per-downloader since it's usually a fixed indexer/group convention.
      const password = request.password || this.getArchivePassword();

      // The archive password travels in the addfile query string — never send it
      // over a plain-HTTP connection to SABnzbd, where it would be readable to
      // anything on the network path.
      if (password && !this.getBaseUrl().startsWith("https://")) {
        return {
          success: false,
          message:
            "Refusing to send the archive password over an insecure connection. Enable SSL for this SABnzbd downloader, or remove the archive password.",
        };
      }

      const url = this.getApiUrl("addfile", {
        nzbname: request.title,
        cat: request.category || "games",
        priority: (request.priority || 0).toString(),
        ...(password ? { password } : {}),
      });

      // Build multipart body manually so fetchInsecure (self-signed HTTPS fallback)
      // can write it as a Buffer — FormData is not serialisable via req.write().
      const boundary = `questarr${Date.now().toString(16)}`;
      const safeName = request.title.replace(/["\\]/g, "_");
      const nzbBuffer = Buffer.from(nzbContent);
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="name"; filename="${safeName}.nzb"\r\nContent-Type: application/x-nzb\r\n\r\n`
        ),
        nzbBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await this.fetchWithFallback(
        url,
        {
          method: "POST",
          body: multipartBody,
          headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
          signal: AbortSignal.timeout(30000),
        },
        !password
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "No error details");
        return { success: false, message: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json();

      if (data.status === true) {
        if (data.nzo_ids && data.nzo_ids.length > 0) {
          return {
            success: true,
            id: data.nzo_ids[0],
            message: "NZB added successfully",
          };
        } else {
          // Status true but no ID usually means duplicate in SABnzbd (or merged)
          return {
            success: true,
            message: "NZB added successfully (likely duplicate or merged)",
          };
        }
      }

      // Check for specific duplicate error
      if (
        data.error &&
        typeof data.error === "string" &&
        data.error.toLowerCase().includes("duplicate")
      ) {
        return {
          success: true,
          message: `NZB already exists: ${data.error}`,
        };
      }

      return {
        success: false,
        message: data.error || "Failed to add NZB - SABnzbd returned success:false",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to add NZB to SABnzbd: ${errorMessage}`,
      };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const url = this.getApiUrl("queue");
      const response = await this.fetchWithFallback(url);
      const data = await response.json();
      const queue: SABnzbdQueue = data.queue;

      const item = queue.slots.find((slot) => slot.nzo_id === id);
      if (!item) {
        // Check history if not in queue
        downloadersLogger.debug(
          { id, queueSize: queue.slots.length },
          "SABnzbd: item not in queue, checking history"
        );
        return await this.getFromHistory(id);
      }

      const progress = parseFloat(item.percentage) || 0;
      const totalMB = parseFloat(item.mb) || 0;
      const leftMB = parseFloat(item.mbleft) || 0;
      const downloadedMB = totalMB - leftMB;

      // Parse ETA (format: "HH:MM:SS" or "00:00:00" or "unknown")
      let eta: number | undefined;
      if (item.timeleft && item.timeleft !== "0:00:00" && item.timeleft !== "unknown") {
        const [hours, minutes, seconds] = item.timeleft.split(":").map(Number);
        eta = hours * 3600 + minutes * 60 + seconds;
      }

      // Map SABnzbd status to our status
      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      switch (item.status.toLowerCase()) {
        case "downloading":
        case "fetching":
          status = "downloading";
          break;
        case "paused":
          status = "paused";
          break;
        case "repairing":
          status = "repairing";
          repairStatus = "repairing";
          break;
        case "extracting":
        case "unpacking":
          status = "unpacking";
          unpackStatus = "unpacking";
          break;
        case "completed":
          status = "completed";
          repairStatus = "good";
          unpackStatus = "completed";
          break;
        case "failed":
          status = "error";
          repairStatus = "failed";
          break;
        default:
          status = "downloading";
      }

      return {
        id: item.nzo_id,
        name: item.filename,
        downloadType: "usenet",
        status,
        progress,
        downloadSpeed: (parseFloat(queue.speed) || 0) * 1024 * 1024, // Convert MB/s to bytes/s
        eta,
        size: totalMB * 1024 * 1024, // Convert MB to bytes
        downloaded: downloadedMB * 1024 * 1024,
        category: item.cat,
        repairStatus,
        unpackStatus,
        age: parseFloat(item.avg_age) || undefined,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd status");
      return null;
    }
  }

  private async getFromHistory(id: string): Promise<DownloadStatus | null> {
    // Try with nzo_ids filter first (optimization). Some SABnzbd versions ignore
    // this parameter and return all history, or return empty slots — in that case
    // fall back to fetching the full history and searching locally.
    for (const useFilter of [true, false]) {
      try {
        const params: Record<string, string> = useFilter ? { nzo_ids: id } : {};
        const url = this.getApiUrl("history", params);
        downloadersLogger.debug({ id, useFilter }, "SABnzbd: fetching history");
        const response = await this.fetchWithFallback(url);
        const data = await response.json();
        const history: SABnzbdHistory = data.history;

        if (!history?.slots) {
          downloadersLogger.debug({ id, useFilter }, "SABnzbd: history response missing slots");
          return null;
        }

        const item = history.slots.find((slot) => slot.nzo_id === id);
        downloadersLogger.debug(
          { id, useFilter, slotCount: history.slots.length, found: !!item },
          "SABnzbd: history result"
        );

        if (!item) {
          // If we used the nzo_ids filter and got no results, the filter may not be
          // supported — retry with a full history scan.
          if (useFilter) continue;
          return null;
        }

        let status: DownloadStatus["status"];
        let repairStatus: DownloadStatus["repairStatus"];
        let unpackStatus: DownloadStatus["unpackStatus"];

        if (item.status === "Completed") {
          status = "completed";
          repairStatus = "good";
          unpackStatus = "completed";
        } else if (item.status === "Failed") {
          status = "error";
          repairStatus = "failed";
        } else {
          status = "paused";
        }

        return {
          id: item.nzo_id,
          name: item.name,
          downloadType: "usenet",
          status,
          progress: status === "completed" ? 100 : 0,
          size: item.bytes,
          downloaded: item.bytes,
          category: item.category,
          error: status === "error" ? item.fail_message : undefined,
          repairStatus,
          unpackStatus,
        };
      } catch (error) {
        downloadersLogger.error(
          { error, id, useFilter: useFilter },
          "Failed to get SABnzbd history"
        );
        // If the filtered request failed, retry with a full history scan
        if (useFilter) continue;
        return null;
      }
    }
    /* v8 ignore next -- loop always returns or continues before reaching this fallback */
    return null;
  }

  private async getHistoryDownloadDir(id: string): Promise<string | undefined> {
    for (const useFilter of [true, false]) {
      try {
        const params: Record<string, string> = useFilter ? { nzo_ids: id } : {};
        const url = this.getApiUrl("history", params);
        const response = await this.fetchWithFallback(url);
        const data = await response.json();
        const history: SABnzbdHistory = data.history;
        if (!history?.slots) return undefined;
        const item = history.slots.find((slot) => slot.nzo_id === id);
        if (!item) {
          if (useFilter) continue;
          return undefined;
        }
        return this.resolveHistoryDownloadDir(item);
      } catch {
        if (useFilter) continue;
        return undefined;
      }
    }
    return undefined;
  }

  private resolveHistoryDownloadDir(item: SABnzbdHistory["slots"][number]): string | undefined {
    const completedPath = item.path
      ? stripTrailingPathSeparators(
          item.path
            .replaceAll("/incomplete/", "/complete/")
            .replaceAll("\\incomplete\\", "\\complete\\")
        )
      : undefined;
    // `storage` is SABnzbd's final resting place for the completed job
    if (item.storage) {
      const normalizedStorage = stripTrailingPathSeparators(item.storage);
      if (completedPath) {
        const normalizedStoragePosix = normalizedStorage.replaceAll("\\", "/");
        const completedPathPosix = completedPath.replaceAll("\\", "/");
        if (
          normalizedStoragePosix === completedPathPosix ||
          normalizedStoragePosix.startsWith(`${completedPathPosix}/`)
        ) {
          return completedPath;
        }
      }

      return normalizedStorage;
    }
    // Fallback for older SABnzbd versions that don't expose `storage`.
    return completedPath;
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const status = await this.getDownloadStatus(id);
    if (!status) return null;

    const downloadDir =
      status.status === "completed" ? await this.getHistoryDownloadDir(id) : undefined;

    return {
      ...status,
      downloadDir,
      files: [],
      filesSupport: "unsupported",
      filesSupportReason: "SABnzbd API does not expose per-file details for queue/history items.",
      trackers: [],
    };
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      const url = this.getApiUrl("queue");
      const response = await this.fetchWithFallback(url);
      const data = await response.json();
      const queue: SABnzbdQueue = data.queue;

      const results: DownloadStatus[] = [];

      for (const item of queue.slots) {
        const status = await this.getDownloadStatus(item.nzo_id);
        if (status) {
          results.push(status);
        }
      }

      return results;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd queue");
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getApiUrl("pause", { value: id });
      const response = await this.fetchWithFallback(url);
      const data = await response.json();

      if (data.status === true) {
        return { success: true, message: "NZB paused" };
      }

      return { success: false, message: "Failed to pause NZB" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getApiUrl("resume", { value: id });
      const response = await this.fetchWithFallback(url);
      const data = await response.json();

      if (data.status === true) {
        return { success: true, message: "NZB resumed" };
      }

      return { success: false, message: "Failed to resume NZB" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async removeDownload(
    id: string,
    _deleteFiles?: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.getApiUrl("queue", { name: "delete", value: id });
      const response = await this.fetchWithFallback(url);
      const data = await response.json();

      if (data.status === true) {
        return { success: true, message: "NZB removed" };
      }

      return { success: false, message: "Failed to remove NZB" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const url = this.getApiUrl("queue");
      const response = await this.fetchWithFallback(url);
      const data = await response.json();

      // diskspace1 is free disk space in GB (float)
      const gb = parseFloat(data.queue?.diskspace1);
      if (!isNaN(gb)) {
        return gb * 1024 * 1024 * 1024;
      }

      return 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get SABnzbd free space");
      return 0;
    }
  }
}
