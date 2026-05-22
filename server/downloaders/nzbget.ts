import type { Downloader, DownloadStatus, DownloadDetails } from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import { XMLParser } from "fast-xml-parser";
import { isSafeUrl, safeFetch } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient } from "./types.js";
import { fixNzbUrlEncoding } from "./utils.js";

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

export class NZBGetClient implements DownloaderClient {
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

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private buildXMLValue(param: unknown): string {
    if (typeof param === "boolean") {
      return `<boolean>${param ? 1 : 0}</boolean>`;
    } else if (typeof param === "number") {
      if (Number.isInteger(param)) {
        return `<int>${param}</int>`;
      }
      return `<double>${param}</double>`;
    } else if (typeof param === "string") {
      return `<string>${this.escapeXml(param)}</string>`;
    } else if (Array.isArray(param)) {
      const data = param.map((p) => `<value>${this.buildXMLValue(p)}</value>`).join("");
      return `<array><data>${data}</data></array>`;
    } else if (typeof param === "object" && param !== null) {
      const members = Object.entries(param)
        .map(
          ([k, v]) =>
            `<member><name>${this.escapeXml(k)}</name><value>${this.buildXMLValue(v)}</value></member>`
        )
        .join("");
      return `<struct>${members}</struct>`;
    }
    return "";
  }

  private parseValueObj(valueObj: unknown): unknown {
    if (typeof valueObj !== "object" || valueObj === null) {
      return valueObj;
    }

    // Unwrap array if it's a value array from fast-xml-parser (due to isArray config)
    let obj = valueObj;
    if (Array.isArray(obj)) {
      obj = obj[0];
      if (typeof obj !== "object" || obj === null) {
        return obj;
      }
    }

    const rec = obj as Record<string, unknown>;

    // With parseTagValue: false and textNodeName: "_text", values might be wrapped
    const getValue = (v: unknown) =>
      v && typeof v === "object" && "_text" in v ? (v as Record<string, unknown>)._text : v;

    if ("string" in rec) return getValue(rec.string);
    if ("int" in rec) return parseInt(getValue(rec.int) as string);
    if ("i4" in rec) return parseInt(getValue(rec.i4) as string);
    if ("boolean" in rec) {
      const boolVal = getValue(rec.boolean);
      return boolVal == 1 || boolVal === "1";
    }
    if ("double" in rec) return parseFloat(getValue(rec.double) as string);
    if ("base64" in rec) return getValue(rec.base64);

    if ("array" in rec) {
      const arrayObj = rec["array"] as Record<string, unknown>;
      const data = arrayObj["data"];
      if (!data) return [];

      const dataBlock = Array.isArray(data) ? data[0] : data;

      if (!dataBlock || typeof dataBlock !== "object" || !("value" in dataBlock)) return [];

      const values = Array.isArray((dataBlock as Record<string, unknown>).value)
        ? (dataBlock as Record<string, unknown>).value
        : [(dataBlock as Record<string, unknown>).value];
      return (values as unknown[]).map((v: unknown) => this.parseValueObj(v));
    }

    if ("struct" in rec) {
      const structObj = rec["struct"] as Record<string, unknown>;
      const members = structObj["member"] as Record<string, unknown>[];
      if (!members) return {};

      const result: Record<string, unknown> = {};
      for (const m of members) {
        if (m["name"] && m["value"]) {
          result[getValue(m["name"]) as string] = this.parseValueObj(m["value"]);
        }
      }
      return result;
    }

    // Handle direct value text if none of the above matched (e.g. <value>string</value> without <string> tag?)
    // XML-RPC spec says <value> without type is string.
    if ("_text" in rec) return rec._text;

    // Fallback
    return String(Object.values(rec)[0]);
  }

