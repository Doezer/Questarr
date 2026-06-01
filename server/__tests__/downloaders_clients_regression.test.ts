import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Downloader } from "../../shared/schema.js";
import { NZBGetClient } from "../downloaders/nzbget.js";
import { QBittorrentClient } from "../downloaders/qbittorrent.js";
import { RTorrentClient } from "../downloaders/rtorrent.js";
import { SABnzbdClient } from "../downloaders/sabnzbd.js";
import { SynologyDownloadStationClient } from "../downloaders/synology.js";
import { TransmissionClient } from "../downloaders/transmission.js";
import { isSafeUrl, safeFetch } from "../ssrf.js";

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
  safeFetch: vi.fn((url: string, options?: RequestInit) => global.fetch(url, options)),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const xmlScalar = (tag: string, value: string | number) => `<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><${tag}>${value}</${tag}></value>
    </param>
  </params>
</methodResponse>`;

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

describe("downloader client regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("maps Transmission download details and uses UTF-8 basic auth", async () => {
    const client = new TransmissionClient(
      createDownloader({
        type: "transmission",
        url: "transmission.local",
        username: "usér",
        password: "päss",
      })
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: "success",
        arguments: {
          torrents: [
            {
              id: 7,
              hashString: "hash-7",
              name: "Test Torrent",
              status: 4,
              percentDone: 0.5,
              rateDownload: 10,
              rateUpload: 5,
              eta: 42,
              totalSize: 100,
              downloadedEver: 50,
              peersSendingToUs: 4,
              peersGettingFromUs: 3,
              uploadRatio: 1.5,
              addedDate: 1710000000,
              doneDate: 1710000300,
              downloadDir: "/downloads",
              comment: "comment",
              creator: "Questarr",
              peersConnected: 7,
              files: [
                { name: "off.bin", length: 10, bytesCompleted: 0 },
                { name: "low.bin", length: 10, bytesCompleted: 5 },
                { name: "high.bin", length: 10, bytesCompleted: 10 },
              ],
              fileStats: [
                { bytesCompleted: 0, wanted: false, priority: 0 },
                { bytesCompleted: 5, wanted: true, priority: -1 },
                { bytesCompleted: 10, wanted: true, priority: 1 },
              ],
              trackerStats: [
                {
                  announce: "https://ok.tracker",
                  tier: 0,
                  lastAnnounceSucceeded: true,
                  isBackup: false,
                  lastAnnounceResult: "Success",
                  announceState: 3,
                  seederCount: 10,
                  leecherCount: 2,
                  lastAnnounceTime: 1710000000,
                  nextAnnounceTime: 1710000600,
                },
                {
                  announce: "https://error.tracker",
                  tier: 1,
                  lastAnnounceSucceeded: false,
                  isBackup: false,
                  lastAnnounceResult: "Timeout",
                  announceState: 0,
                  seederCount: -1,
                  leecherCount: -1,
                  lastAnnounceTime: 0,
                },
                {
                  announce: "https://wait.tracker",
                  tier: 2,
                  lastAnnounceSucceeded: false,
                  isBackup: false,
                  lastAnnounceResult: "",
                  announceState: 1,
                  seederCount: 1,
                  leecherCount: 2,
                  lastAnnounceTime: 0,
                },
              ],
            },
          ],
        },
      }),
    });

    const details = await client.getDownloadDetails("7");

    expect(details?.hash).toBe("hash-7");
    expect(details?.files.map((file) => file.priority)).toEqual(["off", "low", "high"]);
    expect(details?.trackers.map((tracker) => tracker.status)).toEqual([
      "working",
      "error",
      "updating",
    ]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("usér:päss", "utf-8").toString("base64")}`,
    });
  });

  it("covers Transmission pause, resume, remove, and free-space RPC methods", async () => {
    const client = new TransmissionClient(createDownloader({ type: "transmission" }));

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "success", arguments: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "success", arguments: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "success", arguments: {} }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "success", arguments: { "download-dir": "/data" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "success", arguments: { "size-bytes": 4096 } }),
      });

    await expect(client.pauseDownload("1")).resolves.toMatchObject({ success: true });
    await expect(client.resumeDownload("2")).resolves.toMatchObject({ success: true });
    await expect(client.removeDownload("3", true)).resolves.toMatchObject({ success: true });
    await expect(client.getFreeSpace()).resolves.toBe(4096);

    const methods = fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).method
    );
    expect(methods).toEqual([
      "torrent-stop",
      "torrent-start",
      "torrent-remove",
      "session-get",
      "free-space",
    ]);
  });

  it("reuses qBittorrent's exact SID cookie name and maps rich details", async () => {
    const client = new QBittorrentClient(
      createDownloader({
        type: "qbittorrent",
        url: "http://qb.local:8080",
        username: "admin",
        password: "password",
      })
    );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "Ok.",
        headers: {
          get: () => null,
          getSetCookie: () => ["QBT_SID_custom=cookie123; Path=/; HttpOnly"],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            hash: "hash123",
            name: "Torrent",
            state: "pausedDL",
            progress: 1,
            dlspeed: 0,
            upspeed: 0,
            eta: 8640001,
            size: 100,
            downloaded: 100,
            ratio: 2,
            num_seeds: 4,
            num_leechs: 2,
            num_complete: 5,
            num_incomplete: 3,
            save_path: "/downloads",
            category: "games",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ addition_date: 1710000000, completion_date: 1710001000, peers: 4 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "file1.bin", size: 10, progress: 1, priority: 0 },
          { name: "file2.bin", size: 10, progress: 0.5, priority: 6 },
          { name: "file3.bin", size: 10, progress: 0.25, priority: 1 },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { url: "** [DHT] **", status: 2, tier: 0 },
          { url: "https://ok.tracker", status: 2, tier: 1, num_seeds: 5, num_leeches: 1, msg: "" },
          {
            url: "https://bad.tracker",
            status: 3,
            tier: 2,
            num_seeds: -1,
            num_leeches: -1,
            msg: "tracker error",
          },
        ],
      });

    const details = await client.getDownloadDetails("hash123");

    expect(details?.status).toBe("completed");
    expect(details?.eta).toBeUndefined();
    expect(details?.files.map((file) => file.priority)).toEqual(["off", "high", "normal"]);
    expect(details?.trackers.map((tracker) => tracker.url)).toEqual([
      "https://ok.tracker",
      "https://bad.tracker",
    ]);
    expect(
      fetchMock.mock.calls
        .slice(1)
        .every(
          (call) =>
            ((call[1] as RequestInit).headers as Record<string, string>).Cookie ===
            "QBT_SID_custom=cookie123"
        )
    ).toBe(true);
  });

  it("falls back through qBittorrent free-space endpoints until one returns bytes", async () => {
    const client = new QBittorrentClient(
      createDownloader({
        type: "qbittorrent",
        url: "http://qb.local:8080",
        username: "admin",
        password: "password",
      })
    );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "Ok.",
        headers: { get: () => "SID=abc", getSetCookie: () => [] },
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ save_path: "/downloads" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ free_space_on_disk: "not-a-number" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ server_state: { free_space_on_disk: 123456 } }),
      });

    await expect(client.getFreeSpace()).resolves.toBe(123456);
  });

  it("uses positional shell arguments for rTorrent free-space lookup and deletes files safely", async () => {
    const client = new RTorrentClient(
      createDownloader({
        type: "rtorrent",
        url: "rtorrent.local",
        username: "usér",
        password: "päss",
      })
    );

    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => xmlScalar("string", "/srv/downloads") })
      .mockResolvedValueOnce({ ok: true, text: async () => xmlScalar("string", "4096") })
      .mockResolvedValueOnce({ ok: true, text: async () => xmlScalar("int", 0) })
      .mockResolvedValueOnce({ ok: true, text: async () => xmlScalar("int", 0) })
      .mockResolvedValueOnce({ ok: true, text: async () => xmlScalar("int", 0) });

    await expect(client.getFreeSpace()).resolves.toBe(4096);
    await expect(client.removeDownload("hash123", true)).resolves.toMatchObject({ success: true });

    const freeSpaceBody = (fetchMock.mock.calls[1][1] as RequestInit).body as string;
    expect(freeSpaceBody).toContain("df --output=avail -B1 &quot;$1&quot; | tail -1");
    expect(freeSpaceBody).toContain("<string>/srv/downloads</string>");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("usér:päss", "utf-8").toString("base64")}`,
    });

    const deleteBodies = fetchMock.mock.calls.slice(2).map((call) => (call[1] as RequestInit).body);
    expect(deleteBodies.join("")).toContain("d.stop");
    expect(deleteBodies.join("")).toContain("d.delete_tied");
    expect(deleteBodies.join("")).toContain("d.erase");
  });

  it("maps SABnzbd queue status and action endpoints", async () => {
    const client = new SABnzbdClient(createDownloader({ type: "sabnzbd", username: "api-key" }));
    const fetchWithFallbackSpy = vi.spyOn(
      client as unknown as {
        fetchWithFallback: (url: string, options?: RequestInit) => Promise<Response>;
      },
      "fetchWithFallback"
    );

    fetchWithFallbackSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "nzo-1",
                filename: "Game",
                status: "Repairing",
                percentage: "25",
                mb: "100",
                mbleft: "75",
                timeleft: "01:02:03",
                cat: "games",
                avg_age: "2.5",
              },
              {},
            ],
            speed: "1.5",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queue: { diskspace1: "1.5" } }),
      } as Response);

    const status = await client.getDownloadStatus("nzo-1");
    expect(status).toMatchObject({
      status: "repairing",
      repairStatus: "repairing",
      eta: 3723,
    });
    await expect(client.pauseDownload("nzo-1")).resolves.toMatchObject({ success: true });
    await expect(client.resumeDownload("nzo-1")).resolves.toMatchObject({ success: true });
    await expect(client.removeDownload("nzo-1")).resolves.toMatchObject({ success: true });
    await expect(client.getFreeSpace()).resolves.toBe(1610612736);
  });

  it("maps NZBGet queue status and control actions", async () => {
    const client = new NZBGetClient(createDownloader({ type: "nzbget" }));
    const rpcSpy = vi.spyOn(
      client as unknown as {
        makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
      },
      "makeXMLRPCRequest"
    );

    rpcSpy
      .mockResolvedValueOnce([
        {
          NZBID: 42,
          NZBName: "Game",
          Status: "POST_PROCESSING",
          FileSizeMB: 100,
          RemainingSizeMB: 50,
          DownloadedSizeMB: 50,
          Category: "games",
          DownloadRate: 1024,
          PostInfoText: "Unpacking",
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ FreeDiskSpaceMB: 2 });

    const status = await client.getDownloadStatus("42");
    expect(status).toMatchObject({
      status: "unpacking",
      unpackStatus: "unpacking",
      progress: 50,
    });
    await expect(client.pauseDownload("42")).resolves.toMatchObject({ success: true });
    await expect(client.resumeDownload("42")).resolves.toMatchObject({ success: true });
    await expect(client.removeDownload("42")).resolves.toMatchObject({ success: true });
    await expect(client.getFreeSpace()).resolves.toBe(2097152);
  });

  it("uploads fetched files to Synology Download Station and falls back free-space parsing", async () => {
    const client = new SynologyDownloadStationClient(
      createDownloader({
        type: "synology",
        url: "http://nas.local:5000",
        username: "admin",
        password: "password",
        downloadPath: "/volume1/downloads",
      })
    );
    (
      client as unknown as {
        apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }>;
      }
    ).apiInfo = {
      "SYNO.FileStation.Info": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
    };

    vi.spyOn(
      client as unknown as {
        ensureApiInfo: () => Promise<void>;
      },
      "ensureApiInfo"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      client as unknown as {
        getTaskApiDescriptor: () => { apiName: string; descriptor: { path: string } };
      },
      "getTaskApiDescriptor"
    ).mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
      descriptor: { path: "entry.cgi" },
    });
    const requestTaskApiSpy = vi.spyOn(
      client as unknown as {
        requestTaskApi: (
          methodName: string,
          options?: {
            httpMethod?: "GET" | "POST";
            params?: Record<string, string | number | boolean | undefined>;
            body?: URLSearchParams | FormData;
          }
        ) => Promise<{ success: boolean; data?: { task_id?: string[] } }>;
      },
      "requestTaskApi"
    );
    requestTaskApiSpy.mockResolvedValue({
      success: true,
      data: { task_id: ["dbid_1"] },
    });
    vi.spyOn(
      client as unknown as {
        requestApi: (
          apiName: string,
          descriptor: { path: string; minVersion: number; maxVersion: number },
          preferredVersion: number,
          methodName: string
        ) => Promise<{
          success: boolean;
          data?: { useable_space?: number; volume_status?: Array<{ free?: number }> };
        }>;
      },
      "requestApi"
    ).mockResolvedValue({
      success: true,
      data: { volume_status: [{ free: 8192 }] },
    });

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-disposition"
            ? `attachment; filename*=UTF-8''Questarr%20Game.torrent`
            : name.toLowerCase() === "content-type"
              ? "application/x-bittorrent"
              : null,
      },
      arrayBuffer: async () => new TextEncoder().encode("torrent-data").buffer,
    } as Response);

    const result = await client.addDownload({
      url: "http://indexer.local/game.torrent",
      title: "Questarr Game",
      downloadType: "torrent",
    });
    const uploadOptions = requestTaskApiSpy.mock.calls[0]?.[1];
    const uploadBody = uploadOptions?.body as FormData;

    expect(result).toMatchObject({ success: true, id: "dbid_1" });
    expect(uploadBody.get("destination")).toBe("/volume1/downloads");
    expect(uploadOptions?.httpMethod).toBe("POST");

    await expect(client.getFreeSpace()).resolves.toBe(8192);
    expect(safeFetch).toHaveBeenCalled();
  });

  it("fetches a missing Transmission hashString and falls back to the numeric id when that lookup fails", async () => {
    const client = new TransmissionClient(createDownloader({ type: "transmission" }));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            "torrent-added": {
              id: 77,
              name: "No Hash Yet",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            torrents: [{ hashString: "hash-from-details" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: "success",
          arguments: {
            "torrent-added": {
              id: 88,
              name: "Still No Hash",
            },
          },
        }),
      })
      .mockRejectedValueOnce(new Error("lookup failed"));

    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "No Hash Yet",
      })
    ).resolves.toMatchObject({ success: true, id: "hash-from-details" });

    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef13",
        title: "Still No Hash",
      })
    ).resolves.toMatchObject({ success: true, id: "88" });
  });

  it("covers SABnzbd status variants, details, listing and control failures", async () => {
    const client = new SABnzbdClient(
      createDownloader({ type: "sabnzbd", username: "api-key", category: "games" })
    );
    const fetchWithFallbackSpy = vi.spyOn(
      client as unknown as {
        fetchWithFallback: (url: string, options?: RequestInit) => Promise<Response>;
      },
      "fetchWithFallback"
    );

    fetchWithFallbackSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
              {
                nzo_id: "sab-2",
                filename: "Done Game",
                status: "Completed",
                percentage: "100",
                mb: "12",
                mbleft: "0",
                timeleft: "0:00:00",
                cat: "games",
                avg_age: "4.5",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
              {
                nzo_id: "sab-2",
                filename: "Done Game",
                status: "Completed",
                percentage: "100",
                mb: "12",
                mbleft: "0",
                timeleft: "0:00:00",
                cat: "games",
                avg_age: "4.5",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          queue: {
            slots: [
              {
                nzo_id: "sab-1",
                filename: "Packed Game",
                status: "Unpacking",
                percentage: "100",
                mb: "10",
                mbleft: "0",
                timeleft: "unknown",
                cat: "games",
                avg_age: "1",
              },
            ],
            speed: "0",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: false }) } as Response)
      .mockRejectedValueOnce(new Error("resume boom"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: false }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queue: { diskspace1: "NaN" } }),
      } as Response)
      .mockRejectedValueOnce(new Error("queue boom"));

    await expect(client.getDownloadStatus("sab-1")).resolves.toMatchObject({
      status: "unpacking",
      unpackStatus: "unpacking",
      eta: undefined,
    });
    await expect(client.getDownloadStatus("sab-2")).resolves.toBeNull();
    await expect(client.getDownloadDetails("sab-1")).resolves.toMatchObject({
      id: "sab-1",
      files: [],
      trackers: [],
    });
    await expect(client.getAllDownloads()).resolves.toHaveLength(1);
    await expect(client.pauseDownload("sab-1")).resolves.toEqual({
      success: false,
      message: "Failed to pause NZB",
    });
    await expect(client.resumeDownload("sab-1")).resolves.toEqual({
      success: false,
      message: "Failed to resume NZB",
    });
    await expect(client.removeDownload("sab-1")).resolves.toMatchObject({ success: false });
    await expect(client.getFreeSpace()).resolves.toBe(0);
    await expect(client.getAllDownloads()).resolves.toEqual([]);
  });

  it("maps completed SABnzbd queue entries and handles control failures with a fresh client", async () => {
    const client = new SABnzbdClient(createDownloader({ type: "sabnzbd", username: "api-key" }));
    const fetchWithFallbackSpy = vi.spyOn(
      client as unknown as {
        fetchWithFallback: (url: string, options?: RequestInit) => Promise<Response>;
      },
      "fetchWithFallback"
    );

    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        queue: {
          slots: [
            {
              nzo_id: "sab-done",
              filename: "Done Game",
              status: "Completed",
              percentage: "100",
              mb: "12",
              mbleft: "0",
              timeleft: "0:00:00",
              cat: "games",
              avg_age: "4.5",
            },
          ],
          speed: "0",
        },
      }),
    } as Response);

    await expect(client.getDownloadStatus("sab-done")).resolves.toMatchObject({
      status: "completed",
      repairStatus: "good",
      unpackStatus: "completed",
      age: 4.5,
    });

    fetchWithFallbackSpy.mockReset();
    fetchWithFallbackSpy
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: false }) } as Response)
      .mockRejectedValueOnce(new Error("resume boom"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: false }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queue: { diskspace1: "NaN" } }),
      } as Response);

    await expect(client.pauseDownload("sab-done")).resolves.toEqual({
      success: false,
      message: "Failed to pause NZB",
    });
    await expect(client.resumeDownload("sab-done")).resolves.toEqual({
      success: false,
      message: "resume boom",
    });
    await expect(client.removeDownload("sab-done")).resolves.toEqual({
      success: false,
      message: "Failed to remove NZB",
    });
    await expect(client.getFreeSpace()).resolves.toBe(0);
  });

  it("covers NZBGet XML helpers, history mapping and failure paths", async () => {
    const client = new NZBGetClient(
      createDownloader({
        type: "nzbget",
        url: "nzbget.local/",
        username: "usér",
        password: "päss",
        useSsl: true,
        port: 6789,
      })
    );
    const privateClient = client as unknown as {
      getBaseUrl: () => string;
      escapeXml: (value: string) => string;
      buildXMLValue: (value: unknown) => string;
      parseValueObj: (value: unknown) => unknown;
      makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
    };

    expect(privateClient.getBaseUrl()).toBe("https://nzbget.local:6789");
    expect(privateClient.escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
    expect(privateClient.buildXMLValue({ ok: true, score: 1.5, list: [1, "two"] })).toContain(
      "<struct>"
    );
    expect(
      privateClient.parseValueObj({
        struct: {
          member: [
            { name: { _text: "flag" }, value: { boolean: { _text: "1" } } },
            { name: { _text: "count" }, value: { int: { _text: "2" } } },
            {
              name: { _text: "items" },
              value: {
                array: {
                  data: [
                    {
                      value: [{ string: { _text: "one" } }, { double: { _text: "2.5" } }],
                    },
                  ],
                },
              },
            },
          ],
        },
      })
    ).toEqual({
      flag: true,
      count: 2,
      items: ["one", 2.5],
    });

    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");
    rpcSpy
      .mockRejectedValueOnce(new Error("version boom"))
      .mockResolvedValueOnce([
        {
          NZBID: 10,
          NZBName: "Paused Game",
          Status: "PAUSED",
          FileSizeMB: 100,
          RemainingSizeMB: 25,
          DownloadedSizeMB: 75,
          Category: "games",
          DownloadRate: 0,
          PostInfoText: "",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          NZBID: 11,
          Name: "Broken Game",
          Status: "FAILURE/PAR",
          FileSizeMB: 50,
          Category: "games",
          DownloadTimeSec: 120,
          ParStatus: "FAILURE",
          UnpackStatus: "FAILURE",
          FailedArticles: 2,
          DeleteStatus: "NONE",
          DestDir: "/downloads",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          NZBID: 12,
          Name: "Finished Game",
          Status: "SUCCESS/ALL",
          FileSizeMB: 30,
          Category: "games",
          DownloadTimeSec: 60,
          ParStatus: "NONE",
          UnpackStatus: "SUCCESS",
          FailedArticles: 0,
          DeleteStatus: "NONE",
          DestDir: "/downloads",
        },
      ])
      .mockResolvedValueOnce([
        {
          NZBID: 10,
          NZBName: "Paused Game",
          Status: "PAUSED",
          FileSizeMB: 100,
          RemainingSizeMB: 25,
          DownloadedSizeMB: 75,
          Category: "games",
          DownloadRate: 0,
          PostInfoText: "",
        },
      ])
      .mockResolvedValueOnce([{ NZBID: 10 }])
      .mockResolvedValueOnce([
        {
          NZBID: 10,
          NZBName: "Paused Game",
          Status: "PAUSED",
          FileSizeMB: 100,
          RemainingSizeMB: 25,
          DownloadedSizeMB: 75,
          Category: "games",
          DownloadRate: 0,
          PostInfoText: "",
        },
      ])
      .mockRejectedValueOnce(new Error("pause boom"))
      .mockRejectedValueOnce(new Error("resume boom"))
      .mockRejectedValueOnce(new Error("remove boom"))
      .mockRejectedValueOnce(new Error("space boom"));

    await expect(client.testConnection()).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining("Failed to connect to NZBGet at https://nzbget.local:6789"),
    });
    await expect(client.getDownloadStatus("10")).resolves.toMatchObject({
      status: "paused",
      progress: 75,
    });
    await expect(client.getDownloadStatus("11")).resolves.toMatchObject({
      status: "error",
      repairStatus: "failed",
      unpackStatus: "failed",
    });
    await expect(client.getDownloadDetails("12")).resolves.toMatchObject({
      status: "completed",
      files: [],
      trackers: [],
    });
    await expect(client.getAllDownloads()).resolves.toHaveLength(1);
    await expect(client.pauseDownload("10")).resolves.toEqual({
      success: true,
      message: "NZB paused",
    });
    await expect(client.resumeDownload("10")).resolves.toMatchObject({ success: false });
    await expect(client.removeDownload("10")).resolves.toMatchObject({ success: false });
    await expect(client.getFreeSpace()).resolves.toBe(0);
  });

  it("returns NZBGet control failures with explicit error messages", async () => {
    const client = new NZBGetClient(createDownloader({ type: "nzbget" }));
    const rpcSpy = vi.spyOn(
      client as unknown as {
        makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
      },
      "makeXMLRPCRequest"
    );

    rpcSpy
      .mockRejectedValueOnce(new Error("pause boom"))
      .mockRejectedValueOnce(new Error("resume boom"))
      .mockRejectedValueOnce(new Error("remove boom"))
      .mockRejectedValueOnce(new Error("space boom"));

    await expect(client.pauseDownload("10")).resolves.toEqual({
      success: false,
      message: "pause boom",
    });
    await expect(client.resumeDownload("10")).resolves.toEqual({
      success: false,
      message: "resume boom",
    });
    await expect(client.removeDownload("10")).resolves.toEqual({
      success: false,
      message: "remove boom",
    });
    await expect(client.getFreeSpace()).resolves.toBe(0);
  });

  it("covers Synology auth retry, error mappings and missing File Station support", async () => {
    const client = new SynologyDownloadStationClient(
      createDownloader({
        type: "synology",
        url: "nas.local/base",
        urlPath: "/downloads",
        username: "admin",
        password: "password",
      })
    );
    const privateClient = client as unknown as {
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
      getBaseUrlParts: () => { origin: string; prefix: string };
      buildSynologyErrorMessage: (code: number | undefined, fallback: string) => string;
      normalizeSynologyStatus: (status: string | undefined, progress: number) => string;
      mapSynologyFilePriority: (priority: string | number | undefined) => string;
      mapSynologyTrackerStatus: (status: string | undefined, error: string | undefined) => string;
      requestApi: <T>(
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
      ) => Promise<T>;
      fetchJson: <T>(url: string, init: RequestInit, context: string) => Promise<T>;
      authenticate: (force?: boolean) => Promise<void>;
      ensureApiInfo: () => Promise<void>;
    };

    expect(privateClient.getBaseUrlParts()).toEqual({
      origin: "http://nas.local",
      prefix: "/base/downloads",
    });
    expect(privateClient.buildSynologyErrorMessage(401, "fallback")).toBe(
      "Synology maximum task limit reached"
    );
    expect(privateClient.normalizeSynologyStatus("paused", 100)).toBe("completed");
    expect(privateClient.mapSynologyFilePriority("low")).toBe("low");
    expect(privateClient.mapSynologyTrackerStatus("connected", undefined)).toBe("working");
    expect(privateClient.mapSynologyTrackerStatus(undefined, "boom")).toBe("error");

    privateClient.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
      "SYNO.DownloadStation2.Task": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
    };

    const fetchJsonSpy = vi.spyOn(privateClient, "fetchJson");
    const authSpy = vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    fetchJsonSpy
      .mockResolvedValueOnce({ success: false, error: { code: 106 } })
      .mockResolvedValueOnce({ success: true, data: { ok: true } });

    await expect(
      privateClient.requestApi<{ success: boolean; data: { ok: boolean } }>(
        "SYNO.DownloadStation2.Task",
        { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
        2,
        "list",
        { httpMethod: "GET" }
      )
    ).resolves.toMatchObject({ success: true, data: { ok: true } });
    expect(authSpy).toHaveBeenCalledWith(true);

    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    privateClient.apiInfo = {
      "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
    };

    await expect(client.getFreeSpace()).resolves.toBe(0);
    await expect(client.addDownload({ url: "", title: "Missing URL" })).resolves.toEqual({
      success: false,
      message: "Download URL is required",
    });
  });

  it("covers qBittorrent connection and addDownload guard branches", async () => {
    const client = new QBittorrentClient(createDownloader({ type: "qbittorrent" }));
    const privateClient = client as unknown as {
      authenticate: (force?: boolean) => Promise<void>;
      makeRequest: (
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ) => Promise<Response>;
    };

    const authenticateSpy = vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest").mockResolvedValue({
      text: async () => "4.6.5",
    } as Response);

    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected successfully to qBittorrent 4.6.5",
    });

    authenticateSpy.mockRejectedValueOnce(new Error("auth boom"));
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Failed to connect to qBittorrent: auth boom",
    });

    await expect(client.addDownload({ url: "", title: "No URL" })).resolves.toEqual({
      success: false,
      message: "Download URL is required",
    });

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.addDownload({ url: "http://unsafe.local/file.torrent", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.torrent",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy.mockResolvedValueOnce({
      text: async () => "unexpected failure",
      status: 200,
      ok: true,
      headers: {
        entries: () => [][Symbol.iterator](),
      },
    } as Response);

    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Broken magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add magnet link: unexpected failure",
    });
  });

  it("covers qBittorrent URL-add success, duplicate, and force-start branches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const client = new QBittorrentClient(
      createDownloader({
        type: "qbittorrent",
        settings: JSON.stringify({ initialState: "force-started" }),
      })
    );
    const privateClient = client as unknown as {
      authenticate: (force?: boolean) => Promise<void>;
      makeRequest: (
        method: string,
        path: string,
        body?: string | Buffer,
        additionalHeaders?: Record<string, string>
      ) => Promise<Response>;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");
    const emptyHeaders = {
      entries: () => [][Symbol.iterator](),
      get: () => null,
    };

    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Ok.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ hash: "abcdef1234567890abcdef1234567890abcdef12" }],
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    const addedPromise = client.addDownload({
      url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
      title: "Questarr Magnet",
    });
    await vi.runAllTimersAsync();
    await expect(addedPromise).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    makeRequestSpy.mockReset();
    makeRequestSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Fails.",
        headers: emptyHeaders,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: "Questarr Game",
            hash: "recent-hash",
            added_on: Math.floor(Date.now() / 1000) - 1,
          },
        ],
      } as Response);

    const duplicatePromise = client.addDownload({
      url: "http://indexer.local/file.torrent",
      title: "Questarr Game",
    });
    await vi.runAllTimersAsync();
    await expect(duplicatePromise).resolves.toEqual({
      success: true,
      id: "recent-hash",
      message: "Download already exists (qBittorrent)",
    });

    vi.useRealTimers();
  });

  it("covers Transmission connection branches and duplicate magnet adds", async () => {
    const client = new TransmissionClient(createDownloader({ type: "transmission" }));
    const privateClient = client as unknown as {
      makeRequest: (
        method: string,
        args: unknown
      ) => Promise<{
        result?: string;
        arguments: Record<string, unknown>;
      }>;
    };
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    makeRequestSpy.mockResolvedValueOnce({ result: "success", arguments: {} });
    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected successfully to Transmission",
    });

    makeRequestSpy.mockRejectedValueOnce(
      new Error("Authentication failed: Invalid username or password for Transmission - denied")
    );
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Authentication failed: Invalid username or password for Transmission - denied",
    });

    makeRequestSpy.mockRejectedValueOnce(new Error("network boom"));
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Failed to connect to Transmission: network boom",
    });

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.addDownload({ url: "http://unsafe.local/file.torrent", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.torrent",
    });

    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: {
        "torrent-duplicate": {
          hashString: "dup-hash",
          id: 7,
        },
      },
    });
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Duplicate magnet",
      })
    ).resolves.toEqual({
      success: true,
      id: "dup-hash",
      message: "Download already exists (Transmission)",
    });
  });

  it("covers Transmission redirect, retry, and failure result branches", async () => {
    const client = new TransmissionClient(
      createDownloader({
        type: "transmission",
        downloadPath: "/downloads",
        category: "games",
      })
    );
    const privateClient = client as unknown as {
      makeRequest: (
        method: string,
        args: Record<string, unknown>
      ) => Promise<{
        result?: string;
        arguments: Record<string, unknown>;
      }>;
    };
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location"
            ? "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
            : null,
      },
    } as Response);
    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: {
        "torrent-added": {
          hashString: "magnet-hash",
        },
      },
    });

    await expect(
      client.addDownload({ url: "http://indexer.local/redirect.torrent", title: "Redirected" })
    ).resolves.toEqual({
      success: true,
      id: "magnet-hash",
      message: "Download added successfully",
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => null },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: { get: () => null },
      } as Response);
    makeRequestSpy.mockResolvedValueOnce({
      result: "tracker offline",
      arguments: {},
    });

    await expect(
      client.addDownload({
        url: "http://indexer.local/file.torrent&file=Questarr",
        title: "Retry file param",
        priority: 5,
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download: tracker offline",
    });
  });

  it("covers rTorrent connection branches and magnet add flows", async () => {
    const client = new RTorrentClient(
      createDownloader({ type: "rtorrent", category: "games", downloadPath: "/downloads" })
    );
    const privateClient = client as unknown as {
      makeXMLRPCRequest: (method: string, params: unknown[]) => Promise<unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    rpcSpy.mockResolvedValueOnce("0.9.8");
    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected to rTorrent v0.9.8",
    });

    rpcSpy.mockRejectedValueOnce(new Error("Authentication failed: bad credentials"));
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Authentication failed: bad credentials",
    });

    rpcSpy.mockRejectedValueOnce(new Error("rpc down"));
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Failed to connect to rTorrent: rpc down",
    });

    await expect(client.addDownload({ url: "", title: "No URL" })).resolves.toEqual({
      success: false,
      message: "Download URL is required",
    });

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.addDownload({ url: "http://unsafe.local/file.torrent", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.torrent",
    });

    rpcSpy.mockResolvedValueOnce(0);
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Magnet",
      })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully",
    });

    rpcSpy.mockResolvedValueOnce(5);
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Magnet failure",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download (rTorrent returned code: 5)",
    });
  });

  it("covers rTorrent redirected magnet and non-magnet failure branches", async () => {
    const client = new RTorrentClient(
      createDownloader({ type: "rtorrent", addStopped: true, category: "games" })
    );
    const privateClient = client as unknown as {
      makeXMLRPCRequest: (method: string, params: unknown[]) => Promise<unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location"
            ? "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
            : null,
      },
    } as Response);
    rpcSpy.mockResolvedValueOnce(0);

    await expect(
      client.addDownload({ url: "http://indexer.local/start.torrent", title: "Redirected" })
    ).resolves.toEqual({
      success: true,
      id: "abcdef1234567890abcdef1234567890abcdef12",
      message: "Download added successfully (stopped)",
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      headers: { get: () => null },
    } as Response);

    await expect(
      client.addDownload({ url: "http://indexer.local/broken.torrent", title: "Broken file" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to download file from indexer: Server Error",
    });
  });

  it("covers SABnzbd connection and addDownload error variants", async () => {
    const client = new SABnzbdClient(createDownloader({ type: "sabnzbd", username: "api-key" }));
    const privateClient = client as unknown as {
      fetchWithFallback: (url: string, options?: RequestInit) => Promise<Response>;
    };
    const fetchWithFallbackSpy = vi.spyOn(privateClient, "fetchWithFallback");

    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "4.3.2" }),
    } as Response);
    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected to SABnzbd v4.3.2",
    });

    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notVersion: true }),
    } as Response);
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Invalid SABnzbd response - missing version field",
    });

    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Boom",
      text: async () => "server error",
    } as Response);
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message:
        "Failed to connect to SABnzbd at http://localhost:8080/api?apikey=api-key&mode=version&output=json: HTTP 500: Boom - server error",
    });

    fetchWithFallbackSpy.mockRejectedValueOnce(new Error("connect boom"));
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: expect.stringContaining("Failed to connect to SABnzbd"),
    });

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.addDownload({ url: "http://unsafe.local/file.nzb", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.nzb",
    });

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
    } as Response);
    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Missing" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to fetch NZB: Not Found",
    });

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("nzb").buffer,
    } as Response);
    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: false, error: "Duplicate NZB" }),
    } as Response);
    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: 'Game "One"' })
    ).resolves.toEqual({
      success: true,
      message: "NZB already exists: Duplicate NZB",
    });
  });

  it("covers SABnzbd addDownload success-without-id and generic failure branches", async () => {
    const client = new SABnzbdClient(createDownloader({ type: "sabnzbd", username: "api-key" }));
    const privateClient = client as unknown as {
      fetchWithFallback: (url: string, options?: RequestInit) => Promise<Response>;
    };
    const fetchWithFallbackSpy = vi.spyOn(privateClient, "fetchWithFallback");

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("nzb").buffer,
    } as Response);
    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: true }),
    } as Response);

    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Merged NZB" })
    ).resolves.toEqual({
      success: true,
      message: "NZB added successfully (likely duplicate or merged)",
    });

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("nzb").buffer,
    } as Response);
    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: false, error: "Queue rejected" }),
    } as Response);

    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Rejected NZB" })
    ).resolves.toEqual({
      success: false,
      message: "Queue rejected",
    });
  });

  it("covers NZBGet success and addDownload failure branches", async () => {
    const client = new NZBGetClient(createDownloader({ type: "nzbget" }));
    const privateClient = client as unknown as {
      makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    rpcSpy.mockResolvedValueOnce("23.0");
    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected to NZBGet v23.0",
    });

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.addDownload({ url: "http://unsafe.local/file.nzb", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked: http://unsafe.local/file.nzb",
    });

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
    } as Response);
    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Missing" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to fetch NZB: Not Found",
    });

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      text: async () => "<nzb></nzb>",
    } as Response);
    rpcSpy.mockResolvedValueOnce(0);
    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Zero ID" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add NZB (ID is 0 or negative)",
    });
  });

  it("covers NZBGet addDownload success and completed history details", async () => {
    const client = new NZBGetClient(createDownloader({ type: "nzbget" }));
    const privateClient = client as unknown as {
      makeXMLRPCRequest: (method: string, params?: unknown[]) => Promise<unknown>;
    };
    const rpcSpy = vi.spyOn(privateClient, "makeXMLRPCRequest");

    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      text: async () => "<nzb></nzb>",
    } as Response);
    rpcSpy.mockResolvedValueOnce(42);

    await expect(
      client.addDownload({ url: "http://indexer.local/file.nzb", title: "Good NZB" })
    ).resolves.toEqual({
      success: true,
      id: "42",
      message: "NZB added successfully",
    });

    rpcSpy.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        NZBID: 12,
        Name: "Finished Game",
        Status: "SUCCESS/ALL",
        FileSizeMB: 30,
        Category: "games",
        DownloadTimeSec: 60,
        ParStatus: "NONE",
        UnpackStatus: "SUCCESS",
        FailedArticles: 0,
        DeleteStatus: "NONE",
        DestDir: "/downloads",
      },
    ]);

    await expect(client.getDownloadDetails("12")).resolves.toMatchObject({
      status: "completed",
      repairStatus: "good",
      unpackStatus: "completed",
      files: [],
      trackers: [],
    });
  });

  it("covers Synology connection and operational error branches", async () => {
    const client = new SynologyDownloadStationClient(
      createDownloader({
        type: "synology",
        username: "admin",
        password: "password",
      })
    );
    const privateClient = client as unknown as {
      authenticate: (force?: boolean) => Promise<void>;
      logout: () => Promise<void>;
      requestTaskApi: <T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          retryOnAuthFailure?: boolean;
        }
      ) => Promise<T>;
      ensureApiInfo: () => Promise<void>;
      getTaskApiDescriptor: () => { apiName: string };
      getTask: (id: string, additional: string) => Promise<unknown>;
      requestApi: <T>(
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
      ) => Promise<T>;
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
    };

    vi.spyOn(privateClient, "authenticate").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "logout").mockResolvedValue(undefined);
    await expect(client.testConnection()).resolves.toEqual({
      success: true,
      message: "Connected successfully to Synology Download Station",
    });

    vi.spyOn(privateClient, "authenticate").mockRejectedValueOnce(new Error("auth boom"));
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message: "Failed to connect to Synology Download Station: auth boom",
    });

    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });
    const requestTaskApiSpy = vi.spyOn(privateClient, "requestTaskApi");

    vi.mocked(isSafeUrl).mockResolvedValueOnce(false);
    await expect(
      client.addDownload({ url: "http://unsafe.local/file.torrent", title: "Unsafe" })
    ).resolves.toEqual({
      success: false,
      message: "Unsafe URL blocked",
    });

    requestTaskApiSpy.mockResolvedValueOnce({
      success: true,
      data: { task_id: ["task-1"] },
    } as never);
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Magnet",
      })
    ).resolves.toEqual({
      success: true,
      id: "task-1",
      message: "Download added successfully",
    });

    vi.spyOn(privateClient, "getTask").mockRejectedValue(new Error("status boom"));
    await expect(client.getDownloadStatus("task-1")).resolves.toBeNull();
    await expect(client.getDownloadDetails("task-1")).resolves.toBeNull();

    requestTaskApiSpy.mockRejectedValueOnce(new Error("list boom"));
    await expect(client.getAllDownloads()).resolves.toEqual([]);
    requestTaskApiSpy.mockRejectedValueOnce(new Error("pause boom"));
    await expect(client.pauseDownload("task-1")).resolves.toEqual({
      success: false,
      message: "Failed to pause download: pause boom",
    });
    requestTaskApiSpy.mockRejectedValueOnce(new Error("resume boom"));
    await expect(client.resumeDownload("task-1")).resolves.toEqual({
      success: false,
      message: "Failed to resume download: resume boom",
    });
    requestTaskApiSpy.mockRejectedValueOnce(new Error("remove boom"));
    await expect(client.removeDownload("task-1", true)).resolves.toEqual({
      success: false,
      message: "Failed to remove download: remove boom",
    });

    privateClient.apiInfo = null;
    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "requestApi").mockRejectedValueOnce(new Error("space boom"));
    await expect(client.getFreeSpace()).resolves.toBe(0);
  });

  it("covers Synology upload path and successful listing helpers", async () => {
    const client = new SynologyDownloadStationClient(
      createDownloader({
        type: "synology",
        username: "admin",
        password: "password",
      })
    );
    const privateClient = client as unknown as {
      ensureApiInfo: () => Promise<void>;
      getTaskApiDescriptor: () => { apiName: string };
      requestTaskApi: <T>(
        methodName: string,
        options?: {
          httpMethod?: "GET" | "POST";
          params?: Record<string, string | number | boolean | undefined>;
          body?: URLSearchParams | FormData;
          retryOnAuthFailure?: boolean;
        }
      ) => Promise<T>;
      requestApi: <T>(
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
      ) => Promise<T>;
      apiInfo: Record<string, { path: string; minVersion: number; maxVersion: number }> | null;
    };

    vi.spyOn(privateClient, "ensureApiInfo").mockResolvedValue(undefined);
    vi.spyOn(privateClient, "getTaskApiDescriptor").mockReturnValue({
      apiName: "SYNO.DownloadStation2.Task",
    });
    const requestTaskApiSpy = vi.spyOn(privateClient, "requestTaskApi");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "application/x-nzb" : null),
      },
      arrayBuffer: async () => new TextEncoder().encode("nzb-data").buffer,
    } as Response);
    requestTaskApiSpy.mockResolvedValueOnce({
      success: true,
      data: { task_id: ["task-upload"] },
    } as never);

    await expect(
      client.addDownload({
        url: "http://indexer.local/file.nzb",
        title: "Uploaded NZB",
        downloadType: "usenet",
      })
    ).resolves.toEqual({
      success: true,
      id: "task-upload",
      message: "Download added successfully",
    });

    requestTaskApiSpy.mockResolvedValueOnce({
      success: true,
      data: {
        tasks: [
          {
            id: "task-1",
            title: "Questarr Game",
            size: 100,
            status: "finished",
            additional: {
              transfer: {
                size_downloaded: 100,
                speed_download: 0,
              },
            },
          },
        ],
      },
    } as never);

    await expect(client.getAllDownloads()).resolves.toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "completed",
        progress: 100,
      }),
    ]);

    privateClient.apiInfo = {
      "SYNO.FileStation.Info": { path: "entry.cgi", minVersion: 1, maxVersion: 2 },
    };
    vi.spyOn(privateClient, "requestApi").mockResolvedValueOnce({
      success: true,
      data: { useable_space: 16384 },
    } as never);

    await expect(client.getFreeSpace()).resolves.toBe(16384);
  });
});
