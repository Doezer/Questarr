import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";
import { NZBGetClient } from "../downloaders/nzbget.js";

// Exposes NZBGetClient's private makeXMLRPCRequest with its real signature for
// spying, rather than casting through the untyped `typeof Function` at each call site.
interface NZBGetClientInternals {
  makeXMLRPCRequest: (
    method: string,
    params?: unknown[],
    requireHttps?: boolean
  ) => Promise<unknown>;
}

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
    // Default: forward to the (mocked) global fetch so existing tests that only
    // stub `fetch` keep working now that downloader requests go through safeFetch.
    vi.mocked(safeFetch).mockImplementation((url: string, options?: RequestInit) =>
      fetch(url, options)
    );
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
    // makeXMLRPCRequest must route through the SSRF-safe wrapper, not raw fetch.
    expect(safeFetch).toHaveBeenCalled();

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

  it.each(["SUCCESS/GOOD", "SUCCESS/UNPACK", "SUCCESS/HEALTH", "SUCCESS/ALL"])(
    "treats history status %s as completed",
    async (historyStatus) => {
      const client = new NZBGetClient(createDownloader());
      const privateClient = client as unknown as {
        makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
        getFromHistory: (id: string) => Promise<unknown>;
      };
      vi.spyOn(privateClient, "makeXMLRPCRequest").mockResolvedValueOnce([
        {
          NZBID: 7,
          Name: "Finished Game",
          Status: historyStatus,
          FileSizeMB: 20,
          Category: "games",
          DownloadTimeSec: 90,
          ParStatus: "NONE",
          UnpackStatus: "NONE",
          FailedArticles: 0,
          DeleteStatus: "NONE",
          DestDir: "/downloads",
        },
      ]);

      await expect(privateClient.getFromHistory("7")).resolves.toMatchObject({
        status: "completed",
        progress: 100,
      });
    }
  );

  it("does not treat an unrelated overall status as completed", async () => {
    const client = new NZBGetClient(createDownloader());
    const privateClient = client as unknown as {
      makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
      getFromHistory: (id: string) => Promise<unknown>;
    };
    vi.spyOn(privateClient, "makeXMLRPCRequest").mockResolvedValueOnce([
      {
        NZBID: 8,
        Name: "Unknown Status Game",
        Status: "SUCCESSFUL/NOTAREALSTATUS",
        FileSizeMB: 20,
        Category: "games",
        DownloadTimeSec: 90,
        ParStatus: "NONE",
        UnpackStatus: "NONE",
        FailedArticles: 0,
        DeleteStatus: "NONE",
        DestDir: "/downloads",
      },
    ]);

    await expect(privateClient.getFromHistory("8")).resolves.toMatchObject({
      status: "error",
    });
  });

  it("covers detail and queue error fallbacks", async () => {
    const client = new NZBGetClient(createDownloader());
    const statusSpy = vi.spyOn(client, "getDownloadStatus");
    const rpcSpy = vi.spyOn(client as unknown as NZBGetClientInternals, "makeXMLRPCRequest");

    statusSpy.mockResolvedValueOnce(null);
    await expect(client.getDownloadDetails("missing")).resolves.toBeNull();

    rpcSpy.mockRejectedValueOnce(new Error("queue failed"));
    await expect(client.getAllDownloads()).resolves.toEqual([]);
  });

  it("getDownloadDetails populates downloadDir from history's DestDir for completed downloads", async () => {
    const client = new NZBGetClient(createDownloader());
    const rpcSpy = vi.spyOn(client as unknown as NZBGetClientInternals, "makeXMLRPCRequest");

    // getDownloadStatus: not in the live queue, falls back to history.
    rpcSpy.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        NZBID: 9,
        Name: "Finished Game",
        Status: "SUCCESS/ALL",
        FileSizeMB: 20,
        Category: "games",
        DownloadTimeSec: 90,
        ParStatus: "NONE",
        UnpackStatus: "NONE",
        FailedArticles: 0,
        DeleteStatus: "NONE",
        DestDir: "/downloads/nzbget/Questarr/Finished Game",
      },
    ]);
    // The subsequent getHistoryDestDir call for the same completed download.
    rpcSpy.mockResolvedValueOnce([
      {
        NZBID: 9,
        Name: "Finished Game",
        Status: "SUCCESS/ALL",
        FileSizeMB: 20,
        Category: "games",
        DownloadTimeSec: 90,
        ParStatus: "NONE",
        UnpackStatus: "NONE",
        FailedArticles: 0,
        DeleteStatus: "NONE",
        DestDir: "/downloads/nzbget/Questarr/Finished Game",
      },
    ]);

    await expect(client.getDownloadDetails("9")).resolves.toMatchObject({
      status: "completed",
      downloadDir: "/downloads/nzbget/Questarr/Finished Game",
    });
  });

  it("getDownloadDetails leaves downloadDir unset for downloads still in progress", async () => {
    const client = new NZBGetClient(createDownloader());
    const rpcSpy = vi.spyOn(client as unknown as NZBGetClientInternals, "makeXMLRPCRequest");

    rpcSpy.mockResolvedValueOnce([
      {
        NZBID: 10,
        NZBName: "In Progress Game",
        Status: "DOWNLOADING",
        FileSizeMB: 10,
        RemainingSizeMB: 5,
        DownloadedSizeMB: 5,
        Category: "games",
        DownloadRate: 2,
        PostInfoText: "",
        PostStageProgress: 0,
        PostStageTimeSec: 0,
      },
    ]);

    const details = await client.getDownloadDetails("10");
    expect(details).toMatchObject({ status: "downloading" });
    expect(details?.downloadDir).toBeUndefined();
    // No extra history round-trip should happen for a non-completed download.
    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the request password, falling back to the downloader's default archive password", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      text: async () => "nzb-content",
    } as Response);

    // Asserts a single addDownload call's PPParameters against the expected password,
    // reusing one client/spy across sequential calls when reuseSpy is passed.
    const expectPasswordInRequest = async (
      client: NZBGetClient,
      request: Parameters<NZBGetClient["addDownload"]>[0],
      expectedPassword: string | undefined,
      reuseSpy?: ReturnType<typeof vi.spyOn>
    ) => {
      const spy =
        reuseSpy ?? vi.spyOn(client as unknown as NZBGetClientInternals, "makeXMLRPCRequest");
      spy.mockResolvedValueOnce(42);
      await client.addDownload(request);
      const lastCall = spy.mock.calls.at(-1);
      const ppParameters = lastCall?.[1]?.at(-1);
      expect(ppParameters).toEqual(
        expectedPassword ? [{ Name: "*Unpack:Password", Value: expectedPassword }] : []
      );
      // A password-bearing append call must also require HTTPS on every hop,
      // rejecting a redirect that would resend it over plaintext.
      expect(lastCall?.[2]).toBe(!!expectedPassword);
      return spy;
    };

    // Per-request password wins over the downloader's default. Uses SSL so the
    // password isn't blocked by the plain-HTTP guard tested separately below.
    const withDefault = new NZBGetClient(
      createDownloader({ useSsl: true, settings: JSON.stringify({ archivePassword: "404" }) })
    );
    const withDefaultSpy = await expectPasswordInRequest(
      withDefault,
      { url: "http://indexer.local/g4u.nzb", title: "G4U Release", password: "override" },
      "override"
    );
    // Falls back to the downloader's default archive password when none is given per-request.
    await expectPasswordInRequest(
      withDefault,
      { url: "http://indexer.local/g4u.nzb", title: "G4U Release" },
      "404",
      withDefaultSpy
    );

    // No password configured anywhere — PPParameters stays empty.
    await expectPasswordInRequest(
      new NZBGetClient(createDownloader()),
      { url: "http://indexer.local/plain.nzb", title: "Plain NZB" },
      undefined
    );

    // Malformed settings JSON is tolerated and treated as no default password.
    await expectPasswordInRequest(
      new NZBGetClient(createDownloader({ settings: "not-json" })),
      { url: "http://indexer.local/plain.nzb", title: "Plain NZB" },
      undefined
    );
  });

  it("refuses to send an archive password over a plain-HTTP NZBGet connection", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      text: async () => "nzb-content",
    } as Response);

    const client = new NZBGetClient(createDownloader({ useSsl: false }));
    const rpcSpy = vi.spyOn(client as unknown as NZBGetClientInternals, "makeXMLRPCRequest");

    const result = await client.addDownload({
      url: "http://indexer.local/g4u.nzb",
      title: "G4U Release",
      password: "404",
    });

    expect(result).toEqual({
      success: false,
      message:
        "Refusing to send the archive password over an insecure connection. Enable SSL for this NZBGet downloader, or remove the archive password.",
    });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("redacts the archive password in PPParameters debug logging", async () => {
    const { downloadersLogger } = await import("../logger.js");
    vi.mocked(safeFetch).mockImplementation(async (url: string) => {
      if (url.includes("g4u.nzb")) {
        return { ok: true, text: async () => "nzb-content" } as Response;
      }
      return {
        ok: true,
        text: async () =>
          `<?xml version="1.0"?>
           <methodResponse>
             <params>
               <param><value><int>99</int></value></param>
             </params>
           </methodResponse>`,
      } as Response;
    });

    const client = new NZBGetClient(createDownloader({ useSsl: true }));
    await client.addDownload({
      url: "http://indexer.local/g4u.nzb",
      title: "G4U Release",
      password: "404",
    });

    const debugCalls = vi.mocked(downloadersLogger.debug).mock.calls;
    const rpcLogCall = debugCalls.find(
      ([, message]) => message === "Making NZBGet XML-RPC request"
    );
    expect(rpcLogCall).toBeDefined();
    expect(JSON.stringify(rpcLogCall)).not.toContain("404");
    const loggedParams = (rpcLogCall?.[0] as { params: unknown[] }).params;
    expect(loggedParams.at(-1)).toEqual([{ Name: "*Unpack:Password", Value: "<redacted>" }]);
  });

  it("getHistoryDestDir logs and returns undefined when the history lookup fails", async () => {
    const client = new NZBGetClient(createDownloader());
    const rpcSpy = vi.spyOn(client as unknown as NZBGetClientInternals, "makeXMLRPCRequest");

    rpcSpy
      .mockResolvedValueOnce([]) // getDownloadStatus: not in queue
      .mockResolvedValueOnce([
        {
          NZBID: 11,
          Name: "Finished Game",
          Status: "SUCCESS/ALL",
          FileSizeMB: 20,
          Category: "games",
          DownloadTimeSec: 90,
          ParStatus: "NONE",
          UnpackStatus: "NONE",
          FailedArticles: 0,
          DeleteStatus: "NONE",
          DestDir: "/downloads/nzbget/Questarr/Finished Game",
        },
      ]) // getFromHistory
      .mockRejectedValueOnce(new Error("history failed")); // getHistoryDestDir

    const details = await client.getDownloadDetails("11");
    expect(details).toMatchObject({ status: "completed" });
    expect(details?.downloadDir).toBeUndefined();
  });
});
