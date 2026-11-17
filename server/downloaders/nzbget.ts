import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { resolveArchivePassword } from "../../shared/archive-password.js";
import { downloadersLogger } from "../logger.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import {
  assertCredentialsAllowed,
  buildBasicAuthHeader,
  buildDownloaderBaseUrl,
  escapeXml,
  findTorrentByTagNull,
  fixNzbUrlEncoding,
  isHttpsUrl,
  logDownloaderDebugResponse,
} from "./utils.js";
import { parseXmlRpcResponse, serializeXmlRpcValue } from "./xmlrpc.js";

interface NZBGetListResult {
  NZBID: number;
  NZBName: string;
  Status: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
  Category: string;
  DownloadRate: number;
  PostInfoText: string;
  PostStageProgress: number;
  PostStageTimeSec: number;
}

interface NZBGetHistoryResult {
  NZBID: number;
  Name: string;
  Status: string;
  FileSizeMB: number;
  Category: string;
  DownloadTimeSec: number;
  ParStatus: string; // "SUCCESS", "FAILURE", "REPAIR_POSSIBLE", "MANUAL", "NONE"
  UnpackStatus: string; // "SUCCESS", "FAILURE", "NONE"
  FailedArticles: number;
  DeleteStatus: string;
  DestDir: string;
}

const HISTORY_FAILURE_REASONS: Record<string, string> = {
  PASSWORD:
    "NZBGet could not unpack the archive: the password is missing or wrong. Fix the password in NZBGet and post-process the item again.",
  UNPACK: "NZBGet failed to unpack the archive (corrupt archive, or missing/wrong password).",
  PAR: "NZBGet could not repair the download with par2.",
  HEALTH: "NZBGet aborted the download because too many articles are missing.",
  BAD: "NZBGet aborted the download after a post-processing script flagged it as bad.",
  SCAN: "NZBGet could not parse the NZB file (malformed NZB); check the NZB or its source.",
  MOVE: "NZBGet could not move the finished files to the destination folder.",
  DISK: "NZBGet ran out of disk space.",
  SPACE: "NZBGet ran out of disk space.",
  FETCH: "NZBGet could not fetch the NZB file.",
};

/** Builds a readable failure reason from NZBGet's "<overall>/<detail>" history status. */
export function describeHistoryFailure(item: {
  Status: string;
  ParStatus?: string;
  UnpackStatus?: string;
}): string {
  const [overall = "", detail = ""] = item.Status.split("/");
  const known = HISTORY_FAILURE_REASONS[detail.toUpperCase()];
  if (known) return known;
  if (overall === "DELETED") return `Removed from NZBGet (${item.Status}).`;
  if (item.UnpackStatus === "FAILURE") return HISTORY_FAILURE_REASONS.UNPACK!;
  if (item.ParStatus === "FAILURE") return HISTORY_FAILURE_REASONS.PAR!;
  return `NZBGet reported ${item.Status}.`;
}

export class NZBGetClient implements DownloaderClient {
  private downloader: Downloader;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  private getBaseUrl(): string {
    return buildDownloaderBaseUrl(this.downloader);
  }

  /**
   * Sends an NZBGet XML-RPC request, adding Basic authentication when configured.
   *
   * @param requireHttps - Whether redirects must remain on HTTPS, used for requests
   * whose payload contains an archive password. Only enforced when the request itself
   * starts out on HTTPS, so an "Allow insecure LAN" downloader over HTTP still works.
   * @throws If the transport policy forbids the configured credentials, the HTTP
   * call fails, or NZBGet's response is itself an XML-RPC fault.
   */
  private async makeXMLRPCRequest(
    method: string,
    params: unknown[] = [],
    requireHttps = false
  ): Promise<unknown> {
    const baseUrl = this.getBaseUrl();
    const path = this.downloader.urlPath || "xmlrpc";
    const url = `${baseUrl}/${path.replace(/^\//, "")}`;

    const xmlParams = params
      .map((param) => `<param><value>${serializeXmlRpcValue(param)}</value></param>`)
      .join("");

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>${escapeXml(method)}</methodName>
  <params>
    ${xmlParams}
  </params>
</methodCall>`;

    const headers: Record<string, string> = {
      "Content-Type": "text/xml",
      "User-Agent": "Questarr/1.0",
    };

    if (this.downloader.username && this.downloader.password) {
      assertCredentialsAllowed(this.downloader, url, "NZBGet");
      headers["Authorization"] = buildBasicAuthHeader(
        this.downloader.username,
        this.downloader.password
      );
    }

    // PPParameters (the trailing "append" param) can carry secrets we hand NZBGet's
    // post-processors -- e.g. "*Unpack:Password" for the archive password -- so redact
    // every entry's value rather than logging it in the clear alongside the NZB content.
    const redactPPParameters = (values: unknown[]): unknown[] => {
      const lastIndex = values.length - 1;
      const ppParameters = values[lastIndex];
      if (!Array.isArray(ppParameters)) return values;
      const redacted = ppParameters.map((param) =>
        param && typeof param === "object" && "Name" in param
          ? { ...param, Value: "<redacted>" }
          : param
      );
      return [...values.slice(0, lastIndex), redacted];
    };

    const logParams =
      method === "append" && params.length > 1
        ? redactPPParameters([params[0], "<base64_content_truncated>", ...params.slice(2)])
        : params;

    downloadersLogger.debug({ url, method, params: logParams }, "Making NZBGet XML-RPC request");

    // requireHttps is set by addDownload exactly when this request carries the archive
    // password -- refuse to follow a redirect to a non-HTTPS hop, since a compromised or
    // MITM'd NZBGet could otherwise bounce the credential-bearing request body to a
    // plaintext endpoint mid-flight (a 307/308 redirect preserves the POST body as-is).
    const response = await safeFetch(url, {
      method: "POST",
      headers,
      body: xmlBody,
      signal: AbortSignal.timeout(30000),
      requireHttps: requireHttps && isHttpsUrl(url),
      // A password-bearing body sent over plain HTTP (insecure LAN opt-in) must not
      // follow a redirect to another host.
      pinOrigin: requireHttps && !isHttpsUrl(url),
    });

    await logDownloaderDebugResponse("NZBGet", method, url, response);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const responseText = await response.text();

    return parseXmlRpcResponse(responseText, {
      lenient: true,
      formatFault: (fault) =>
        `NZBGet Fault: ${fault["faultString"] as string} (${fault["faultCode"] as number})`,
    });
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const version = await this.makeXMLRPCRequest("version");
      return { success: true, message: `Connected to NZBGet v${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const baseUrl = this.getBaseUrl();
      downloadersLogger.error({ error, url: baseUrl }, "NZBGet connection test failed");
      return {
        success: false,
        message: `Failed to connect to NZBGet at ${baseUrl}: ${errorMessage}`,
      };
    }
  }

