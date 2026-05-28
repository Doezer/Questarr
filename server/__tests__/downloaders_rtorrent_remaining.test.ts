import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";

const fetchMock = vi.fn();
const parseTorrentMock = vi.fn();
const fetchWithMagnetDetectionMock = vi.fn();

vi.mock("parse-torrent", () => ({
  default: parseTorrentMock,
}));

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
}));

vi.mock("../downloaders/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../downloaders/utils.js")>();
  return {
    ...actual,
    fetchWithMagnetDetection: fetchWithMagnetDetectionMock,
  };
});

global.fetch = fetchMock as unknown as typeof fetch;

const { isSafeUrl } = await import("../ssrf.js");
const { RTorrentClient } = await import("../downloaders/rtorrent.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "rtorrent-coverage",
    name: "rTorrent",
    type: "rtorrent",
    url: "http://rtorrent.local/base",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: "RPC2",
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

const xmlRpcString = (value: string) => `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param><value><string>${value}</string></value></param>
  </params>
</methodResponse>`;

describe("rtorrent remaining regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    parseTorrentMock.mockReset();
    fetchWithMagnetDetectionMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("covers addDownload retry, raw upload, stopped mode, and addDownload error handling", async () => {
    const client = new RTorrentClient(
      createDownloader({ category: "games", downloadPath: "/downloads" })
    );
    const privateClient = client as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    fetchWithMagnetDetectionMock
      .mockResolvedValueOnce({
        response: {
          ok: false,
          status: 400,
          statusText: "Bad Request",
        } as Response,
      })
      .mockResolvedValueOnce({
        response: {
          ok: true,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        } as Response,
      });
    parseTorrentMock.mockResolvedValueOnce({
      infoHash: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });
    rpcSpy.mockResolvedValueOnce(0);

    await expect(
      client.addDownload({
        url: "http://indexer.local/game.torrent&file=Questarr",
        title: "Questarr",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });
    expect(fetchWithMagnetDetectionMock).toHaveBeenNthCalledWith(
      2,
      "http://indexer.local/game.torrent"
    );
    expect(rpcSpy).toHaveBeenLastCalledWith("load.raw_start", [
      "",
      Buffer.from([1, 2, 3]),
      "d.custom1.set=games",
      "d.directory.set=/downloads",
    ]);

    rpcSpy.mockResolvedValueOnce(0);
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Direct magnet",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    rpcSpy.mockResolvedValueOnce(7);
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Failed magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download (rTorrent returned code: 7)",
    });

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      magnetLink: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
    });
    rpcSpy.mockResolvedValueOnce(0);
    await expect(
      client.addDownload({
        url: "http://indexer.local/redirected.torrent",
        title: "Redirected",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      } as Response,
    });
    await expect(
      client.addDownload({
        url: "http://indexer.local/bad.torrent",
        title: "Bad indexer",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to download file from indexer: Service Unavailable",
    });

    const stoppedClient = new RTorrentClient(
      createDownloader({ addStopped: true, category: "stopped-games", downloadPath: "/stopped" })
    );
    const stoppedPrivate = stoppedClient as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };
    const stoppedRpcSpy = vi.spyOn(stoppedPrivate, "makeXMLRPCRequest");
    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer,
      } as Response,
    });
    parseTorrentMock.mockRejectedValueOnce(new Error("parse failed"));
    stoppedRpcSpy.mockResolvedValueOnce(0);

    await expect(
      stoppedClient.addDownload({
        url: "http://indexer.local/stopped.torrent",
        title: "Stopped Questarr",
      })
    ).resolves.toEqual({
      success: true,
      id: "unknown",
      message: "Download added successfully (stopped)",
    });
    expect(stoppedRpcSpy).toHaveBeenLastCalledWith("load.raw", [
      "",
      Buffer.from([4, 5, 6]),
      "d.custom1.set=stopped-games",
      "d.directory.set=/stopped",
    ]);

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        arrayBuffer: async () => Uint8Array.from([7, 8, 9]).buffer,
      } as Response,
    });
    parseTorrentMock.mockResolvedValueOnce({});
    rpcSpy.mockResolvedValueOnce(5);
    await expect(
      client.addDownload({
        url: "http://indexer.local/fail-code.torrent",
        title: "Fail code",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download (rTorrent returned code: 5)",
    });

    rpcSpy.mockRejectedValueOnce("boom");
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Boom magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download: Unknown error",
    });
  });

  it("covers status, details, list, control, and free-space branches", async () => {
    const client = new RTorrentClient(createDownloader());
    const privateClient = client as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
      mapRTorrentStatus(torrent: unknown[]): Record<string, unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    rpcSpy.mockResolvedValueOnce([
      ["ABCDEF", "Questarr", 1, 0, 100, 50, 10, 5, 500, 7, 3, "", "games"],
      ["other", "Other", 0, 1, 100, 100, 0, 0, 1000, 2, 1, "", ""],
    ]);
    await expect(client.getDownloadStatus("abcdef")).resolves.toMatchObject({
      status: "downloading",
      progress: 50,
    });

    rpcSpy.mockResolvedValueOnce([["other", "Other", 0, 1, 100, 100, 0, 0, 1000, 2, 1, "", ""]]);
    await expect(client.getDownloadStatus("missing")).resolves.toBeNull();

    rpcSpy.mockRejectedValueOnce(new Error("status failed"));
    await expect(client.getDownloadStatus("broken")).resolves.toBeNull();

    rpcSpy
      .mockResolvedValueOnce("hash-1")
      .mockResolvedValueOnce("Questarr Details")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(200)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(1500)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce("tracker issue")
      .mockResolvedValueOnce("/downloads/questarr")
      .mockResolvedValueOnce(1704067200)
      .mockResolvedValueOnce([
        ["off.bin", 10, 0, 10, 0],
        ["normal.bin", 20, 10, 10, 1],
        ["high.bin", 30, 15, 15, 2],
      ])
      .mockResolvedValueOnce([
        ["udp://inactive", 0, 0, -1, -1],
        ["udp://updating", 1, 1, 5, 6, 0, 9, ""],
        ["udp://working", 2, 1, 7, 8, 9, 10, ""],
        ["udp://error", 3, 1, 1, 2, 9, 10, "boom"],
      ]);

    await expect(client.getDownloadDetails("hash-1")).resolves.toMatchObject({
      status: "error",
      progress: 50,
      ratio: 1.5,
      addedDate: "2024-01-01T00:00:00.000Z",
      files: [
        expect.objectContaining({ priority: "off", wanted: false, progress: 0 }),
        expect.objectContaining({ priority: "normal", wanted: true, progress: 100 }),
        expect.objectContaining({ priority: "high", wanted: true, progress: 100 }),
      ],
      trackers: [
        expect.objectContaining({ status: "inactive", seeders: undefined }),
        expect.objectContaining({ status: "updating" }),
        expect.objectContaining({ status: "working" }),
        expect.objectContaining({ status: "error", error: "boom" }),
      ],
    });

    rpcSpy
      .mockResolvedValueOnce("hash-completed")
      .mockResolvedValueOnce("Completed Details")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("/downloads/completed")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(client.getDownloadDetails("hash-completed")).resolves.toMatchObject({
      status: "completed",
    });

    rpcSpy.mockRejectedValueOnce(new Error("details failed"));
    await expect(client.getDownloadDetails("broken")).resolves.toBeNull();

    rpcSpy.mockResolvedValueOnce([
      ["hash-seed", "Seeding", 1, 1, 100, 100, 0, 10, 1000, 4, 2, "", "games"],
      ["hash-pause", "Paused", 0, 0, 100, 25, 0, 0, 0, 1, 0, "", ""],
    ]);
    await expect(client.getAllDownloads()).resolves.toEqual([
      expect.objectContaining({ status: "seeding" }),
      expect.objectContaining({ status: "paused" }),
    ]);

    rpcSpy.mockResolvedValueOnce(null);
    await expect(client.getAllDownloads()).resolves.toEqual([]);

    rpcSpy.mockResolvedValueOnce(0);
    await expect(client.pauseDownload("hash-pause")).resolves.toEqual({
      success: true,
      message: "Download paused successfully",
    });

    rpcSpy.mockRejectedValueOnce(new Error("pause failed"));
    await expect(client.pauseDownload("hash-pause")).resolves.toEqual({
      success: false,
      message: "Failed to pause download: pause failed",
    });

    rpcSpy.mockResolvedValueOnce(0);
    await expect(client.resumeDownload("hash-pause")).resolves.toEqual({
      success: true,
      message: "Download resumed successfully",
    });

    rpcSpy.mockRejectedValueOnce(new Error("resume failed"));
    await expect(client.resumeDownload("hash-pause")).resolves.toEqual({
      success: false,
      message: "Failed to resume download: resume failed",
    });

    rpcSpy.mockResolvedValueOnce(0);
    await expect(client.removeDownload("hash-remove", false)).resolves.toEqual({
      success: true,
      message: "Download removed successfully",
    });

    rpcSpy.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(client.removeDownload("hash-remove", true)).resolves.toEqual({
      success: true,
      message: "Download removed successfully",
    });

    rpcSpy.mockRejectedValueOnce(new Error("remove failed"));
    await expect(client.removeDownload("hash-remove", false)).resolves.toEqual({
      success: false,
      message: "Failed to remove download: remove failed",
    });

    rpcSpy.mockResolvedValueOnce("/downloads").mockResolvedValueOnce("12345");
    await expect(client.getFreeSpace()).resolves.toBe(12345);

    rpcSpy.mockResolvedValueOnce("/downloads").mockResolvedValueOnce("not-a-number");
    await expect(client.getFreeSpace()).resolves.toBe(0);

    rpcSpy.mockRejectedValueOnce(new Error("df failed"));
    await expect(client.getFreeSpace()).resolves.toBe(0);

    expect(
      privateClient.mapRTorrentStatus([
        "hash-force",
        "Forced",
        1,
        0,
        100,
        100,
        0,
        0,
        0,
        3,
        1,
        "",
        "",
      ])
    ).toEqual(expect.objectContaining({ status: "seeding" }));
    expect(
      privateClient.mapRTorrentStatus([
        "hash-error",
        "Errored",
        1,
        0,
        100,
        50,
        0,
        0,
        0,
        1,
        0,
        "boom",
        "",
      ])
    ).toEqual(expect.objectContaining({ status: "error", error: "boom" }));
    expect(
      privateClient.mapRTorrentStatus([
        "hash-complete-regular",
        "Complete regular",
        0,
        1,
        100,
        100,
        0,
        0,
        0,
        3,
        1,
        "",
        "",
      ])
    ).toEqual(expect.objectContaining({ status: "completed" }));
    expect(
      privateClient.mapRTorrentStatus([
        "hash-complete",
        "Complete",
        0,
        0,
        100,
        100,
        0,
        0,
        0,
        3,
        1,
        "",
        "",
      ])
    ).toEqual(expect.objectContaining({ status: "completed" }));
    expect(
      privateClient.mapRTorrentStatus(["hash-zero", "Zero", 0, 0, 0, 0, 0, 0, 0, 0, 0, "", ""])
    ).toEqual(expect.objectContaining({ progress: 0, status: "paused" }));
  });

  it("covers XML-RPC helpers and parsing edge cases", () => {
    const client = new RTorrentClient(createDownloader()) as unknown as {
      computeDigestHeader(
        method: string,
        uri: string,
        authHeader: string,
        username: string,
        password: string
      ): string;
      parseXMLRPCResponse(xml: string): unknown;
      parseXMLValueObj(value: unknown): unknown;
      escapeXml(value: string): string;
    };

    const randomBytesSpy = vi
      .spyOn(crypto, "randomBytes")
      .mockReturnValue(Buffer.from("1234567890abcdef", "hex"));

    expect(
      client.computeDigestHeader(
        "POST",
        "/RPC2",
        'Digest realm="rtorrent", nonce="abc", qop="auth", opaque="xyz"',
        "user",
        "pass"
      )
    ).toContain("qop=auth");

    expect(
      client.computeDigestHeader(
        "POST",
        "/RPC2",
        'Digest realm="rtorrent", nonce="abc"',
        "user",
        "pass"
      )
    ).not.toContain("qop=");

    expect(client.parseXMLRPCResponse(xmlRpcString("hello"))).toBe("hello");
    expect(
      client.parseXMLRPCResponse(`<?xml version="1.0"?><methodResponse></methodResponse>`)
    ).toBeNull();
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

    expect(client.parseXMLValueObj("plain")).toBe("plain");
    expect(client.parseXMLValueObj([{ boolean: { _text: "1" } }])).toBe(true);
    expect(client.parseXMLValueObj({ string: { _text: "s" } })).toBe("s");
    expect(client.parseXMLValueObj({ int: { _text: "2" } })).toBe(2);
    expect(client.parseXMLValueObj({ i4: { _text: "3" } })).toBe(3);
    expect(client.parseXMLValueObj({ i8: { _text: "4" } })).toBe(4);
    expect(client.parseXMLValueObj({ double: { _text: "1.5" } })).toBe(1.5);
    expect(client.parseXMLValueObj({ boolean: { _text: "0" } })).toBe(false);
    expect(client.parseXMLValueObj({ base64: { _text: "YWJj" } })).toBe("YWJj");
    expect(client.parseXMLValueObj({ array: { data: [] } })).toEqual([]);
    expect(client.parseXMLValueObj({ array: { data: [{}] } })).toEqual([]);
    expect(
      client.parseXMLValueObj({
        array: {
          data: [{ value: [{ string: { _text: "one" } }, { int: { _text: "2" } }] }],
        },
      })
    ).toEqual(["one", 2]);
    expect(client.parseXMLValueObj({ struct: {} })).toEqual({});
    expect(
      client.parseXMLValueObj({
        struct: {
          member: [
            { name: { _text: "a" }, value: { string: { _text: "b" } } },
            { name: { _text: "n" }, value: { int: { _text: "5" } } },
          ],
        },
      })
    ).toEqual({ a: "b", n: 5 });
    expect(client.parseXMLValueObj([5])).toBe(5);
    expect(client.parseXMLValueObj({ array: {} })).toEqual([]);
    expect(client.parseXMLValueObj({ unsupported: true })).toBeNull();
    expect(client.escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");

    randomBytesSpy.mockRestore();
  });

  it("covers testConnection, early addDownload guards, makeXMLRPCRequest success, auth, and HTTP failures", async () => {
    const randomBytesSpy = vi
      .spyOn(crypto, "randomBytes")
      .mockReturnValue(Buffer.from("1234567890abcdef", "hex"));

    const connectionClient = new RTorrentClient(createDownloader());
    const connectionPrivate = connectionClient as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };
    const connectionSpy = vi.spyOn(connectionPrivate, "makeXMLRPCRequest");
    connectionSpy.mockResolvedValueOnce("0.9.8");
    await expect(connectionClient.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected to rTorrent v0.9.8",
    });
    connectionSpy.mockRejectedValueOnce(new Error("Authentication failed: denied"));
    await expect(connectionClient.testConnection()).resolves.toEqual({
      success: false,
      message: "Authentication failed: denied",
    });
    connectionSpy.mockRejectedValueOnce(new Error("rpc down"));
    await expect(connectionClient.testConnection()).resolves.toEqual({
      success: false,
      message: "Failed to connect to rTorrent: rpc down",
    });

    await expect(connectionClient.addDownload({ url: "", title: "No URL" })).resolves.toEqual({
      success: false,
      message: "Download URL is required",
    });
    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      connectionClient.addDownload({ url: "http://unsafe.local/file.torrent", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.torrent",
    });

    const successClient = new RTorrentClient(
      createDownloader({
        url: "http://:8080",
        port: 9091,
        urlPath: "/RPC2",
      })
    ) as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlRpcString("ok"),
    } as Response);
    await expect(
      successClient.makeXMLRPCRequest("system.client_version", [
        Buffer.from("abc"),
        1,
        { foo: "bar" },
      ])
    ).resolves.toBe("ok");
    expect(fetchMock.mock.calls[0][0]).toBe("http://http:9091//:8080/RPC2");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: expect.stringContaining("Basic "),
      }),
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toContain("<base64>YWJj</base64>");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toContain(
      "<string>[object Object]</string>"
    );

    const protocolClient = new RTorrentClient(
      createDownloader({
        url: "rt.local/base/",
        useSsl: true,
        port: 5000,
        urlPath: "RPC2",
      })
    ) as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlRpcString("ssl-ok"),
    } as Response);
    await expect(protocolClient.makeXMLRPCRequest("system.client_version", [])).resolves.toBe(
      "ssl-ok"
    );
    expect(fetchMock.mock.calls[1][0]).toBe("https://rt.local:5000/base/RPC2");

    const digestClient = new RTorrentClient(createDownloader()) as unknown as {
      makeXMLRPCRequest(method: string, params: unknown[]): Promise<unknown>;
    };
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
        text: async () => xmlRpcString("1.2.3"),
      } as Response);
    await expect(digestClient.makeXMLRPCRequest("system.client_version", ["a"])).resolves.toBe(
      "1.2.3"
    );
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toMatchObject({
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
        text: async () => {
          throw new Error("still bad");
        },
      } as Response);
    await expect(digestClient.makeXMLRPCRequest("system.client_version", ["a"])).rejects.toThrow(
      "Digest Auth Error: Digest Authentication failed (wrong credentials, or server may have switched to HTTPS)"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "auth needed",
      headers: { get: () => null },
    } as Response);
    await expect(digestClient.makeXMLRPCRequest("system.client_version", ["a"])).rejects.toThrow(
      "Authentication failed: Invalid credentials or web server authentication not configured for rTorrent - auth needed"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => {
        throw new Error("boom");
      },
      headers: { get: () => null },
    } as Response);
    await expect(digestClient.makeXMLRPCRequest("system.client_version", ["a"])).rejects.toThrow(
      "HTTP 500: Server Error - No error details available"
    );

    randomBytesSpy.mockRestore();
  });
});
