import type {
  Downloader,
  DownloadStatus,
  DownloadFile,
  DownloadTracker,
  DownloadDetails,
} from "../../shared/schema.js";
import { downloadersLogger } from "../logger.js";
import parseTorrent from "parse-torrent";
import crypto from "crypto";
import { isSafeUrl } from "../ssrf.js";
import type { DownloadRequest, DownloaderClient, XMLValue } from "./types.js";
import { fetchWithMagnetDetection, extractHashFromUrl } from "./utils.js";
import { XMLParser } from "fast-xml-parser";

/**
 * rTorrent/ruTorrent client implementation using XML-RPC protocol.
 *
 * @remarks
 * - Communicates via XML-RPC to the /RPC2 endpoint
 * - Uses d.multicall2 for efficient batch operations
 * - Status mapping: state (0=stopped, 1=started) + complete (0/1)
 * - Supports Basic Authentication via username/password
 */
export class RTorrentClient implements DownloaderClient {
  private downloader: Downloader;
  private xmlParser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    textNodeName: "_text",
    isArray: (name) => ["member", "data", "value", "param"].includes(name),
  });

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test connection by getting rTorrent version
      const version = await this.makeXMLRPCRequest("system.client_version", []);
      downloadersLogger.info(
        {
          url: this.downloader.url,
          version,
        },
        "rTorrent connection test successful"
      );
      return { success: true, message: `Connected to rTorrent v${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error(
        {
          error: errorMessage,
          url: this.downloader.url,
          username: this.downloader.username,
          urlPath: this.downloader.urlPath || "RPC2",
        },
        "rTorrent connection test failed"
      );

      if (errorMessage.includes("Authentication failed")) {
        return { success: false, message: errorMessage };
      }
      return { success: false, message: `Failed to connect to rTorrent: ${errorMessage}` };
    }
  }

  async logVersionInfo(): Promise<void> {
    const version = await this.makeXMLRPCRequest("system.client_version", []);
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
      if (!request.url) {
        return { success: false, message: "Download URL is required" };
      }

      if (!(await isSafeUrl(request.url))) {
        return { success: false, message: `Unsafe URL blocked: ${request.url}` };
      }

      const isMagnet = request.url.startsWith("magnet:");
      const category = request.category || this.downloader.category;
      // rTorrent supports categories natively via d.custom1.set, so the download path
      // must not have the category appended — that would cause double-nesting like /path/cat/cat.
      const downloadPath = request.downloadPath || this.downloader.downloadPath;

      // Add a magnet link directly via load.start / load.normal
      const addMagnetLink = async (
        magnetUri: string
      ): Promise<{ success: boolean; id?: string; message: string }> => {
        const infoHash = extractHashFromUrl(magnetUri) ?? "unknown";
        const addMethod = this.downloader.addStopped ? "load.normal" : "load.start";
        downloadersLogger.debug(
          { method: addMethod, hash: infoHash },
          "Adding magnet link to rTorrent"
        );
        // Pass directory and category as inline commands so they are applied atomically
        const commands: string[] = [];
        if (category) commands.push(`d.custom1.set=${category}`);
        if (downloadPath) commands.push(`d.directory.set=${downloadPath}`);
        const result = await this.makeXMLRPCRequest(addMethod, ["", magnetUri, ...commands]);
        if (result === 0) {
          return {
            success: true,
            id: infoHash,
            message: `Download added successfully${this.downloader.addStopped ? " (stopped)" : ""}`,
          };
        }
        return {
          success: false,
          message: `Failed to add download (rTorrent returned code: ${result})`,
        };
      };

      if (isMagnet) {
        return await addMagnetLink(request.url);
      }

      // Non-magnet: fetch the torrent file with redirect-to-magnet detection
      downloadersLogger.debug({ url: request.url }, "Downloading file locally for rTorrent");

      let fetchResult = await fetchWithMagnetDetection(request.url);

      // Some indexers reject the request when a &file= param is present — retry without it
      if (!fetchResult.magnetLink && !fetchResult.response?.ok && request.url.includes("&file=")) {
        const urlNoFile = request.url.split("&file=")[0];
        downloadersLogger.warn(
          { original: request.url, fixed: urlNoFile },
          "Retrying download without &file= parameter"
        );
        fetchResult = await fetchWithMagnetDetection(urlNoFile);
      }

      if (fetchResult.magnetLink) {
        downloadersLogger.info(
          { magnetLink: fetchResult.magnetLink },
          "Detected magnet redirect, adding to rTorrent"
        );
        return await addMagnetLink(fetchResult.magnetLink);
      }

      if (!fetchResult.response?.ok) {
        const status = fetchResult.response?.status ?? "unknown";
        const statusText = fetchResult.response?.statusText ?? "No response";
        downloadersLogger.error(
          { status, url: request.url },
          "Failed to download file from indexer"
        );
        return { success: false, message: `Failed to download file from indexer: ${statusText}` };
      }

      const arrayBuffer = await fetchResult.response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Parse the torrent to extract the info hash for subsequent property-setting calls
      let infoHash = "unknown";
      try {
        const parsed = await parseTorrent(buffer);
        if (parsed && parsed.infoHash) {
          infoHash = parsed.infoHash.toLowerCase();
        }
      } catch (_e) {
        downloadersLogger.warn({ error: _e }, "Failed to parse file for hash");
      }

      const addMethod = this.downloader.addStopped ? "load.raw" : "load.raw_start";
      downloadersLogger.debug(
        { method: addMethod, size: buffer.length, hash: infoHash },
        "Uploading raw file to rTorrent"
      );

      // Pass directory and category as inline commands so they are applied atomically
      const rawCommands: string[] = [];
      if (category) rawCommands.push(`d.custom1.set=${category}`);
      if (downloadPath) rawCommands.push(`d.directory.set=${downloadPath}`);
      const result = await this.makeXMLRPCRequest(addMethod, ["", buffer, ...rawCommands]);

      if (result === 0) {
        return {
          success: true,
          id: infoHash,
          message: `Download added successfully${this.downloader.addStopped ? " (stopped)" : ""}`,
        };
      }

      return {
        success: false,
        message: `Failed to add download (rTorrent returned code: ${result})`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      downloadersLogger.error({ error, url: request.url }, "Failed to add download");
      return { success: false, message: `Failed to add download: ${errorMessage}` };
    }
  }

  async getDownloadStatus(id: string): Promise<DownloadStatus | null> {
    try {
      // Get detailed information about a specific download using multicall
      const result = await this.makeXMLRPCRequest("d.multicall2", [
        "",
        "main", // Added view parameter which is required for d.multicall2
        "d.hash=",
        "d.name=",
        "d.state=",
        "d.complete=",
        "d.size_bytes=",
        "d.completed_bytes=",
        "d.down.rate=",
        "d.up.rate=",
        "d.ratio=",
        "d.peers_connected=",
        "d.peers_complete=",
        "d.message=",
        "d.custom1=",
      ]);

      // Filter for the specific ID since d.multicall2 returns all downloads in the view
      if (result && result.length > 0) {
        const download = result.find(
          (t: unknown[]) => (t as string[])[0].toLowerCase() === id.toLowerCase()
        );
        if (download) {
          return this.mapRTorrentStatus(download);
        }
      }

      return null;
    } catch (error) {
      downloadersLogger.error({ error }, "error getting download status (rtorrent)");
      return null;
    }
  }

  async getDownloadDetails(id: string): Promise<DownloadDetails | null> {
    try {
      // Get basic download info
      const basicInfo = await Promise.all([
        this.makeXMLRPCRequest("d.hash", [id]),
        this.makeXMLRPCRequest("d.name", [id]),
        this.makeXMLRPCRequest("d.state", [id]),
        this.makeXMLRPCRequest("d.complete", [id]),
        this.makeXMLRPCRequest("d.size_bytes", [id]),
        this.makeXMLRPCRequest("d.completed_bytes", [id]),
        this.makeXMLRPCRequest("d.down.rate", [id]),
        this.makeXMLRPCRequest("d.up.rate", [id]),
        this.makeXMLRPCRequest("d.ratio", [id]),
        this.makeXMLRPCRequest("d.peers_connected", [id]),
        this.makeXMLRPCRequest("d.peers_complete", [id]),
        this.makeXMLRPCRequest("d.message", [id]),
        this.makeXMLRPCRequest("d.directory", [id]),
        this.makeXMLRPCRequest("d.creation_date", [id]),
      ]);

      const [
        hash,
        name,
        state,
        complete,
        sizeBytes,
        completedBytes,
        downRate,
        upRate,
        ratio,
        peersConnected,
        peersComplete,
        message,
        directory,
        creationDate,
      ] = basicInfo;

      // Get files using f.multicall
      const filesResult = await this.makeXMLRPCRequest("f.multicall", [
        id,
        "",
        "f.path=",
        "f.size_bytes=",
        "f.completed_chunks=",
        "f.size_chunks=",
        "f.priority=",
      ]);

      // Get trackers using t.multicall
      const trackersResult = await this.makeXMLRPCRequest("t.multicall", [
        id,
        "",
        "t.url=",
        "t.group=",
        "t.is_enabled=",
        "t.scrape_complete=",
        "t.scrape_incomplete=",
      ]);

      // Map status
      let status: DownloadStatus["status"];
      if (state === 1) {
        status = complete === 1 ? "seeding" : "downloading";
      } else {
        status = complete === 1 ? "completed" : "paused";
      }
      if (message && message.length > 0) {
        status = "error";
      }

      const progress = sizeBytes > 0 ? Math.round((completedBytes / sizeBytes) * 100) : 0;

      // Map files
      // rTorrent priority: 0 = don't download (off), 1 = normal, 2 = high
      const files: DownloadFile[] = (filesResult || []).map((file: unknown[]) => {
        const [path, size, completedChunks, totalChunks, priority] = file;
        const fileProgress =
          (totalChunks as number) > 0
            ? Math.round(((completedChunks as number) / (totalChunks as number)) * 100)
            : 0;
        let filePriority: DownloadFile["priority"] = "normal";
        if ((priority as number) === 0) filePriority = "off";
        else if ((priority as number) === 1) filePriority = "normal";
        else if ((priority as number) === 2) filePriority = "high";

        return {
          name: path as string,
          size: size as number,
          progress: fileProgress,
          priority: filePriority,
          wanted: (priority as number) !== 0,
        };
      });

      // Map trackers
      const trackers: DownloadTracker[] = (trackersResult || []).map((tracker: unknown[]) => {
        // rTorrent tracker tuple: [url, group, isEnabled, seeders, leechers, ...optional fields]
        const [url, group, isEnabled, seeders, leechers, lastScrape, lastAnnounce, lastError] =
          tracker;
        let trackerStatus: DownloadTracker["status"] = "inactive";
        if (isEnabled) {
          if (lastError && typeof lastError === "string" && lastError.length > 0) {
            trackerStatus = "error";
          } else if (lastScrape === 0 || lastAnnounce === 0) {
            trackerStatus = "updating";
          } else {
            trackerStatus = "working";
          }
        }
        return {
          url: url as string,
          tier: group as number,
          status: trackerStatus,
          seeders: (seeders as number) >= 0 ? (seeders as number) : undefined,
          leechers: (leechers as number) >= 0 ? (leechers as number) : undefined,
          error:
            lastError && typeof lastError === "string" && lastError.length > 0
              ? lastError
              : undefined,
        };
      });

      return {
        id: hash,
        name,
        status,
        progress,
        downloadSpeed: downRate,
        uploadSpeed: upRate,
        size: sizeBytes,
        downloaded: completedBytes,
        seeders: peersComplete,
        leechers: Math.max(0, peersConnected - peersComplete),
        ratio: ratio / 1000,
        error: message || undefined,
        hash,
        downloadDir: directory,
        addedDate: creationDate > 0 ? new Date(creationDate * 1000).toISOString() : undefined,
        files,
        filesSupport: "supported",
        trackers,
        totalPeers: peersConnected,
        connectedPeers: peersConnected,
      };
    } catch (error) {
      downloadersLogger.error({ error, id }, "Error getting download details");
      return null;
    }
  }

  async getAllDownloads(): Promise<DownloadStatus[]> {
    // Get all downloads using multicall
    // Note: d.multicall2 requires a view (usually "main" or "default") as the second argument
    const result = await this.makeXMLRPCRequest("d.multicall2", [
      "",
      "main",
      "d.hash=",
      "d.name=",
      "d.state=",
      "d.complete=",
      "d.size_bytes=",
      "d.completed_bytes=",
      "d.down.rate=",
      "d.up.rate=",
      "d.ratio=",
      "d.peers_connected=",
      "d.peers_complete=",
      "d.message=",
      "d.custom1=",
    ]);

    if (result) {
      return result.map((torrent: unknown[]) => this.mapRTorrentStatus(torrent));
    }

    return [];
  }

  async pauseDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("d.stop", [id]);
      return { success: true, message: "Download paused successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to pause download: ${errorMessage}` };
    }
  }

  async resumeDownload(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest("d.start", [id]);
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
      if (deleteFiles) {
        // Stop download, delete data, and remove from client
        await this.makeXMLRPCRequest("d.stop", [id]);
        await this.makeXMLRPCRequest("d.delete_tied", [id]); // Delete files
        await this.makeXMLRPCRequest("d.erase", [id]);
      } else {
        // Just remove from client without deleting files
        await this.makeXMLRPCRequest("d.erase", [id]);
      }
      return { success: true, message: "Download removed successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to remove download: ${errorMessage}` };
    }
  }

  async getFreeSpace(): Promise<number> {
    try {
      // In rTorrent, get the free disk space for the default download directory
      // Use directory.default to get the default download directory
      const directory = await this.makeXMLRPCRequest("directory.default", []);
      downloadersLogger.debug({ directory }, "Got default directory from rTorrent");

      // Use df with --output=avail to get just the available space
      // This is more portable and explicit than parsing columns
      // Pass directory as a positional argument to avoid shell injection.
      const dfOutput = await this.makeXMLRPCRequest("execute.capture", [
        "",
        "sh",
        "-c",
        'df --output=avail -B1 "$1" | tail -1',
        "sh",
        directory,
      ]);
      downloadersLogger.debug({ dfOutput }, "Got df output from rTorrent");

      // The output should be just the available bytes
      const availableBytes = parseInt(dfOutput.toString().trim(), 10);
      if (!isNaN(availableBytes) && availableBytes > 0) {
        return availableBytes;
      }

      downloadersLogger.warn({ dfOutput, availableBytes }, "Failed to parse df output");
      return 0;
    } catch (error) {
      downloadersLogger.error({ error }, "Error getting free space from rTorrent");
      return 0;
    }
  }

  private mapRTorrentStatus(torrent: unknown[]): DownloadStatus {
    // download is an array: [hash, name, state, complete, size, completed, down_rate, up_rate, ratio, peers_connected, peers_complete, message, custom1]
    const [
      hash,
      name,
      state,
      complete,
      sizeBytes,
      completedBytes,
      downRate,
      upRate,
      ratio,
      peersConnected,
      peersComplete,
      message,
      custom1,
    ] = torrent;

    // rTorrent state: 0=stopped, 1=started
    // complete: 0=incomplete, 1=complete
    let status: DownloadStatus["status"];

    // Check for error message first
    if (message && (message as string).length > 0) {
      status = "error";
    } else if ((state as number) === 1) {
      // Started
      if ((complete as number) === 1) {
        status = "seeding";
      } else {
        status = "downloading";
      }
    } else {
      // Stopped/Paused
      if ((complete as number) === 1) {
        status = "completed";
      } else {
        status = "paused";
      }
    }

    const progress =
      (sizeBytes as number) > 0
        ? Math.round(((completedBytes as number) / (sizeBytes as number)) * 100)
        : 0;

    // Force completed status if progress is 100% even if rTorrent says otherwise
    // This handles cases where rTorrent might be in a weird state or checking
    if (progress >= 100 && status !== "seeding" && status !== "completed") {
      // If it's stopped and 100%, it's completed.
      // If it's started and 100%, it's seeding (or should be).
      status = (state as number) === 1 ? "seeding" : "completed";
    }

    // Fix for 0% progress and 0 ratio when data is missing or not yet loaded
    // If size is 0, it might be a magnet link resolving metadata
    if ((sizeBytes as number) === 0) {
      // Keep existing status but ensure we don't divide by zero
    }

    return {
      id: hash as string,
      name: name as string,
      status,
      progress,
      downloadSpeed: downRate as number,
      uploadSpeed: upRate as number,
      size: sizeBytes as number,
      downloaded: completedBytes as number,
      seeders: peersComplete as number,
      leechers: Math.max(0, (peersConnected as number) - (peersComplete as number)),
      ratio: (ratio as number) / 1000, // rTorrent returns ratio * 1000
      error: (message as string) || undefined,
      category: (custom1 as string) || undefined,
    };
  }

  private computeDigestHeader(
    method: string,
    uri: string,
    authHeader: string,
    username: string,
    password: string
  ): string {
    // Parse challenge
    const challenge: Record<string, string> = {};
    const regex = /([a-z0-9_-]+)=(?:"([^"]+)"|([a-z0-9_-]+))/gi;
    let match;
    while ((match = regex.exec(authHeader)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2] || match[3]; // Group 2 is quoted, Group 3 is unquoted
      challenge[key] = value;
    }

    const realm = challenge.realm;
    const nonce = challenge.nonce;
    const algorithm = challenge.algorithm || "MD5";
    const qop = challenge.qop;
    const opaque = challenge.opaque;
    const hashAlgo = algorithm.toUpperCase().startsWith("SHA-256") ? "sha256" : "md5";

    // A1 = username:realm:password
    const ha1 = crypto
      .createHash(hashAlgo)
      .update(`${username}:${realm}:${password}`)
      .digest("hex");

    // A2 = method:uri
    const ha2 = crypto.createHash(hashAlgo).update(`${method}:${uri}`).digest("hex");

    // Response
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");

    let response: string;
    if (qop === "auth" || qop === "auth-int") {
      response = crypto
        .createHash(hashAlgo)
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest("hex");
    } else {
      response = crypto.createHash(hashAlgo).update(`${ha1}:${nonce}:${ha2}`).digest("hex");
    }

    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm="${algorithm}", response="${response}"`;

    if (opaque) {
      auth += `, opaque="${opaque}"`;
    }
    if (qop) {
      auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    }

    return auth;
  }

  private async makeXMLRPCRequest(method: string, params: unknown[]): Promise<XMLValue> {
    // Build the complete URL with protocol, host, port, and path
    let baseUrl = this.downloader.url;

    // Add protocol if not present
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const protocol = this.downloader.useSsl ? "https://" : "http://";
      baseUrl = protocol + baseUrl;
    }

    // Parse URL to handle port and path correctly
    let urlObj: URL;
    try {
      urlObj = new URL(baseUrl);
    } catch {
      // Fallback for invalid URLs, though they should be validated before
      urlObj = new URL(`http://${baseUrl}`);
    }

    // Add/Update port if specified
    if (this.downloader.port) {
      urlObj.port = this.downloader.port.toString();
    }

    // Get the base path from the URL (e.g., /rutorrent from https://host/rutorrent)
    // Remove trailing slash if present
    let basePath = urlObj.pathname;
    if (basePath.endsWith("/")) {
      basePath = basePath.slice(0, -1);
    }

    // Add URL path (defaults to RPC2 if not specified)
    // Ensure urlPath doesn't start with / to avoid double slashes when joining
    let urlPath = this.downloader.urlPath || "RPC2";
    if (urlPath.startsWith("/")) {
      urlPath = urlPath.substring(1);
    }

    // Construct final URL
    // Format: protocol://host:port/basePath/urlPath
    urlObj.pathname = `${basePath}/${urlPath}`;
    const url = urlObj.toString();

    // Build XML-RPC request
    const xmlParams = params
      .map((param) => {
        if (Buffer.isBuffer(param)) {
          return `<param><value><base64>${param.toString("base64")}</base64></value></param>`;
        } else if (typeof param === "string") {
          return `<param><value><string>${this.escapeXml(param)}</string></value></param>`;
        } else if (typeof param === "number") {
          return `<param><value><int>${param}</int></value></param>`;
        }
        return `<param><value><string>${this.escapeXml(String(param))}</string></value></param>`;
      })
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
        "utf-8"
      ).toString("base64");
      headers["Authorization"] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: xmlBody,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error details available");
      if (response.status === 401) {
        const authHeader = response.headers.get("www-authenticate");

        // Handle Digest Authentication
        if (
          authHeader &&
          authHeader.toLowerCase().startsWith("digest") &&
          this.downloader.username &&
          this.downloader.password
        ) {
          try {
            const uri = urlObj.pathname + urlObj.search;
            const digestAuth = this.computeDigestHeader(
              "POST",
              uri,
              authHeader,
              this.downloader.username,
              this.downloader.password
            );

            headers["Authorization"] = digestAuth;

            downloadersLogger.debug({ url }, "Retrying rTorrent request with Digest Auth");

            const retryResponse = await fetch(url, {
              method: "POST",
              headers,
              body: xmlBody,
              signal: AbortSignal.timeout(30000),
            });

            if (retryResponse.ok) {
              const retryResponseText = await retryResponse.text();
              return this.parseXMLRPCResponse(retryResponseText);
            } else {
              const retryErrorText = await retryResponse.text().catch(() => "No error details");
              downloadersLogger.error(
                {
                  status: retryResponse.status,
                  url,
                  username: this.downloader.username,
                  method,
                  authHeader,
                  errorText: retryErrorText,
                },
                "rTorrent Digest Authentication failed"
              );
              const isHttp = url.startsWith("http://");
              throw new Error(
                `Digest Authentication failed (wrong credentials${isHttp ? ", or server may have switched to HTTPS" : ""})`
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            downloadersLogger.error({ error: errorMessage }, "Error processing Digest Auth");
            throw new Error(`Digest Auth Error: ${errorMessage}`);
          }
        }

        downloadersLogger.error(
          {
            status: response.status,
            url,
            username: this.downloader.username,
            method,
            errorText,
            authHeader,
          },
          "rTorrent authentication failed - verify username, password, and web server authentication configuration"
        );
        throw new Error(
          `Authentication failed: Invalid credentials or web server authentication not configured for rTorrent - ${errorText}`
        );
      }
      downloadersLogger.error(
        {
          status: response.status,
          statusText: response.statusText,
          url,
          method,
          errorText,
        },
        "rTorrent XML-RPC request failed"
      );
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const responseText = await response.text();
    return this.parseXMLRPCResponse(responseText);
  }

  private parseXMLRPCResponse(xml: string): XMLValue {
    const parsed = this.xmlParser.parse(xml);

    if (parsed.methodResponse?.fault) {
      const fault = this.parseXMLValueObj(parsed.methodResponse.fault.value) as Record<
        string,
        unknown
      >;
      const faultString = fault["faultString"] as string;
      throw new Error(faultString ? `XML-RPC Fault: ${faultString}` : "XML-RPC Fault occurred");
    }

    if (parsed.methodResponse?.params?.param) {
      const params = parsed.methodResponse.params.param;
      const param = Array.isArray(params) ? params[0] : params;
      if (param?.value) {
        return this.parseXMLValueObj(param.value);
      }
    }

    return null;
  }

  private parseXMLValueObj(valueObj: unknown): XMLValue {
    if (typeof valueObj !== "object" || valueObj === null) {
      return valueObj;
    }

    let obj = valueObj;
    if (Array.isArray(obj)) {
      obj = obj[0];
      if (typeof obj !== "object" || obj === null) {
        return obj;
      }
    }

    const rec = obj as Record<string, unknown>;
    const getText = (v: unknown) =>
      v && typeof v === "object" && "_text" in v ? (v as Record<string, unknown>)._text : v;

    if ("string" in rec) return getText(rec.string);
    if ("int" in rec) return parseInt(getText(rec.int) as string);
    if ("i4" in rec) return parseInt(getText(rec.i4) as string);
    if ("i8" in rec) return parseInt(getText(rec.i8) as string);
    if ("double" in rec) return parseFloat(getText(rec.double) as string);
    if ("boolean" in rec) {
      const boolVal = getText(rec.boolean);
      return boolVal == 1 || boolVal === "1";
    }
    if ("base64" in rec) return getText(rec.base64);

    if ("array" in rec) {
      const arrayObj = rec["array"] as Record<string, unknown>;
      const data = arrayObj["data"];
      if (!data) return [];

      const dataBlock = Array.isArray(data) ? data[0] : data;
      if (!dataBlock || typeof dataBlock !== "object" || !("value" in dataBlock)) return [];

      const values = Array.isArray((dataBlock as Record<string, unknown>).value)
        ? (dataBlock as Record<string, unknown>).value
        : [(dataBlock as Record<string, unknown>).value];
      return (values as unknown[]).map((v: unknown) => this.parseXMLValueObj(v));
    }

    if ("struct" in rec) {
      const structObj = rec["struct"] as Record<string, unknown>;
      const members = structObj["member"] as Record<string, unknown>[];
      if (!members) return {};

      const result: Record<string, unknown> = {};
      for (const m of members) {
        if (m["name"] && m["value"]) {
          result[getText(m["name"]) as string] = this.parseXMLValueObj(m["value"]);
        }
      }
      return result;
    }

    return null;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
