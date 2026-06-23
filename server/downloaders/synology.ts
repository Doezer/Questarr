import type {
  Downloader,
  DownloadStatus,
  DownloadFile,
  DownloadTracker,
  DownloadDetails,
} from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import { fetchWithMagnetDetection, extractHashFromUrl } from "./utils.js";

interface SynologyApiDescriptor {
  path: string;
  minVersion: number;
  maxVersion: number;
}

interface SynologyErrorResponse {
  code?: number;
}

interface SynologyApiResponse {
  success: boolean;
  error?: SynologyErrorResponse;
}

interface SynologyApiInfoResponse extends SynologyApiResponse {
  data?: Record<string, SynologyApiDescriptor>;
}

interface SynologyAuthResponse extends SynologyApiResponse {
  data?: {
    sid?: string;
  };
}

interface SynologyTaskTransfer {
  size_downloaded?: number;
  size_uploaded?: number;
  speed_download?: number;
  speed_upload?: number;
}

interface SynologyTaskDetail {
  destination?: string;
  uri?: string;
  create_time?: number;
  completed_time?: number;
}

interface SynologyTaskFileInfo {
  filename?: string;
  path?: string;
  size?: number;
  size_downloaded?: number;
  priority?: string | number;
  wanted?: boolean;
}

interface SynologyTaskTrackerInfo {
  url?: string;
  tier?: number;
  status?: string;
  seeders?: number;
  leechers?: number;
  last_announce_time?: number;
  next_announce_time?: number;
  error?: string;
}

interface SynologyTaskAdditional {
  detail?: SynologyTaskDetail;
  transfer?: SynologyTaskTransfer;
  file?: SynologyTaskFileInfo[];
  tracker?: SynologyTaskTrackerInfo[];
}

interface SynologyTask {
  id: string;
  title?: string;
  size?: number;
  status?: string;
  type?: string;
  additional?: SynologyTaskAdditional;
}

interface SynologyTaskResponse extends SynologyApiResponse {
  data?: {
    task_id?: string[];
    tasks?: SynologyTask[];
  };
}

interface SynologyFileStationVolumeStatus {
  free?: number;
  total?: number;
  used?: number;
}

interface SynologyFileStationResponse extends SynologyApiResponse {
  data?: {
    useable_space?: number;
    volume_status?: SynologyFileStationVolumeStatus[];
  };
}

export class SynologyDownloadStationClient implements DownloaderClient {
  private downloader: Downloader;
  private sessionId: string | null = null;
  private apiInfo: Record<string, SynologyApiDescriptor> | null = null;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  private getBaseUrlParts(): { origin: string; prefix: string } {
    let baseUrl = this.downloader.url;
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const protocol = this.downloader.useSsl ? "https://" : "http://";
      baseUrl = protocol + baseUrl;
    }

    const normalizedUrlPath = (this.downloader.urlPath ?? "").trim().replace(/^\/+|\/+$/g, "");

