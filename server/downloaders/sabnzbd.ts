import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import https from "https";
import { isSafeUrl, resolveSafeAddress, safeFetch } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import { fixNzbUrlEncoding } from "./utils.js";

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

  private async fetchWithFallback(url: string, options: RequestInit = {}): Promise<Response> {
    try {
      return await safeFetch(url, { ...options, allowPrivate: true });
    } catch (error) {
      const isSslError =
        error instanceof Error &&
        (error.message.includes("self-signed") ||
          error.message.includes("certificate") ||
          (error.cause as { code: string })?.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
          (error.cause as { code: string })?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
          (error.cause as { code: string })?.code === "CERT_HAS_EXPIRED");

      if (isSslError) {
        downloadersLogger.debug(
          { url },
          "SSL verification failed, retrying with insecure connection"
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
            resolve({
              ok: !!(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
              status: res.statusCode || 0,
              statusText: res.statusMessage || "",
              text: async () => body,
              json: async () => {
                try {
                  return JSON.parse(body);
                } catch {
                  throw new Error(`Failed to parse JSON: ${body}`);
                }
              },
              headers: {
                get: (name: string) => {
                  const val = res.headers[name.toLowerCase()];
                  return Array.isArray(val) ? val[0] : val || null;
                },
              },
            } as unknown as Response);
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
      downloadersLogger.error(
        { error, url: this.getApiUrl("version") },
        "SABnzbd connection test failed"
      );
      return {
        success: false,
        message: `Failed to connect to SABnzbd at ${this.getApiUrl("version")}: ${errorMessage}`,
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
    downloadersLogger.debug({ url }, "Testing SABnzbd connection");
    const response = await this.fetchWithFallback(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details");
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as Record<string, unknown>;
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

      const url = this.getApiUrl("addfile", {
        nzbname: request.title,
        cat: request.category || "games",
        priority: (request.priority || 0).toString(),
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

      const response = await this.fetchWithFallback(url, {
        method: "POST",
        body: multipartBody,
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        signal: AbortSignal.timeout(30000),
      });

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
        // Normalize SABnzbd's /incomplete/ paths to /complete/
        return item.path?.replace(/\/incomplete\//g, "/complete/");
      } catch {
        if (useFilter) continue;
        return undefined;
      }
    }
    return undefined;
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