  private async makeXMLRPCRequest(method: string, params: unknown[] = []): Promise<unknown> {
    const baseUrl = this.getBaseUrl();
    const path = this.downloader.urlPath || "xmlrpc";
    const url = `${baseUrl}/${path.replace(/^\//, "")}`;

    const xmlParams = params
      .map((param) => `<param><value>${this.buildXMLValue(param)}</value></param>`)
      .join("");

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>${this.escapeXml(method)}</methodName>
  <params>
    ${xmlParams}
  </params>
</methodCall>`;

    const headers: Record<string, string> = {
      "Content-Type": "text/xml",
      "User-Agent": "Questarr/1.0",
    };

    if (this.downloader.username && this.downloader.password) {
      const auth = Buffer.from(
        `${this.downloader.username}:${this.downloader.password}`,
        "latin1"
      ).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }

    const logParams =
      method === "append" && params.length > 1
        ? [params[0], "<base64_content_truncated>", ...params.slice(2)]
        : params;

    downloadersLogger.debug({ url, method, params: logParams }, "Making NZBGet XML-RPC request");

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: xmlBody,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const responseText = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      textNodeName: "_text",
      isArray: (name) => {
        return ["member", "data", "value", "param"].includes(name);
      },
    });

    const parsed = parser.parse(responseText);

    if (parsed.methodResponse?.fault) {
      const fault = this.parseValueObj(parsed.methodResponse.fault.value) as Record<
        string,
        unknown
      >;
      throw new Error(
        `NZBGet Fault: ${fault["faultString"] as string} (${fault["faultCode"] as number})`
      );
    }

    if (parsed.methodResponse?.params?.param) {
      const params = parsed.methodResponse.params.param;
      const param = Array.isArray(params) ? params[0] : params;

      if (param && param.value) {
        return this.parseValueObj(param.value);
      }
    }

    return null;
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

      const nzbId = (await this.makeXMLRPCRequest("append", [
        request.title || "download.nzb",
        base64Content,
        request.category || "",
        request.priority || 0,
        false, // AddToTop
        false, // AddPaused
        "", // DupeKey
        0, // DupeScore
        "SCORE", // DupeMode
        [], // PPParameters
      ])) as number;

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

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const queue = (await this.makeXMLRPCRequest("listgroups")) as NZBGetListResult[];
      const item = queue.find((q) => q.NZBID.toString() === id);

      if (!item) {
        // Check history
        return await this.getFromHistory(id);
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
      return null;
    }
  }

  private async getFromHistory(id: string): Promise<DownloadStatus | null> {
    try {
      const history = (await this.makeXMLRPCRequest("history")) as NZBGetHistoryResult[];
      const item = history.find((h) => h.NZBID.toString() === id);

      if (!item) {
        return null;
      }

      let status: DownloadStatus["status"];
      let repairStatus: DownloadStatus["repairStatus"];
      let unpackStatus: DownloadStatus["unpackStatus"];

      if (item.Status === "SUCCESS/ALL") {
        status = "completed";
        repairStatus =
          item.ParStatus === "SUCCESS" || item.ParStatus === "NONE" ? "good" : "failed";
        unpackStatus =
          item.UnpackStatus === "SUCCESS" || item.UnpackStatus === "NONE" ? "completed" : "failed";
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
      };
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet history");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    const status = await this.getDownloadStatus(id);
    if (!status) return null;

    // NZBGet doesn't provide detailed file information easily
    return {
      ...status,
      files: [],
      trackers: [],
    };
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    try {
      const queue = (await this.makeXMLRPCRequest("listgroups")) as NZBGetListResult[];
      const results: DownloadStatus[] = [];

      for (const item of queue) {
        const status = await this.getDownloadStatus(item.NZBID.toString());
        if (status) {
          results.push(status);
        }
      }

      return results;
    } catch (error) {
      downloadersLogger.error({ error }, "Failed to get NZBGet queue");
      return [];
    }
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("editqueue", ["GroupPause", 0, "", [parseInt(id)]]);
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
      await this.makeXMLRPCRequest("editqueue", ["GroupResume", 0, "", [parseInt(id)]]);
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
      await this.makeXMLRPCRequest("editqueue", ["GroupDelete", 0, "", [parseInt(id)]]);
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
}