    try {
      const urlObj = new URL(baseUrl);
      if (this.downloader.port) {
        urlObj.port = this.downloader.port.toString();
      }

      const pathParts = [urlObj.pathname, normalizedUrlPath]
        .flatMap((path) => path.split("/"))
        .filter(Boolean);

      return {
        origin: `${urlObj.protocol}//${urlObj.host}`,
        prefix: pathParts.length > 0 ? `/${pathParts.join("/")}` : "",
      };
    } catch {
      const trimmedBaseUrl = baseUrl.replace(/\/$/, "");
      return {
        origin: trimmedBaseUrl,
        prefix: normalizedUrlPath ? `/${normalizedUrlPath}` : "",
      };
    }
  }

  private getWebApiUrl(apiPath: string): string {
    const { origin, prefix } = this.getBaseUrlParts();
    return `${origin}${prefix}/webapi/${apiPath.replace(/^\/+/, "")}`;
  }

  private getPreferredApiVersion(descriptor: SynologyApiDescriptor, preferred: number): number {
    return Math.max(descriptor.minVersion, Math.min(descriptor.maxVersion, preferred));
  }

  private getApiDescriptor(apiName: string): SynologyApiDescriptor {
    const descriptor = this.apiInfo?.[apiName];
    if (!descriptor) {
      throw new Error(`Synology API ${apiName} is not available on this server`);
    }
    return descriptor;
  }

  private getTaskApiDescriptor(): { apiName: string; descriptor: SynologyApiDescriptor } {
    if (!this.apiInfo) {
      throw new Error("Synology API information has not been loaded");
    }

    if (this.apiInfo["SYNO.DownloadStation2.Task"]) {
      return {
        apiName: "SYNO.DownloadStation2.Task",
        descriptor: this.apiInfo["SYNO.DownloadStation2.Task"],
      };
    }

    if (this.apiInfo["SYNO.DownloadStation.Task"]) {
      return {
        apiName: "SYNO.DownloadStation.Task",
        descriptor: this.apiInfo["SYNO.DownloadStation.Task"],
      };
    }

    throw new Error("Synology Download Station Task API is not available on this server");
  }

  private buildSynologyErrorMessage(code: number | undefined, fallback: string): string {
    switch (code) {
      case 101:
        return "Synology rejected the request parameters";
      case 105:
        return "Synology permission denied";
      case 106:
        return "Synology session expired";
      case 400:
        return "Synology authentication failed";
      case 401:
        return "Synology maximum task limit reached";
      case 402:
        return "Synology destination access denied";
      case 403:
        return "Synology destination was not found";
      default:
        return code ? `${fallback} (code ${code})` : fallback;
    }
  }

  private async fetchJson<T extends SynologyApiResponse>(
    url: string,
    init: RequestInit,
    context: string
  ): Promise<T> {
    if (!(await isSafeUrl(url))) {
      throw new Error("Unsafe URL blocked");
    }

    const response = await safeFetch(url, {
      ...init,
      headers: {
        "User-Agent": "Questarr/1.0",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details available");
      throw new Error(`${context}: HTTP ${response.status} ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as T;
  }

  private appendApiParams(
    target: URLSearchParams | FormData,
    params: Record<string, string | number | boolean | undefined>
  ): void {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      target.append(key, String(value));
    }
  }

  private async ensureApiInfo(): Promise<void> {
    if (this.apiInfo) {
      return;
    }

    const queryParams = new URLSearchParams({
      api: "SYNO.API.Info",
      version: "1",
      method: "query",
      query:
        "SYNO.API.Auth,SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task,SYNO.FileStation.Info",
    });

    const url = this.getWebApiUrl(`query.cgi?${queryParams.toString()}`);
    const response = await this.fetchJson<SynologyApiInfoResponse>(
      url,
      { method: "GET" },
      "Failed to query Synology APIs"
    );

    if (!response.success || !response.data) {
      throw new Error(
        this.buildSynologyErrorMessage(response.error?.code, "Failed to query Synology APIs")
      );
    }

    this.apiInfo = response.data;
    this.getApiDescriptor("SYNO.API.Auth");
    this.getTaskApiDescriptor();
  }

  private async authenticate(force = false): Promise<void> {
    if (this.sessionId && !force) {
      return;
    }

    if (!this.downloader.username || !this.downloader.password) {
      throw new Error("Synology Download Station requires a username and password");
    }

    await this.ensureApiInfo();

    const authDescriptor = this.getApiDescriptor("SYNO.API.Auth");
    const authParams = new URLSearchParams({
      api: "SYNO.API.Auth",
      version: this.getPreferredApiVersion(authDescriptor, 6).toString(),
      method: "login",
      account: this.downloader.username,
      passwd: this.downloader.password,
      session: "DownloadStation",
      format: "sid",
    });

    const url = this.getWebApiUrl(`${authDescriptor.path}?${authParams.toString()}`);
    const response = await this.fetchJson<SynologyAuthResponse>(
      url,
      { method: "GET" },
      "Failed to authenticate with Synology Download Station"
    );

    if (!response.success || !response.data?.sid) {
      throw new Error(
        this.buildSynologyErrorMessage(
          response.error?.code,
          "Failed to authenticate with Synology Download Station"
        )
      );
    }

    this.sessionId = response.data.sid;
  }

  private async logout(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      await this.ensureApiInfo();
      const authDescriptor = this.getApiDescriptor("SYNO.API.Auth");
      const logoutParams = new URLSearchParams({
        api: "SYNO.API.Auth",
        version: this.getPreferredApiVersion(authDescriptor, 6).toString(),
        method: "logout",
        session: "DownloadStation",
        _sid: this.sessionId,
      });

      const url = this.getWebApiUrl(`${authDescriptor.path}?${logoutParams.toString()}`);
      await this.fetchJson<SynologyApiResponse>(
        url,
        { method: "GET" },
        "Failed to log out from Synology Download Station"
      );
    } catch (error) {
      downloadersLogger.debug({ error }, "Synology logout failed");
    } finally {
      this.sessionId = null;
    }
  }

  private async requestApi<T extends SynologyApiResponse>(
    apiName: string,
    descriptor: SynologyApiDescriptor,
    preferredVersion: number,
    methodName: string,
    options: {
      httpMethod?: "GET" | "POST";
      params?: Record<string, string | number | boolean | undefined>;
      body?: URLSearchParams | FormData;
      retryOnAuthFailure?: boolean;
      requiresAuth?: boolean;
    } = {}
  ): Promise<T> {
    const httpMethod = options.httpMethod ?? "GET";
    const requiresAuth = options.requiresAuth ?? true;
    const retryOnAuthFailure = options.retryOnAuthFailure ?? true;

    if (requiresAuth) {
      await this.authenticate();
    } else {
      await this.ensureApiInfo();
    }

    const params: Record<string, string | number | boolean | undefined> = {
      api: apiName,
      version: this.getPreferredApiVersion(descriptor, preferredVersion),
      method: methodName,
      ...(options.params ?? {}),
    };

    if (requiresAuth) {
      params._sid = this.sessionId ?? undefined;
    }

    const url = this.getWebApiUrl(descriptor.path);
    let body: BodyInit | undefined;
    const headers: Record<string, string> = {};

    if (httpMethod === "GET") {
      const query = new URLSearchParams();
      this.appendApiParams(query, params);
      const requestUrl = `${url}?${query.toString()}`;
      const response = await this.fetchJson<T>(
        requestUrl,
        { method: "GET" },
        `Synology ${apiName}.${methodName} failed`
      );

      if (!response.success && response.error?.code === 106 && requiresAuth && retryOnAuthFailure) {
        this.sessionId = null;
        await this.authenticate(true);
        return this.requestApi(apiName, descriptor, preferredVersion, methodName, {
          ...options,
          retryOnAuthFailure: false,
        });
      }

      if (!response.success) {
        throw new Error(
          this.buildSynologyErrorMessage(
            response.error?.code,
            `Synology ${apiName}.${methodName} failed`
          )
        );
      }

      return response;
    }

    if (options.body instanceof FormData) {
      const formData = options.body;
      this.appendApiParams(formData, params);
      body = formData;
    } else {
      const formBody =
        options.body instanceof URLSearchParams ? options.body : new URLSearchParams();
      this.appendApiParams(formBody, params);
      body = formBody;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const response = await this.fetchJson<T>(
      url,
      { method: httpMethod, body, headers },
      `Synology ${apiName}.${methodName} failed`
    );

    if (!response.success && response.error?.code === 106 && requiresAuth && retryOnAuthFailure) {
      this.sessionId = null;
      await this.authenticate(true);
      return this.requestApi(apiName, descriptor, preferredVersion, methodName, {
        ...options,
        retryOnAuthFailure: false,
      });
    }

    if (!response.success) {
      throw new Error(
        this.buildSynologyErrorMessage(
          response.error?.code,
          `Synology ${apiName}.${methodName} failed`
        )
      );
    }

    return response;
  }

  private async requestTaskApi<T extends SynologyApiResponse>(
    methodName: string,
    options: {
      httpMethod?: "GET" | "POST";
      params?: Record<string, string | number | boolean | undefined>;
      body?: URLSearchParams | FormData;
      retryOnAuthFailure?: boolean;
    } = {}
  ): Promise<T> {
    await this.ensureApiInfo();
    const { apiName, descriptor } = this.getTaskApiDescriptor();
    const preferredVersion = apiName === "SYNO.DownloadStation2.Task" ? 2 : 3;

    return this.requestApi<T>(apiName, descriptor, preferredVersion, methodName, options);
  }

  private normalizeSynologyStatus(
    rawStatus: string | undefined,
    progress: number
  ): DownloadStatus["status"] {
    switch (rawStatus) {
      case "downloading":
      case "finishing":
      case "hash_checking":
      case "extracting":
      case "filehosting_waiting":
      case "waiting":
        return progress >= 100 ? "completed" : "downloading";
      case "seeding":
        return "seeding";
      case "finished":
        return "completed";
      case "paused":
        return progress >= 100 ? "completed" : "paused";
      case "error":
        return "error";
      default:
        return progress >= 100 ? "completed" : "downloading";
    }
  }

  private mapSynologyFilePriority(priority: string | number | undefined): DownloadFile["priority"] {
    if (priority === "high" || priority === 2) {
      return "high";
    }
    if (priority === "low" || priority === 0) {
      return "low";
    }
    return "normal";
  }

  private mapSynologyTrackerStatus(
    rawStatus: string | undefined,
    error: string | undefined
  ): DownloadTracker["status"] {
    if (error) {
      return "error";
    }
    if (!rawStatus) {
      return "inactive";
    }
    if (["working", "active", "enabled", "normal", "connected"].includes(rawStatus)) {
      return "working";
    }
    if (["wait", "updating", "connecting"].includes(rawStatus)) {
      return "updating";
    }
    if (["error", "failed", "warning"].includes(rawStatus)) {
      return "error";
    }
    return "inactive";
  }

  private mapSynologyStatus(task: SynologyTask): DownloadStatus {
    const transfer = task.additional?.transfer;
    const downloaded = transfer?.size_downloaded ?? 0;
    const size = task.size ?? 0;
    let progress = 0;
    if (size > 0) {
      progress = Math.round((downloaded / size) * 100);
    } else if (task.status === "finished") {
      progress = 100;
    }

    const status = this.normalizeSynologyStatus(task.status, progress);
    const ratio =
      transfer?.size_downloaded && transfer.size_downloaded > 0 && transfer.size_uploaded != null
        ? transfer.size_uploaded / transfer.size_downloaded
        : undefined;
    const trackerSwarmCounts = this.getTrackerSwarmCounts(task.additional?.tracker);

    return {
      id: task.id,
      name: task.title || task.id,
      status,
      progress,
      downloadSpeed: transfer?.speed_download,
      uploadSpeed: transfer?.speed_upload,
      eta:
        transfer?.speed_download && size > downloaded
          ? Math.round((size - downloaded) / transfer.speed_download)
          : undefined,
      size: size || undefined,
      downloaded: downloaded || undefined,
      seeders: trackerSwarmCounts.seeders,
      leechers: trackerSwarmCounts.leechers,
      ratio,
      error: task.status === "error" ? "Synology Download Station reported an error" : undefined,
    };
  }

  private mapSynologyDetails(task: SynologyTask): DownloadDetails {
    const baseStatus = this.mapSynologyStatus(task);
    const files = (task.additional?.file ?? []).map((file) => {
      const size = file.size ?? 0;
      const downloaded = file.size_downloaded ?? 0;
      return {
        name: file.filename || file.path || "Unknown file",
        size,
        progress: size > 0 ? Math.round((downloaded / size) * 100) : 0,
        priority: this.mapSynologyFilePriority(file.priority),
        wanted: file.wanted ?? true,
      };
    });

    const trackers = (task.additional?.tracker ?? [])
      .filter((tracker) => !!tracker.url)
      .map((tracker) => ({
        url: tracker.url!,
        tier: tracker.tier ?? 0,
        status: this.mapSynologyTrackerStatus(tracker.status, tracker.error),
        seeders: tracker.seeders,
        leechers: tracker.leechers,
        lastAnnounce:
          tracker.last_announce_time && tracker.last_announce_time > 0
            ? new Date(tracker.last_announce_time * 1000).toISOString()
            : undefined,
        nextAnnounce:
          tracker.next_announce_time && tracker.next_announce_time > 0
            ? new Date(tracker.next_announce_time * 1000).toISOString()
            : undefined,
        error: tracker.error,
      }));

    const detail = task.additional?.detail;
    const hash =
      detail?.uri && detail.uri.startsWith("magnet:")
        ? (extractHashFromUrl(detail.uri) ?? undefined)
        : undefined;

    return {
      ...baseStatus,
      hash,
      addedDate:
        detail?.create_time && detail.create_time > 0
          ? new Date(detail.create_time * 1000).toISOString()
          : undefined,
      completedDate:
        detail?.completed_time && detail.completed_time > 0
          ? new Date(detail.completed_time * 1000).toISOString()
          : undefined,
      downloadDir: detail?.destination,
      files,
      filesSupport: "supported",
      trackers,
    };
  }

  private async getTask(id: string, additional: string): Promise<SynologyTask | null> {
    const response = await this.requestTaskApi<SynologyTaskResponse>("getinfo", {
      httpMethod: "GET",
      params: {
        id,
        additional,
      },
    });

    return response.data?.tasks?.[0] ?? null;
  }

  private getSynologyDestination(request: DownloadRequest): string | undefined {
    return request.downloadPath || this.downloader.downloadPath || undefined;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      await this.logout();
      return { success: true, message: "Connected successfully to Synology Download Station" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to connect to Synology Download Station: ${errorMessage}`,
      };
    }
  }

  async logVersionInfo(): Promise<void> {
    await this.ensureApiInfo();

    const authDescriptor = this.apiInfo?.["SYNO.API.Auth"];
    const taskDescriptor = this.apiInfo?.["SYNO.DownloadStation2.Task"];
    const legacyTaskDescriptor = this.apiInfo?.["SYNO.DownloadStation.Task"];
    const fileStationDescriptor = this.apiInfo?.["SYNO.FileStation.Info"];

    downloadersLogger.info(
      {
        downloaderId: this.downloader.id,
        downloaderType: this.downloader.type,
        authApiVersion: authDescriptor?.maxVersion,
        downloadStationTaskApiVersion: taskDescriptor?.maxVersion,
        legacyDownloadStationTaskApiVersion: legacyTaskDescriptor?.maxVersion,
        fileStationApiVersion: fileStationDescriptor?.maxVersion,
      },
      "Downloader version probe completed"
    );
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return { success: false, message: "Download URL is required" };
      }

      await this.ensureApiInfo();
      const { apiName } = this.getTaskApiDescriptor();
      const destination = this.getSynologyDestination(request);
      const isMagnet = request.url.startsWith("magnet:");

      const createUrlDownload = async (downloadUrl: string) => {
        const response = await this.requestTaskApi<SynologyTaskResponse>("create", {
          httpMethod: "POST",
          params:
            apiName === "SYNO.DownloadStation2.Task"
              ? {
                  type: "url",
                  url: downloadUrl,
                  create_list: "false",
                  destination,
                }
              : {
                  uri: downloadUrl,
                  destination,
                },
        });

        const id = response.data?.task_id?.[0];
        return {
          success: true,
          id,
          message: "Download added successfully",
        };
      };

      if (isMagnet) {
        return createUrlDownload(request.url);
      }

      if (!(await isSafeUrl(request.url))) {
        return { success: false, message: "Unsafe URL blocked" };
      }

      const fetchResult = await fetchWithMagnetDetection(request.url);
      if (fetchResult.magnetLink) {
        return createUrlDownload(fetchResult.magnetLink);
      }

      if (!fetchResult.response?.ok) {
        return {
          success: false,
          message: `Failed to fetch download: ${fetchResult.response?.statusText || "Unknown error"}`,
        };
      }

      return this.addFileUpload(request, destination, apiName, fetchResult.response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to add download to Synology Download Station: ${errorMessage}`,
      };
    }
  }

  private async addFileUpload(
    request: DownloadRequest,
    destination: string | undefined,
    apiName: string,
    response: Response
  ): Promise<{ success: boolean; id?: string; message: string }> {
    const contentDisposition = response.headers.get("content-disposition") || "";
    const fileNameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const fileName =
      fileNameMatch?.[1] != null
        ? decodeURIComponent(fileNameMatch[1].replace(/"/g, ""))
        : `${request.title || "download"}.${request.downloadType === "usenet" ? "nzb" : "torrent"}`;

    const fileContents =
      typeof response.arrayBuffer === "function"
        ? await response.arrayBuffer()
        : typeof response.blob === "function"
          ? await (await response.blob()).arrayBuffer()
          : Buffer.from(await response.text());

    const fileBlob = new Blob([fileContents], {
      type: response.headers.get("content-type") || "application/octet-stream",
    });
    const formData = new FormData();
    formData.append("file", fileBlob, fileName);

    if (destination) {
      formData.append("destination", destination);
    }

    if (apiName === "SYNO.DownloadStation2.Task") {
      const isNzb = request.downloadType === "usenet" || fileName.toLowerCase().endsWith(".nzb");
      formData.append("type", isNzb ? "nzb" : "bt");
    }

    const uploadResponse = await this.requestTaskApi<SynologyTaskResponse>("create", {
      httpMethod: "POST",
      body: formData,
    });

    return {
      success: true,
      id: uploadResponse.data?.task_id?.[0],
      message: "Download added successfully",
    };
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const task = await this.getTask(id, "detail,transfer,tracker");
      return task ? this.mapSynologyStatus(task) : null;
    } catch (error) {
      downloadersLogger.error({ error, id }, "Failed to get Synology download status");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      const task = await this.getTask(id, "detail,transfer,file,tracker");
      return task ? this.mapSynologyDetails(task) : null;
    } catch (error) {
      downloadersLogger.error({ error, id }, "Failed to get Synology download details");
      return null;
    }
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      const response = await this.requestTaskApi<SynologyTaskResponse>("list", {
        httpMethod: "GET",
        params: {
          additional: "detail,transfer,tracker",
        },
      });

      return (response.data?.tasks ?? []).map((task) => this.mapSynologyStatus(task));
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to list Synology downloads");
      return [];
    }
  }

  private getTrackerSwarmCounts(trackers: SynologyTaskTrackerInfo[] | undefined): {
    seeders?: number;
    leechers?: number;
  } {
    let seeders: number | undefined;
    let leechers: number | undefined;

    for (const tracker of trackers ?? []) {
      const trackerSeeders =
        typeof tracker.seeders === "number" &&
        Number.isFinite(tracker.seeders) &&
        tracker.seeders >= 0
          ? tracker.seeders
          : undefined;
      const trackerLeechers =
        typeof tracker.leechers === "number" &&
        Number.isFinite(tracker.leechers) &&
        tracker.leechers >= 0
          ? tracker.leechers
          : undefined;

      if (trackerSeeders !== undefined) {
        seeders = seeders === undefined ? trackerSeeders : Math.max(seeders, trackerSeeders);
      }
      if (trackerLeechers !== undefined) {
        leechers = leechers === undefined ? trackerLeechers : Math.max(leechers, trackerLeechers);
      }
    }

    return { seeders, leechers };
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.requestTaskApi("pause", {
        httpMethod: "GET",
        params: { id },
      });
      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.requestTaskApi("resume", {
        httpMethod: "GET",
        params: { id },
      });
      return { success: true, message: "Download resumed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to resume download: ${errorMessage}` };
    }
  }

  async removeDownload(
    id: string,
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.requestTaskApi("delete", {
        httpMethod: "GET",
        params: {
          id,
          remove: deleteFiles,
          force_complete: deleteFiles,
        },
      });
      return { success: true, message: "Download removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove download: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      await this.ensureApiInfo();
      const descriptor = this.apiInfo?.["SYNO.FileStation.Info"];
      if (!descriptor) {
        return 0;
      }

      const response = await this.requestApi<SynologyFileStationResponse>(
        "SYNO.FileStation.Info",
        descriptor,
        2,
        "get",
        {
          httpMethod: "GET",
        }
      );

      if (typeof response.data?.useable_space === "number") {
        return response.data.useable_space;
      }

      return response.data?.volume_status?.[0]?.free ?? 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get Synology free space");
      return 0;
    }
  }
}
