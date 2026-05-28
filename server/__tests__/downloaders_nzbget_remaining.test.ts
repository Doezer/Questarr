import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";
import { NZBGetClient } from "../downloaders/nzbget.js";

vi.mock("../logger.js", () => ({
  downloadersLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn(),
  safeFetch: vi.fn(),
}));

const { isSafeUrl, safeFetch } = await import("../ssrf.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "nzbget-1",
    name: "NZBGet",
    type: "nzbget",
    url: "nzbget.local/",
    enabled: true,
    priority: 1,
    port: 6789,
    useSsl: false,
    urlPath: "xmlrpc",
    username: "user",
    password: "pass",
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

describe("NZBGet remaining coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
    vi.mocked(safeFetch).mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("covers URL fallback, XML value parsing fallbacks, faults, and null responses", async () => {
    const client = new NZBGetClient(createDownloader({ url: "http://bad url/", port: null }));
    const privateClient = client as unknown as {
      getBaseUrl: () => string;
      buildXMLValue: (value: unknown) => string;
      parseValueObj: (value: unknown) => unknown;
      makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
    };

    expect(privateClient.getBaseUrl()).toBe("http://bad url");
    expect(privateClient.buildXMLValue(undefined)).toBe("");
    expect(privateClient.parseValueObj("raw")).toBe("raw");
    expect(privateClient.parseValueObj([7])).toBe(7);
    expect(privateClient.parseValueObj({ array: { data: null } })).toEqual([]);
    expect(privateClient.parseValueObj({ array: { data: { nope: [] } } })).toEqual([]);
    expect(privateClient.parseValueObj({ struct: { member: null } })).toEqual({});
    expect(privateClient.parseValueObj({ _text: "direct text" })).toBe("direct text");
    expect(privateClient.parseValueObj({ fallback: "value" })).toBe("value");

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("read failed")),
    } as unknown as Response);
    await expect(privateClient.makeXMLRPCRequest("status")).rejects.toThrow(
      "HTTP 503: No error details"
    );

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () =>
        `<?xml version="1.0"?>
         <methodResponse>
           <fault>
             <value>
               <struct>
                 <member><name>faultCode</name><value><int>7</int></value></member>
                 <member><name>faultString</name><value><string>Bad fault</string></value></member>
               </struct>
             </value>
           </fault>
         </methodResponse>`,
    } as Response);
    await expect(privateClient.makeXMLRPCRequest("status")).rejects.toThrow(
      "NZBGet Fault: Bad fault (7)"
    );

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () =>
        `<?xml version="1.0"?>
         <methodResponse>
           <params>
             <param>
               <value><string>pong</string></value>
             </param>
           </params>
         </methodResponse>`,
    } as Response);
    await expect(privateClient.makeXMLRPCRequest("echo", ["param"])).resolves.toBe("pong");

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?><methodResponse></methodResponse>`,
    } as Response);
    await expect(privateClient.makeXMLRPCRequest("status")).resolves.toBeNull();
  });

  it("covers addDownload catches plus status and history branches", async () => {
    const client = new NZBGetClient(createDownloader());
    const privateClient = client as unknown as {
      makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
      getFromHistory: (id: string) => Promise<unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    vi.mocked(safeFetch).mockRejectedValueOnce(new Error("fetch exploded"));
    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Broken NZB" })
    ).resolves.toEqual({
      success: false,
      message: "fetch exploded",
    });

    rpcSpy
      .mockResolvedValueOnce([
        {
          NZBID: 1,
          NZBName: "Fetching Game",
          Status: "FETCHING",
          FileSizeMB: 10,
          RemainingSizeMB: 5,
          DownloadedSizeMB: 5,
          Category: "games",
          DownloadRate: 2,
          PostInfoText: "",
          PostStageProgress: 0,
          PostStageTimeSec: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          NZBID: 2,
          NZBName: "Repair Game",
          Status: "POST_PROCESSING",
          FileSizeMB: 10,
          RemainingSizeMB: 0,
          DownloadedSizeMB: 10,
          Category: "games",
          DownloadRate: 0,
          PostInfoText: "Repairing set",
          PostStageProgress: 0,
          PostStageTimeSec: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          NZBID: 3,
          NZBName: "Post Game",
          Status: "POST_PROCESSING",
          FileSizeMB: 10,
          RemainingSizeMB: 0,
          DownloadedSizeMB: 10,
          Category: "games",
          DownloadRate: 0,
          PostInfoText: "Processing",
          PostStageProgress: 0,
          PostStageTimeSec: 0,
        },
      ])
      .mockRejectedValueOnce(new Error("status failed"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("history failed"));

    await expect(client.getDownloadStatus("1")).resolves.toMatchObject({ status: "downloading" });
    await expect(client.getDownloadStatus("2")).resolves.toMatchObject({
      status: "repairing",
      repairStatus: "repairing",
    });
    await expect(client.getDownloadStatus("3")).resolves.toMatchObject({ status: "downloading" });
    await expect(client.getDownloadStatus("4")).resolves.toBeNull();
    await expect(client.getDownloadStatus("5")).resolves.toBeNull();

    rpcSpy.mockRejectedValueOnce(new Error("history failed"));
    await expect(privateClient.getFromHistory("6")).resolves.toBeNull();
  });

  it("covers detail and queue error fallbacks", async () => {
    const client = new NZBGetClient(createDownloader());
    const statusSpy = vi.spyOn(client, "getDownloadStatus");
    const rpcSpy = vi.spyOn(
      client as unknown as { makeXMLRPCRequest: typeof Function },
      "makeXMLRPCRequest"
    );

    statusSpy.mockResolvedValueOnce(null);
    await expect(client.getDownloadDetails("missing")).resolves.toBeNull();

    rpcSpy.mockRejectedValueOnce(new Error("queue failed"));
    await expect(client.getAllDownloads()).resolves.toEqual([]);
  });
});
