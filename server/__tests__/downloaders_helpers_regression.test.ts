import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader } from "../../shared/schema.js";
import * as rootDownloaderExports from "../downloaders.js";
import * as downloaderExports from "../downloaders/index.js";
import { downloadersLogger } from "../logger.js";
import { NZBGetClient } from "../downloaders/nzbget.js";
import { QBittorrentClient } from "../downloaders/qbittorrent.js";
import { RTorrentClient } from "../downloaders/rtorrent.js";
import { SABnzbdClient } from "../downloaders/sabnzbd.js";
import { SynologyDownloadStationClient } from "../downloaders/synology.js";
import { TransmissionClient } from "../downloaders/transmission.js";

vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]),
  },
}));

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "dl-1",
    name: "Downloader",
    type: "transmission",
    url: "http://localhost:8080",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "user",
    password: "password",
    downloadPath: null,
    category: null,
    label: null,
    addStopped: false,
    removeCompleted: false,
    postImportCategory: null,
    settings: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

describe("downloaders helper regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("exports the modular downloader entrypoints", () => {
    expect(rootDownloaderExports.DownloaderManager).toBe(downloaderExports.DownloaderManager);
    expect(downloaderExports.DownloaderManager).toBeDefined();
    expect(downloaderExports.TransmissionClient).toBe(TransmissionClient);
    expect(downloaderExports.RTorrentClient).toBe(RTorrentClient);
    expect(downloaderExports.QBittorrentClient).toBe(QBittorrentClient);
    expect(downloaderExports.SABnzbdClient).toBe(SABnzbdClient);
    expect(downloaderExports.NZBGetClient).toBe(NZBGetClient);
    expect(downloaderExports.SynologyDownloadStationClient).toBe(SynologyDownloadStationClient);
  });

  it("covers NZBGet XML serialization and parsing helpers", () => {
    const client = new NZBGetClient(
      createDownloader({ type: "nzbget", url: "nzb.local", port: 6789 })
    ) as unknown as {
      getBaseUrl(): string;
      escapeXml(value: string): string;
      buildXMLValue(value: unknown): string;
      parseValueObj(value: unknown): unknown;
    };

    expect(client.getBaseUrl()).toBe("http://nzb.local:6789");
    expect(client.escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
    expect(client.buildXMLValue({ enabled: true, ratio: 1.5, items: ["a", 2] })).toContain(
      "<struct>"
    );
    expect(client.parseValueObj({ string: { _text: "value" } })).toBe("value");
    expect(client.parseValueObj({ int: { _text: "4" } })).toBe(4);
    expect(client.parseValueObj({ i4: { _text: "5" } })).toBe(5);
    expect(client.parseValueObj({ boolean: { _text: "1" } })).toBe(true);
    expect(client.parseValueObj({ double: { _text: "1.25" } })).toBe(1.25);
    expect(client.parseValueObj({ base64: { _text: "YWJj" } })).toBe("YWJj");
    expect(
      client.parseValueObj({
        array: {
          data: [
            {
              value: [{ string: { _text: "one" } }, { int: { _text: "2" } }],
            },
          ],
        },
      })
    ).toEqual(["one", 2]);
    expect(
      client.parseValueObj({
        struct: {
          member: [
            {
              name: { _text: "name" },
              value: { string: { _text: "Questarr" } },
            },
          ],
        },
      })
    ).toEqual({ name: "Questarr" });
    expect(client.parseValueObj({ _text: "fallback" })).toBe("fallback");
  });

  it("covers SABnzbd URL building and SSL fallback retry", async () => {
    const client = new SABnzbdClient(
      createDownloader({
        type: "sabnzbd",
        url: "http://sab.local/root/",
        port: 8085,
        urlPath: "sab",
        username: "api-key",
      })
    ) as unknown as {
      getBaseUrl(): string;
      getApiUrl(mode: string, params?: Record<string, string>): string;
      fetchWithFallback(url: string, options?: RequestInit): Promise<Response>;
      fetchInsecure(url: string, options: RequestInit): Promise<Response>;
    };

    expect(client.getBaseUrl()).toBe("http://sab.local:8085/root");

    const apiUrl = new URL(client.getApiUrl("queue", { start: "0" }));
    expect(apiUrl.pathname).toBe("/root/sab/api");
    expect(apiUrl.searchParams.get("apikey")).toBe("api-key");
    expect(apiUrl.searchParams.get("mode")).toBe("queue");
    expect(apiUrl.searchParams.get("start")).toBe("0");

    const insecureResponse = { ok: true } as Response;
    const insecureSpy = vi.spyOn(client, "fetchInsecure").mockResolvedValue(insecureResponse);
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("self-signed certificate"), {
        cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      })
    );

    await expect(client.fetchWithFallback("https://sab.local", {})).resolves.toBe(insecureResponse);
    expect(insecureSpy).toHaveBeenCalled();

    fetchMock.mockRejectedValueOnce(new Error("network boom"));
    await expect(client.fetchWithFallback("https://sab.local", {})).rejects.toThrow("network boom");
  });

  it("covers Transmission helper mapping branches", () => {
    const client = new TransmissionClient(
      createDownloader({
        type: "transmission",
        url: "transmission.local/root",
        port: 9091,
        urlPath: "custom",
      })
    ) as unknown as {
      getBaseUrl(): string;
      mapTransmissionStatus(torrent: Record<string, unknown>): Record<string, unknown>;
      mapTransmissionDetails(torrent: Record<string, unknown>): Record<string, unknown>;
    };

    expect(client.getBaseUrl()).toBe("http://transmission.local:9091/root/custom");

    expect(
      client.mapTransmissionStatus({
        id: 1,
        hashString: "hash-1",
        name: "Queued Game",
        status: 3,
        percentDone: 1,
        rateDownload: 0,
        rateUpload: 0,
        eta: -1,
        totalSize: 100,
        downloadedEver: 100,
        peersSendingToUs: 0,
        peersGettingFromUs: 0,
        uploadRatio: 1,
        errorString: "",
        labels: ["games"],
      }).status
    ).toBe("seeding");

    expect(
      client.mapTransmissionStatus({
        id: 2,
        name: "Broken Game",
        status: 4,
        percentDone: 0.5,
        rateDownload: 10,
        rateUpload: 1,
        eta: 60,
        totalSize: 200,
        downloadedEver: 100,
        peersSendingToUs: 2,
        peersGettingFromUs: 1,
        uploadRatio: 0.2,
        errorString: "disk full",
      }).status
    ).toBe("error");

    const details = client.mapTransmissionDetails({
      id: 3,
      hashString: "hash-3",
      name: "Detailed Game",
      status: 6,
      percentDone: 1,
      rateDownload: 0,
      rateUpload: 20,
      eta: 0,
      totalSize: 100,
      downloadedEver: 100,
      peersSendingToUs: 5,
      peersGettingFromUs: 1,
      uploadRatio: 2.5,
      errorString: "",
      addedDate: 1710000000,
      doneDate: 1710000600,
      downloadDir: "/downloads",
      comment: "Ready",
      creator: "Questarr",
      peersConnected: 6,
      files: [
        { name: "skip.bin", length: 10, bytesCompleted: 0 },
        { name: "play.bin", length: 10, bytesCompleted: 10 },
      ],
      fileStats: [
        { bytesCompleted: 0, wanted: false, priority: 0 },
        { bytesCompleted: 10, wanted: true, priority: 1 },
      ],
      trackerStats: [
        {
          announce: "https://wait.tracker",
          tier: 0,
          lastAnnounceSucceeded: false,
          isBackup: false,
          lastAnnounceResult: "",
          announceState: 2,
          seederCount: -1,
          leecherCount: -1,
          lastAnnounceTime: 0,
          nextAnnounceTime: 1710001200,
        },
      ],
    });

    expect(details.files).toEqual([
      expect.objectContaining({ priority: "off", wanted: false }),
      expect.objectContaining({ priority: "high", wanted: true }),
    ]);
    expect(details.trackers).toEqual([
      expect.objectContaining({ status: "updating", nextAnnounce: expect.any(String) }),
    ]);
  });

  it("covers qBittorrent helper mapping and filename sanitization", () => {
    const client = new QBittorrentClient(
      createDownloader({
        type: "qbittorrent",
        url: "qb.local/root",
        port: 8080,
        urlPath: "qbt/",
      })
    ) as unknown as {
      getBaseUrl(): string;
      sanitizeMultipartFilename(value: string): string;
      mapQBittorrentStatus(torrent: Record<string, unknown>): Record<string, unknown>;
    };

    expect(client.getBaseUrl()).toBe("http://qb.local:8080/root/qbt");
    expect(client.sanitizeMultipartFilename('Questarr\r\n"Game"\\build\u0001')).toBe(
      "Questarr  _Game__build"
    );
    expect(client.sanitizeMultipartFilename("\r\n\u0001")).toBe("torrent.torrent");

    expect(
      client.mapQBittorrentStatus({
        hash: "hash-1",
        name: "Paused Complete",
        state: "pausedDL",
        progress: 1,
        dlspeed: 0,
        upspeed: 0,
        eta: 8640001,
        size: 100,
        downloaded: 100,
        ratio: 1,
        num_seeds: 1,
        num_leechs: 0,
        category: "games",
      }).status
    ).toBe("completed");

    expect(
      client.mapQBittorrentStatus({
        hash: "hash-2",
        name: "Unknown State",
        state: "mystery",
        progress: 0.2,
        dlspeed: 10,
        upspeed: 0,
        eta: 30,
        size: 100,
        downloaded: 20,
        ratio: 0,
        num_seeds: 1,
        num_leechs: 2,
      }).status
    ).toBe("paused");
    expect(downloadersLogger.warn).toHaveBeenCalled();
  });

  it("covers qBittorrent request retry and failure branches", async () => {
    const client = new QBittorrentClient(
      createDownloader({
        type: "qbittorrent",
        url: "http://qb.local:8080",
        username: "admin",
        password: "password",
      })
    ) as unknown as {
      cookie: string | null;
      makeRequest(
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ): Promise<Response>;
      authenticate(force?: boolean): Promise<void>;
    };

    client.cookie = "SID=old";
    const authenticateSpy = vi.spyOn(client, "authenticate").mockImplementation(async () => {
      client.cookie = "SID=new";
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "expired",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

    await expect(
      client.makeRequest("POST", "/api/v2/test", Buffer.from("torrent"), {
        "Content-Type": "application/octet-stream",
      })
    ).resolves.toMatchObject({ ok: true });

    const retriedCall = fetchMock.mock.calls[1][1] as RequestInit;
    expect((retriedCall.headers as Record<string, string>).Cookie).toBe("SID=new");
    expect(retriedCall.body).toBeInstanceOf(Uint8Array);

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "expired again",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Offline",
        text: async () => "still bad",
      } as Response);

    await expect(client.makeRequest("GET", "/api/v2/auth-fail")).rejects.toThrow(
      "HTTP 503: Offline - still bad"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "boom",
    } as Response);

    await expect(client.makeRequest("GET", "/api/v2/direct-fail")).rejects.toThrow(
      "HTTP 500: Server Error - boom"
    );

    authenticateSpy.mockRestore();
  });

  it("covers rTorrent helpers and XML-RPC parsing", () => {
    const client = new RTorrentClient(
      createDownloader({ type: "rtorrent", url: "rt.local/base", urlPath: "RPC2" })
    ) as unknown as {
      mapRTorrentStatus(torrent: unknown[]): Record<string, unknown>;
      computeDigestHeader(
        method: string,
        uri: string,
        authHeader: string,
        username: string,
        password: string
      ): string;
      parseXMLRPCResponse(xml: string): unknown;
      escapeXml(value: string): string;
    };

    const randomBytesSpy = vi
      .spyOn(crypto, "randomBytes")
      .mockReturnValue(Buffer.from("1234567890abcdef", "hex"));

    const digest = client.computeDigestHeader(
      "POST",
      "/RPC2",
      'Digest realm="rtorrent", nonce="abc", qop="auth", opaque="xyz"',
      "user",
      "pass"
    );
    expect(digest).toContain('Digest username="user"');
    expect(digest).toContain("qop=auth");
    expect(digest).toContain('opaque="xyz"');

    expect(
      client.mapRTorrentStatus(["hash-1", "Done", 0, 1, 100, 100, 0, 0, 1000, 4, 2, "", "games"])
    ).toEqual(
      expect.objectContaining({
        status: "completed",
        leechers: 2,
        ratio: 1,
        category: "games",
      })
    );
    expect(
      client.mapRTorrentStatus(["hash-2", "Broken", 1, 0, 0, 0, 0, 0, 0, 0, 0, "boom", ""])
    ).toEqual(expect.objectContaining({ status: "error", error: "boom" }));

    expect(
      client.parseXMLRPCResponse(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value><string>one</string></value>
            <value><int>2</int></value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodResponse>`)
    ).toEqual(["one", 2]);

    expect(() =>
      client.parseXMLRPCResponse(`<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member>
          <name>faultString</name>
          <value><string>Nope</string></value>
        </member>
      </struct>
    </value>
  </fault>
</methodResponse>`)
    ).toThrow("XML-RPC Fault: Nope");
    expect(client.escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");

    randomBytesSpy.mockRestore();
  });

  it("covers rTorrent XML-RPC request auth and error branches", async () => {
    const client = new RTorrentClient(
      createDownloader({
        type: "rtorrent",
        url: "rt.local/base/",
        urlPath: "/RPC2",
        username: "user",
        password: "pass",
      })
    ) as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };

    const randomBytesSpy = vi
      .spyOn(crypto, "randomBytes")
      .mockReturnValue(Buffer.from("1234567890abcdef", "hex"));

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "auth needed",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "www-authenticate"
              ? 'Digest realm="rtorrent", nonce="abc", qop="auth"'
              : null,
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param><value><string>1.2.3</string></value></param>
  </params>
</methodResponse>`,
      } as Response);

    await expect(
      client.makeXMLRPCRequest("system.client_version", [Buffer.from("abc"), 1])
    ).resolves.toBe("1.2.3");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: expect.stringContaining('Digest username="user"'),
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "auth needed",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "www-authenticate"
              ? 'Digest realm="rtorrent", nonce="abc", qop="auth"'
              : null,
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "still bad",
      } as Response);

    await expect(client.makeXMLRPCRequest("system.client_version", ["a"])).rejects.toThrow(
      "Digest Auth Error: Digest Authentication failed (wrong credentials, or server may have switched to HTTPS)"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "bad gateway",
      headers: { get: () => null },
    } as Response);

    await expect(client.makeXMLRPCRequest("system.client_version", ["a"])).rejects.toThrow(
      "HTTP 500: Server Error - bad gateway"
    );

    randomBytesSpy.mockRestore();
  });

  it("covers Synology helper methods and status mapping", async () => {
    const client = new SynologyDownloadStationClient(
      createDownloader({
        type: "synology",
        url: "http://nas.local/root",
        port: 5001,
        urlPath: "downloadstation/",
        downloadPath: "/volume1/downloads",
      })
    ) as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      getBaseUrlParts(): { origin: string; prefix: string };
      getWebApiUrl(apiPath: string): string;
      getPreferredApiVersion(
        descriptor: { path: string; minVersion: number; maxVersion: number },
        preferred: number
      ): number;
      getTaskApiDescriptor(): {
        apiName: string;
        descriptor: { path: string; minVersion: number; maxVersion: number };
      };
      buildSynologyErrorMessage(
        error: { code?: number; errors?: { name?: string; reason?: string }[] } | undefined,
        fallback: string
      ): string;
      appendApiParams(
        target: URLSearchParams | FormData,
        params: Record<string, string | number | boolean | undefined>
      ): void;
      normalizeSynologyStatus(rawStatus: string | undefined, progress: number): string;
      mapSynologyDetails(task: Record<string, unknown>): Record<string, unknown>;
      getSynologyDestination(request: { downloadPath?: string }): Promise<string | undefined>;
    };

    expect(client.getBaseUrlParts()).toEqual({
      origin: "http://nas.local:5001",
      prefix: "/root/downloadstation",
    });
    expect(client.getWebApiUrl("/entry.cgi")).toBe(
      "http://nas.local:5001/root/downloadstation/webapi/entry.cgi"
    );
    expect(
      client.getPreferredApiVersion({ path: "entry.cgi", minVersion: 2, maxVersion: 3 }, 5)
    ).toBe(3);

    client.apiInfo = {
      "SYNO.DownloadStation.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
    };
    expect(client.getTaskApiDescriptor().apiName).toBe("SYNO.DownloadStation.Task");
    expect(client.buildSynologyErrorMessage({ code: 403 }, "Fallback")).toBe(
      "Synology destination was not found"
    );
    expect(client.buildSynologyErrorMessage(undefined, "Fallback")).toBe("Fallback");

    const params = new URLSearchParams();
    client.appendApiParams(params, {
      destination: "/downloads",
      create_list: false,
      skip: undefined,
    });
    expect(params.get("destination")).toBe("/downloads");
    expect(params.get("create_list")).toBe("false");
    expect(params.get("skip")).toBeNull();

    expect(client.normalizeSynologyStatus("paused", 100)).toBe("completed");
    expect(client.normalizeSynologyStatus("weird", 10)).toBe("downloading");

    const details = client.mapSynologyDetails({
      id: "dbid_1",
      title: "Questarr Game",
      size: 200,
      status: "error",
      additional: {
        transfer: {
          size_downloaded: 200,
          size_uploaded: 100,
          speed_download: 50,
          speed_upload: 10,
        },
        detail: {
          destination: "/volume1/downloads",
          uri: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
          create_time: 1710000000,
          completed_time: 1710000600,
        },
        file: [
          { filename: "game.iso", size: 200, size_downloaded: 200, priority: "high", wanted: true },
          { path: "extras.zip", size: 100, size_downloaded: 0, priority: 0, wanted: false },
        ],
        tracker: [
          {
            url: "https://tracker.one",
            tier: 0,
            status: "working",
            seeders: 5,
            leechers: 1,
            last_announce_time: 1710000000,
            next_announce_time: 1710001200,
          },
          {
            url: "https://tracker.two",
            tier: 1,
            status: "wait",
            error: "timeout",
          },
        ],
      },
    });

    expect(details).toEqual(
      expect.objectContaining({
        hash: "abcdef1234567890abcdef1234567890abcdef12",
        status: "error",
        ratio: 0.5,
        error: "Synology Download Station reported an error",
        downloadDir: "/volume1/downloads",
      })
    );
    expect(details.files).toEqual([
      expect.objectContaining({ priority: "high", wanted: true }),
      expect.objectContaining({ priority: "low", wanted: false }),
    ]);
    expect(details.trackers).toEqual([
      expect.objectContaining({ status: "working", lastAnnounce: expect.any(String) }),
      expect.objectContaining({ status: "error", error: "timeout" }),
    ]);
    expect(await client.getSynologyDestination({ downloadPath: "/custom" })).toBe("/custom");
    expect(await client.getSynologyDestination({})).toBe("/volume1/downloads");
  });

  it("covers Synology auth, retry, and logout helpers", async () => {
    const client = new SynologyDownloadStationClient(
      createDownloader({
        type: "synology",
        url: "http://nas.local:5000",
        username: "admin",
        password: "password",
      })
    ) as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      sessionId: string | null;
      authenticate(force?: boolean): Promise<void>;
      logout(): Promise<void>;
      requestApi<T>(
        apiName: string,
        descriptor: { path: string; minVersion: number; maxVersion: number },
        preferredVersion: number,
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          retryOnAuthFailure?: boolean;
          requiresAuth?: boolean;
        }
      ): Promise<T>;
      fetchJson<T>(url: string, init: RequestInit, context: string): Promise<T>;
      ensureApiInfo(): Promise<void>;
    };

    client.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 6 },
      "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
    };

    const fetchJsonSpy = vi.spyOn(client, "fetchJson");
    fetchJsonSpy.mockResolvedValueOnce({ success: true, data: { sid: "sid-1" } });

    await client.authenticate();
    expect(client.sessionId).toBe("sid-1");

    const authenticateSpy = vi.spyOn(client, "authenticate").mockImplementation(async (force) => {
      client.sessionId = force ? "sid-2" : "sid-1";
    });
    const ensureApiInfoSpy = vi.spyOn(client, "ensureApiInfo").mockResolvedValue(undefined);

    fetchJsonSpy
      .mockResolvedValueOnce({ success: false, error: { code: 106 } })
      .mockResolvedValueOnce({ success: true, data: { tasks: [] } });

    await expect(
      client.requestApi(
        "SYNO.DownloadStation2.Task",
        { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
        2,
        "list"
      )
    ).resolves.toEqual({ success: true, data: { tasks: [] } });
    expect(authenticateSpy).toHaveBeenCalledWith(true);

    client.sessionId = "sid-logout";
    fetchJsonSpy.mockRejectedValueOnce(new Error("logout failed"));
    await client.logout();
    expect(client.sessionId).toBeNull();
    expect(downloadersLogger.debug).toHaveBeenCalled();

    authenticateSpy.mockRestore();
    ensureApiInfoSpy.mockRestore();
  });

  it("covers Transmission request retry and error helpers", async () => {
    const client = new TransmissionClient(
      createDownloader({
        type: "transmission",
        url: "http://transmission.local",
        username: "user",
        password: "pass",
      })
    ) as unknown as {
      makeRequest(method: string, arguments_: unknown): Promise<unknown>;
      sessionId: string | null;
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: {
          get: (name: string) => (name === "X-Transmission-Session-Id" ? "session-1" : null),
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: "success", arguments: { ok: true } }),
      } as Response);

    await expect(client.makeRequest("session-get", {})).resolves.toEqual({
      result: "success",
      arguments: { ok: true },
    });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      "X-Transmission-Session-Id": "session-1",
      Authorization: `Basic ${Buffer.from("user:pass", "utf-8").toString("base64")}`,
    });

    client.sessionId = null;
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: {
          get: (name: string) => (name === "X-Transmission-Session-Id" ? "session-2" : null),
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "denied",
      } as Response);

    await expect(client.makeRequest("session-get", {})).rejects.toThrow(
      "Authentication failed: Invalid username or password for Transmission - denied"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "server down",
      headers: { get: () => null },
    } as Response);

    await expect(client.makeRequest("session-get", {})).rejects.toThrow(
      "HTTP 500: Server Error - server down"
    );
  });
});