  async logVersionInfo(): Promise<void> {
    const version = await this.makeXMLRPCRequest("version");
    downloadersLogger.info(
      {
        downloaderId: this.downloader.id,
        downloaderType: this.downloader.type,
        version,
      },
      "Downloader version probe completed"
    );
  }

  async addDownload(
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!(await isSafeUrl(request.url))) {
        return { success: false, message: `Unsafe URL blocked: ${request.url}` };
      }

      // Keep &file= intact — Prowlarr uses it for link validation.
      const nzbUrl = fixNzbUrlEncoding(request.url);
      const nzbResponse = await safeFetch(nzbUrl);
      if (!nzbResponse.ok) {
        return { success: false, message: `Failed to fetch NZB: ${nzbResponse.statusText}` };
      }

      const nzbContent = await nzbResponse.text();
      const base64Content = Buffer.from(nzbContent).toString("base64");

      const category = request.category || this.downloader.category || "";

      // Many usenet releases (e.g. G4U) ship as password-protected archives. NZBGet's
      // built-in Unpack post-processor reads a per-NZB override via the well-known
      // "*Unpack:Password" PPParameter — configured per-downloader since it's usually
      // a fixed indexer/group convention.
      const { password, error: passwordError } = resolveArchivePassword(
        request.password,
        this.downloader.settings,
        this.getBaseUrl(),
        "NZBGet",
        this.downloader.allowInsecureLan === true
      );
      if (passwordError) {
        return { success: false, message: passwordError };
      }

      const nzbId = (await this.makeXMLRPCRequest(
        "append",
        [
          request.title || "download.nzb",
          base64Content,
          category,
          request.priority || 0,
          false, // AddToTop
          false, // AddPaused
          "", // DupeKey
          0, // DupeScore
          "SCORE", // DupeMode
          password ? [{ Name: "*Unpack:Password", Value: password }] : [], // PPParameters
        ],
        !!password
      )) as number;

      if (nzbId > 0) {
        return {
          success: true,
          id: nzbId.toString(),
          message: "NZB added successfully",
        };
      }

