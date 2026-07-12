import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";

const safeFetchMock = vi.fn();
const fetchWithMagnetDetectionMock = vi.fn();

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: safeFetchMock,
}));

vi.mock("../downloaders/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../downloaders/utils.js")>();
  return {
    ...actual,
    fetchWithMagnetDetection: fetchWithMagnetDetectionMock,
  };
});

const { isSafeUrl } = await import("../ssrf.js");
const { SynologyDownloadStationClient } = await import("../downloaders/synology.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "synology-coverage",
    name: "Synology",
    type: "synology",
    url: "http://nas.local/root",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "admin",
    password: "password",
    downloadPath: "/volume1/downloads",
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

describe("synology remaining regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeFetchMock.mockReset();
    fetchWithMagnetDetectionMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("covers helper methods, API info loading, auth, and requestApi branches", async () => {
    const invalidClient = new SynologyDownloadStationClient(
      createDownloader({ url: "http://bad host/", urlPath: "/downloads/" })
    ) as unknown as {
      getBaseUrlParts(): { origin: string; prefix: string };
    };
    expect(invalidClient.getBaseUrlParts()).toEqual({
      origin: "http://bad host",
      prefix: "/downloads",
    });

    const client = new SynologyDownloadStationClient(createDownloader()) as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      sessionId: string | null;
      getApiDescriptor(apiName: string): { path: string; minVersion: number; maxVersion: number };
      getTaskApiDescriptor(): {
        apiName: string;
        descriptor: { path: string; minVersion: number; maxVersion: number };
      };
      buildSynologyErrorMessage(
        error: { code?: number; errors?: { name?: string; reason?: string }[] } | undefined,
        fallback: string
      ): string;
      fetchJson<T>(url: string, init: RequestInit, context: string): Promise<T>;
      ensureApiInfo(): Promise<void>;
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
      requestTaskApi<T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          retryOnAuthFailure?: boolean;
        }
      ): Promise<T>;
      normalizeSynologyStatus(rawStatus: string | undefined, progress: number): string;
      mapSynologyFilePriority(priority: string | number | undefined): string;
      mapSynologyTrackerStatus(status: string | undefined, error: string | undefined): string;
      mapSynologyStatus(task: Record<string, unknown>): Record<string, unknown>;
    };

    expect(() => client.getApiDescriptor("SYNO.API.Auth")).toThrow(
      "Synology API SYNO.API.Auth is not available on this server"
    );
    expect(() => client.getTaskApiDescriptor()).toThrow(
      "Synology API information has not been loaded"
    );
    expect(client.buildSynologyErrorMessage({ code: 101 }, "fallback")).toBe(
      "Synology rejected the request parameters"
    );
    expect(client.buildSynologyErrorMessage({ code: 105 }, "fallback")).toBe(
      "Synology permission denied"
    );
    expect(client.buildSynologyErrorMessage({ code: 106 }, "fallback")).toBe(
      "Synology session expired"
    );
    expect(client.buildSynologyErrorMessage({ code: 400 }, "fallback")).toBe(
      "Synology authentication failed"
    );
    expect(client.buildSynologyErrorMessage({ code: 402 }, "fallback")).toBe(
      "Synology destination access denied"
    );
    expect(client.buildSynologyErrorMessage({ code: 120 }, "fallback")).toBe(
      "Synology rejected the request — a destination folder is required"
    );
    expect(
      client.buildSynologyErrorMessage(
        { code: 120, errors: [{ name: "destination", reason: "required" }] },
        "fallback"
      )
    ).toBe("fallback (code 120): destination: required");

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.fetchJson("http://unsafe.local/webapi/entry.cgi", { method: "GET" }, "Unsafe request")
    ).rejects.toThrow("Unsafe URL blocked");

    safeFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Boom",
      text: async () => {
        throw new Error("no body");
      },
    } as Response);
    await expect(
      client.fetchJson("http://nas.local/webapi/entry.cgi", { method: "GET" }, "Fetch failed")
    ).rejects.toThrow("Fetch failed: HTTP 500 Boom - No error details available");

    safeFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { ok: true } }),
    } as Response);
    await expect(
      client.fetchJson<{ success: boolean; data: { ok: boolean } }>(
        "http://nas.local/webapi/entry.cgi",
        { method: "GET" },
        "Fetch ok"
      )
    ).resolves.toEqual({ success: true, data: { ok: true } });

    const fetchJsonSpy = vi.spyOn(client, "fetchJson");
    fetchJsonSpy.mockResolvedValueOnce({ success: false, error: { code: 105 } });
    await expect(client.ensureApiInfo()).rejects.toThrow("Synology permission denied");

    fetchJsonSpy.mockResolvedValueOnce({
      success: true,
      data: {
        "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
        "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
      },
    });
    await expect(client.ensureApiInfo()).resolves.toBeUndefined();
    expect(client.apiInfo).toMatchObject({
      "SYNO.API.Auth": expect.any(Object),
      "SYNO.DownloadStation2.Task": expect.any(Object),
    });
    expect(client.getTaskApiDescriptor().apiName).toBe("SYNO.DownloadStation2.Task");
    client.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
    };
    expect(() => client.getTaskApiDescriptor()).toThrow(
      "Synology Download Station Task API is not available on this server"
    );

    client.sessionId = "sid-existing";
    await expect(client.authenticate()).resolves.toBeUndefined();

    const noCredsClient = new SynologyDownloadStationClient(
      createDownloader({ username: null, password: null })
    ) as unknown as {
      authenticate(force?: boolean): Promise<void>;
    };
    await expect(noCredsClient.authenticate()).rejects.toThrow(
      "Synology Download Station requires a username and password"
    );

    client.sessionId = null;
    fetchJsonSpy.mockResolvedValueOnce({ success: true, data: {} });
    await expect(client.authenticate(true)).rejects.toThrow(
      "Failed to authenticate with Synology Download Station"
    );

    client.sessionId = null;
    await expect(client.logout()).resolves.toBeUndefined();

    const ensureSpy = vi.spyOn(client, "ensureApiInfo").mockResolvedValue(undefined);
    client.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
      "SYNO.DownloadStation.Task": { path: "task.cgi", minVersion: 1, maxVersion: 3 },
      "SYNO.FileStation.Info": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
    };
    vi.spyOn(client, "authenticate").mockResolvedValue(undefined);
    client.sessionId = "sid-1";

    fetchJsonSpy.mockResolvedValueOnce({ success: false, error: { code: 403 } });
    await expect(
      client.requestApi(
        "SYNO.DownloadStation.Task",
        { path: "task.cgi", minVersion: 1, maxVersion: 3 },
        3,
        "list",
        { httpMethod: "GET", requiresAuth: false }
      )
    ).rejects.toThrow("Synology destination was not found");
    expect(ensureSpy).toHaveBeenCalled();

    fetchJsonSpy.mockResolvedValueOnce({ success: true, data: { task_id: ["task-1"] } });
    await expect(
      client.requestApi(
        "SYNO.DownloadStation.Task",
        { path: "task.cgi", minVersion: 1, maxVersion: 3 },
        3,
        "create",
        {
          httpMethod: "POST",
          body: new FormData(),
        }
      )
    ).resolves.toMatchObject({ success: true, data: { task_id: ["task-1"] } });

    fetchJsonSpy
      .mockResolvedValueOnce({ success: false, error: { code: 106 } })
      .mockResolvedValueOnce({ success: true, data: { task_id: ["task-2"] } });
    await expect(
      client.requestApi(
        "SYNO.DownloadStation.Task",
        { path: "task.cgi", minVersion: 1, maxVersion: 3 },
        3,
        "create",
        {
          httpMethod: "POST",
          body: new URLSearchParams(),
        }
      )
    ).resolves.toMatchObject({ success: true, data: { task_id: ["task-2"] } });

    fetchJsonSpy.mockResolvedValueOnce({ success: false, error: { code: 105 } });
    await expect(
      client.requestApi(
        "SYNO.DownloadStation.Task",
        { path: "task.cgi", minVersion: 1, maxVersion: 3 },
        3,
        "create",
        {
          httpMethod: "POST",
          body: new URLSearchParams(),
          retryOnAuthFailure: false,
        }
      )
    ).rejects.toThrow("Synology permission denied");

    const requestApiSpy = vi.spyOn(client, "requestApi").mockResolvedValue({
      success: true,
      data: { tasks: [] },
    } as never);
    await expect(client.requestTaskApi("list", { httpMethod: "GET" })).resolves.toMatchObject({
      success: true,
    });
    expect(requestApiSpy).toHaveBeenCalledWith(
      "SYNO.DownloadStation.Task",
      { path: "task.cgi", minVersion: 1, maxVersion: 3 },
      3,
      "list",
      { httpMethod: "GET" }
    );

    expect(client.normalizeSynologyStatus("finished", 0)).toBe("completed");
    expect(client.normalizeSynologyStatus("seeding", 50)).toBe("seeding");
    expect(client.normalizeSynologyStatus("waiting", 20)).toBe("downloading");
    expect(client.mapSynologyFilePriority(undefined)).toBe("normal");
    expect(client.mapSynologyTrackerStatus(undefined, undefined)).toBe("inactive");
    expect(client.mapSynologyTrackerStatus("updating", undefined)).toBe("updating");
    expect(client.mapSynologyTrackerStatus("failed", undefined)).toBe("error");
    expect(client.mapSynologyTrackerStatus("idle", undefined)).toBe("inactive");
    expect(
      client.mapSynologyStatus({
        id: "task-finished",
        status: "finished",
        additional: { transfer: {} },
      }).progress
    ).toBe(100);
  });

  it("covers task lookup, addDownload fallback branches, public operation success, and free-space variants", async () => {
    const client = new SynologyDownloadStationClient(createDownloader());
    const privateClient = client as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      ensureApiInfo(): Promise<void>;
      getTaskApiDescriptor(): {
        apiName: string;
        descriptor?: { path: string; minVersion: number; maxVersion: number };
      };
      requestTaskApi<T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          retryOnAuthFailure?: boolean;
        }
      ): Promise<T>;
      getTask(id: string, additional: string): Promise<unknown>;
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
    };

    privateClient.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
      "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
      "SYNO.FileStation.Info": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
    };

    const requestTaskApiSpy = vi.spyOn(privateClient, "requestTaskApi");
    requestTaskApiSpy
      .mockResolvedValueOnce({ success: true, data: { tasks: [{ id: "task-1" }] } } as never)
      .mockResolvedValueOnce({ success: true, data: { tasks: [] } } as never);
    await expect(privateClient.getTask("task-1", "detail")).resolves.toEqual({ id: "task-1" });
    await expect(privateClient.getTask("missing", "detail")).resolves.toBeNull();

    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      magnetLink: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
    });
    requestTaskApiSpy.mockResolvedValueOnce({
      success: true,
      data: { task_id: ["task-magnet"] },
    } as never);
    await expect(
      client.addDownload({ url: "http://indexer.local/redirect.torrent", title: "Redirected" })
    ).resolves.toEqual({
      success: true,
      id: "task-magnet",
      message: "Download added successfully",
    });

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: false,
        statusText: "Service Unavailable",
      } as Response,
    });
    await expect(
      client.addDownload({ url: "http://indexer.local/broken.torrent", title: "Broken" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to fetch download: Service Unavailable",
    });

    fetchWithMagnetDetectionMock.mockRejectedValueOnce("boom");
    await expect(
      client.addDownload({ url: "http://indexer.local/throw.torrent", title: "Thrown" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download to Synology Download Station: Unknown error",
    });

    vi.spyOn(privateClient, "getTask").mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(client.getDownloadStatus("missing")).resolves.toBeNull();
    await expect(client.getDownloadDetails("missing")).resolves.toBeNull();

    requestTaskApiSpy
      .mockResolvedValueOnce({ success: true } as never)
      .mockResolvedValueOnce({ success: true } as never)
      .mockResolvedValueOnce({ success: true } as never);
    await expect(client.pauseDownload("task-1")).resolves.toEqual({
      success: true,
      message: "Download paused successfully",
    });
    await expect(client.resumeDownload("task-1")).resolves.toEqual({
      success: true,
      message: "Download resumed successfully",
    });
    await expect(client.removeDownload("task-1", true)).resolves.toEqual({
      success: true,
      message: "Download removed successfully",
    });

    const requestApiSpy = vi.spyOn(privateClient, "requestApi");
    requestApiSpy
      .mockResolvedValueOnce({ success: true, data: { useable_space: 1234 } } as never)
      .mockResolvedValueOnce({
        success: true,
        data: { volume_status: [{ free: 5678 }] },
      } as never)
      .mockRejectedValueOnce(new Error("space boom"));
    await expect(client.getFreeSpace()).resolves.toBe(1234);
    await expect(client.getFreeSpace()).resolves.toBe(5678);
    await expect(client.getFreeSpace()).resolves.toBe(0);
  });

  it("sends a GET create request with the correct query params per API version for magnet task creation", async () => {
    const client = new SynologyDownloadStationClient(createDownloader());
    const privateClient = client as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      ensureApiInfo(): Promise<void>;
      getTaskApiDescriptor(): { apiName: string; descriptor?: unknown };
      requestTaskApi<T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
        }
      ): Promise<T>;
    };

    const magnetUrl = "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12";
    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    const requestTaskApiSpy = vi
      .spyOn(privateClient, "requestTaskApi")
      .mockResolvedValue({ success: true, data: { task_id: ["task-1"] } } as never);

    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });
    await client.addDownload({ url: magnetUrl, title: "DS2 magnet" });
    expect(requestTaskApiSpy).toHaveBeenLastCalledWith("create", {
      httpMethod: "GET",
      params: {
        type: "url",
        url: magnetUrl,
        create_list: false,
        destination: "/volume1/downloads",
      },
    });

    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation.Task",
    });
    await client.addDownload({ url: magnetUrl, title: "Legacy magnet" });
    expect(requestTaskApiSpy).toHaveBeenLastCalledWith("create", {
      httpMethod: "GET",
      params: {
        uri: magnetUrl,
        destination: "/volume1/downloads",
      },
    });
  });

  it("uploads files with the file field appended last and the correct DS2/legacy multipart shape", async () => {
    const client = new SynologyDownloadStationClient(createDownloader());
    const privateClient = client as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      ensureApiInfo(): Promise<void>;
      getTaskApiDescriptor(): { apiName: string; descriptor?: unknown };
      requestTaskApi<T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          sidInQuery?: boolean;
          appendFileLast?: (formData: FormData) => void;
        }
      ): Promise<T>;
    };

    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    const requestTaskApiSpy = vi
      .spyOn(privateClient, "requestTaskApi")
      .mockResolvedValue({ success: true, data: { task_id: ["task-file"] } } as never);

    const torrentUrl = "http://indexer.local/release.torrent";
    fetchWithMagnetDetectionMock.mockResolvedValue({
      response: {
        ok: true,
        headers: new Headers({
          "content-disposition": 'attachment; filename="release.torrent"',
          "content-type": "application/x-bittorrent",
        }),
        arrayBuffer: async () => new TextEncoder().encode("torrent-bytes").buffer,
      } as unknown as Response,
    });

    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });
    await client.addDownload({ url: torrentUrl, title: "DS2 file" });

    let call = requestTaskApiSpy.mock.calls.at(-1)!;
    expect(call[0]).toBe("create");
    expect(call[1]).toMatchObject({
      httpMethod: "POST",
      sidInQuery: true,
      params: {
        type: '"file"',
        file: '["fileData"]',
        create_list: false,
        destination: '"/volume1/downloads"',
      },
    });
    let formData = new FormData();
    call[1]!.appendFileLast!(formData);
    expect([...formData.keys()]).toEqual(["fileData"]);

    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation.Task",
    });
    await client.addDownload({ url: torrentUrl, title: "Legacy file" });

    call = requestTaskApiSpy.mock.calls.at(-1)!;
    expect(call[1]).toMatchObject({
      httpMethod: "POST",
      sidInQuery: false,
      params: {
        destination: "/volume1/downloads",
      },
    });
    formData = new FormData();
    call[1]!.appendFileLast!(formData);
    expect([...formData.keys()]).toEqual(["file"]);
  });

  it("appends the file field last in the real multipart body built by requestApi", async () => {
    const client = new SynologyDownloadStationClient(createDownloader()) as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      sessionId: string | null;
      authenticate(force?: boolean): Promise<void>;
      fetchJson<T>(url: string, init: RequestInit, context: string): Promise<T>;
      requestApi<T>(
        apiName: string,
        descriptor: { path: string; minVersion: number; maxVersion: number },
        preferredVersion: number,
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          sidInQuery?: boolean;
          appendFileLast?: (formData: FormData) => void;
        }
      ): Promise<T>;
    };

    client.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
      "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
      "SYNO.DownloadStation.Task": { path: "task.cgi", minVersion: 1, maxVersion: 3 },
    };
    vi.spyOn(client, "authenticate").mockResolvedValue(undefined);
    client.sessionId = "sid-real";

    const fetchJsonSpy = vi
      .spyOn(client, "fetchJson")
      .mockResolvedValue({ success: true, data: { task_id: ["task-order"] } });

    await client.requestApi(
      "SYNO.DownloadStation2.Task",
      { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
      2,
      "create",
      {
        httpMethod: "POST",
        params: { type: '"file"', file: '["fileData"]', create_list: false },
        body: new FormData(),
        sidInQuery: true,
        appendFileLast: (formData) => {
          formData.append("fileData", new Blob(["bytes"]), "release.torrent");
        },
      }
    );

    let [url, init] = fetchJsonSpy.mock.calls.at(-1)!;
    let keys = [...(init.body as FormData).keys()];
    expect(keys[0]).toBe("api");
    expect(keys.at(-1)).toBe("fileData");
    expect(keys).not.toContain("_sid");
    expect(url).toContain("_sid=sid-real");

    fetchJsonSpy.mockClear();
    await client.requestApi(
      "SYNO.DownloadStation.Task",
      { path: "task.cgi", minVersion: 1, maxVersion: 3 },
      2,
      "create",
      {
        httpMethod: "POST",
        body: new FormData(),
        appendFileLast: (formData) => {
          formData.append("file", new Blob(["bytes"]), "release.torrent");
        },
      }
    );

    [url, init] = fetchJsonSpy.mock.calls.at(-1)!;
    keys = [...(init.body as FormData).keys()];
    expect(keys[0]).toBe("api");
    expect(keys.at(-1)).toBe("file");
    expect(keys).toContain("_sid");
  });

  it("fails fast when no destination is configured and the NAS has no default either", async () => {
    const client = new SynologyDownloadStationClient(createDownloader({ downloadPath: null }));
    const privateClient = client as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      ensureApiInfo(): Promise<void>;
      getTaskApiDescriptor(): { apiName: string; descriptor?: unknown };
      requestApi<T>(
        apiName: string,
        descriptor: { path: string; minVersion: number; maxVersion: number },
        preferredVersion: number,
        methodName: string,
        options?: { httpMethod?: "GET" | "POST" }
      ): Promise<T>;
      requestTaskApi<T>(methodName: string): Promise<T>;
    };

    privateClient.apiInfo = {
      "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
      "SYNO.DownloadStation.Info": { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
    };
    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });
    const requestApiSpy = vi
      .spyOn(privateClient, "requestApi")
      .mockResolvedValue({ success: true, data: { default_destination: "" } } as never);
    const requestTaskApiSpy = vi.spyOn(privateClient, "requestTaskApi");

    await expect(
      client.addDownload({ url: "http://indexer.local/game.torrent", title: "Game" })
    ).resolves.toEqual({
      success: false,
      message:
        "No download destination configured. Set a Download Path for this downloader in " +
        "Questarr, or configure a default destination in Synology Download Station settings.",
    });

    expect(requestApiSpy).toHaveBeenCalledWith(
      "SYNO.DownloadStation.Info",
      { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
      1,
      "getconfig",
      { httpMethod: "GET" }
    );
    expect(requestTaskApiSpy).not.toHaveBeenCalled();

    // Cached: a second call must not re-query the NAS.
    requestApiSpy.mockClear();
    await client.addDownload({ url: "http://indexer.local/game2.torrent", title: "Game 2" });
    expect(requestApiSpy).not.toHaveBeenCalled();
  });

  it("falls back to the NAS default destination when no path is configured anywhere else", async () => {
    const client = new SynologyDownloadStationClient(createDownloader({ downloadPath: null }));
    const privateClient = client as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      ensureApiInfo(): Promise<void>;
      getTaskApiDescriptor(): { apiName: string; descriptor?: unknown };
      requestApi<T>(
        apiName: string,
        descriptor: { path: string; minVersion: number; maxVersion: number },
        preferredVersion: number,
        methodName: string,
        options?: { httpMethod?: "GET" | "POST" }
      ): Promise<T>;
      requestTaskApi<T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
        }
      ): Promise<T>;
    };

    privateClient.apiInfo = {
      "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
      "SYNO.DownloadStation.Info": { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
    };
    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });
    vi.spyOn(privateClient, "requestApi").mockResolvedValue({
      success: true,
      data: { default_destination: "/volume2/nas-default" },
    } as never);
    const requestTaskApiSpy = vi
      .spyOn(privateClient, "requestTaskApi")
      .mockResolvedValue({ success: true, data: { task_id: ["task-default"] } } as never);

    const magnetUrl = "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12";
    await expect(
      client.addDownload({ url: magnetUrl, title: "Magnet using NAS default" })
    ).resolves.toEqual({
      success: true,
      id: "task-default",
      message: "Download added successfully",
    });

    expect(requestTaskApiSpy).toHaveBeenLastCalledWith("create", {
      httpMethod: "GET",
      params: {
        type: "url",
        url: magnetUrl,
        create_list: false,
        destination: "/volume2/nas-default",
      },
    });
  });
});