      return { success: false, message: "Failed to add NZB (ID is 0 or negative)" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getDownloadStatus(
    id: string,
    options?: { throwOnError?: boolean }
  ): Promise<DownloadStatus | null> {
    try {
      const queue = (await this.makeXMLRPCRequest("listgroups")) as NZBGetListResult[];
      const item = queue.find((q) => q.NZBID.toString() === id);

      if (!item) {
        // Check history
        return await this.getFromHistory(id, options);
      }

      const progress =
        item.FileSizeMB > 0
          ? ((item.FileSizeMB - item.RemainingSizeMB) / item.FileSizeMB) * 100
          : 0;

      // Calculate ETA
      let eta: number | undefined;
      if (item.DownloadRate > 0 && item.RemainingSizeMB > 0) {
        eta = (item.RemainingSizeMB * 1024 * 1024) / item.DownloadRate;
      }

      // Map NZBGet status
      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      switch (item.Status) {
        case "DOWNLOADING":
        case "FETCHING":
          status = "downloading";
          break;
        case "PAUSED":
          status = "paused";
          break;
        case "POST_PROCESSING":
          if (item.PostInfoText.includes("Repairing")) {
            status = "repairing";
            repairStatus = "repairing";
          } else if (
            item.PostInfoText.includes("Unpacking") ||
            item.PostInfoText.includes("Extracting")
          ) {
            status = "unpacking";
            unpackStatus = "unpacking";
          } else {
            status = "downloading";
          }
          break;
        default:
          status = "downloading";
      }

      return {
        id: item.NZBID.toString(),
        name: item.NZBName,
        downloadType: "usenet",
        status,
        progress,
        downloadSpeed: item.DownloadRate,
        eta,
        size: item.FileSizeMB * 1024 * 1024,
        downloaded: item.DownloadedSizeMB * 1024 * 1024,
        category: item.Category,
        repairStatus,
        unpackStatus,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet status");
      if (options?.throwOnError) throw error;
      return null;
    }
  }

  private async getFromHistory(
    id: string,
    options?: { throwOnError?: boolean }
  ): Promise<DownloadStatus | null> {
    try {
      const history = (await this.makeXMLRPCRequest("history")) as NZBGetHistoryResult[];
      const item = history.find((h) => h.NZBID.toString() === id);

      if (!item) {
        return null;
      }

      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      // NZBGet's history Status field is "<overall>/<detail>", where the detail
      // suffix varies depending on which post-processing step it last reflects
      // (e.g. "SUCCESS/ALL", "SUCCESS/GOOD", "SUCCESS/UNPACK", "SUCCESS/HEALTH",
      // "SUCCESS/COPY", "SUCCESS/MARK"). Matching only "SUCCESS/ALL" caused
      // legitimately completed downloads to be reported as failed/aborted.
      if (item.Status.startsWith("SUCCESS/")) {
        status = "completed";
        repairStatus =
          item.ParStatus === "SUCCESS" || item.ParStatus === "NONE" ? "good" : "failed";
        // NONE means NZBGet did not unpack at all (unpacking disabled for the category), so
        // the job can still hold archives: report no unpack state rather than "completed".
        if (item.UnpackStatus === "SUCCESS") unpackStatus = "completed";
        else if (item.UnpackStatus !== "NONE") unpackStatus = "failed";
      } else {
        status = "error";
        repairStatus = item.ParStatus === "FAILURE" ? "failed" : "good";
        unpackStatus = item.UnpackStatus === "FAILURE" ? "failed" : "completed";
      }

      return {
        id: item.NZBID.toString(),
        name: item.Name,
        downloadType: "usenet",
        status,
        progress: status === "completed" ? 100 : 0,
        size: item.FileSizeMB * 1024 * 1024,
        downloaded: item.FileSizeMB * 1024 * 1024,
        category: item.Category,
        repairStatus,
        unpackStatus,
        error: status === "error" ? describeHistoryFailure(item) : undefined,
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet history");
      if (options?.throwOnError) throw error;
      return null;
    }
  }

  // `getDownloadStatus`/`getFromHistory` return a `DownloadStatus`, which has
  // no `downloadDir` field (only `DownloadDetails` does), so the history
  // item's `DestDir` never made it out of those methods even though NZBGet's
  // API provides it. Without it, ImportManager can never be handed a path to
  // import from, and every completed NZBGet download was stuck logging
  // "no remote path was available for import" and requiring manual review.
  private async getHistoryDestDir(id: string): Promise<string | undefined> {
    try {
      const history = (await this.makeXMLRPCRequest("history")) as NZBGetHistoryResult[];
      const item = history.find((h) => h.NZBID.toString() === id);
      return item?.DestDir || undefined;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet history destination directory");
      return undefined;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const status = await this.getDownloadStatus(id);
    if (!status) return null;

    const downloadDir =
      status.status === "completed" ? await this.getHistoryDestDir(id) : undefined;

    // NZBGet doesn't provide detailed file information easily
    return {
      ...status,
      downloadDir,
      files: [],
      filesSupport: "unsupported",
      filesSupportReason: "NZBGet API does not expose per-file details for grouped downloads.",
      trackers: [],
    };
  }

  async getAllDownloads(options?: { throwOnError?: boolean }): Promise<DownloadStatus[]> {
    try {
      const queue = (await this.makeXMLRPCRequest("listgroups")) as NZBGetListResult[];
      const results: DownloadStatus[] = [];

      for (const item of queue) {
        const status = await this.getDownloadStatus(item.NZBID.toString(), options);
        if (status) {
          results.push(status);
        }
      }

      return results;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet queue");
      if (options?.throwOnError) throw error;
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("editqueue", ["GroupPause", 0, "", [Number.parseInt(id)]]);
      return { success: true, message: "NZB paused" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("editqueue", ["GroupResume", 0, "", [Number.parseInt(id)]]);
      return { success: true, message: "NZB resumed" };
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
      await this.makeXMLRPCRequest("editqueue", ["GroupDelete", 0, "", [Number.parseInt(id)]]);
      return { success: true, message: "NZB removed" };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      const status = (await this.makeXMLRPCRequest("status")) as { FreeDiskSpaceMB: number };
      return status.FreeDiskSpaceMB * 1024 * 1024; // Convert MB to bytes
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet free space");
      return 0;
    }
  }

  async findTorrentByTag(tag: string): Promise<string | null> {
    return findTorrentByTagNull(tag);
  }
}
