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
const { TransmissionClient } = await import("../downloaders/transmission.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "transmission-coverage",
    name: "Transmission",
    type: "transmission",
    url: "http://transmission.local",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
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

describe("transmission remaining regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    parseTorrentMock.mockReset();
    fetchWithMagnetDetectionMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("covers base URL normalization and addDownload fallback branches", async () => {
    const helperClient = new TransmissionClient(
      createDownloader({
        url: "transmission.local/root/",
        useSsl: true,
        port: 9091,
        urlPath: "custom/",
      })
    ) as unknown as {
      getBaseUrl(): string;
      makeRequest(method: string, arguments_: unknown): Promise<unknown>;
    };
    expect(helperClient.getBaseUrl()).toBe("https://transmission.local:9091/root/custom");

    const invalidUrlClient = new TransmissionClient(
      createDownloader({
        url: "http://bad host/",
      })
    ) as unknown as {
      getBaseUrl(): string;
    };
    expect(invalidUrlClient.getBaseUrl()).toBe("http://bad host");

    const client = new TransmissionClient(
      createDownloader({ downloadPath: "/downloads", category: "games" })
    );
    const privateClient = client as unknown as {
      makeRequest(
        method: string,
        arguments_: Record<string, unknown>
      ): Promise<{
        result?: string;
        arguments: Record<string, unknown>;
      }>;
    };
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      } as Response,
    });
    parseTorrentMock.mockResolvedValueOnce({ infoHash: "abcdef" });
    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: { "torrent-added": { hashString: "hash-1" } },
    });
    await expect(
      client.addDownload({ url: "http://indexer.local/file.torrent", title: "Torrent file" })
    ).resolves.toEqual({
      success: true,
      id: "hash-1",
      message: "Download added successfully",
    });

    fetchWithMagnetDetectionMock.mockResolvedValueOnce({
      response: {
        ok: false,
        status: 500,
        statusText: "Bad Gateway",
      } as Response,
    });
    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: { "torrent-added": { hashString: "hash-2" } },
    });
    await expect(
      client.addDownload({ url: "http://indexer.local/broken.torrent", title: "Broken file" })
    ).resolves.toEqual({
      success: true,
      id: "hash-2",
      message: "Download added successfully",
    });

    fetchWithMagnetDetectionMock.mockRejectedValueOnce(new Error("download boom"));
    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: { "torrent-added": { hashString: "hash-3" } },
    });
    await expect(
      client.addDownload({ url: "http://indexer.local/error.torrent", title: "Error file" })
    ).resolves.toEqual({
      success: true,
      id: "hash-3",
      message: "Download added successfully",
    });

    makeRequestSpy.mockRejectedValueOnce("boom");
    await expect(
      client.addDownload({
        url: "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
        title: "Thrown magnet",
      })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add download: Unknown error",
    });
  });

  it("covers status/detail/list/control and mapping edge branches", async () => {
    const client = new TransmissionClient(createDownloader());
    const privateClient = client as unknown as {
      makeRequest(
        method: string,
        arguments_: Record<string, unknown>
      ): Promise<{
        result?: string;
        arguments: Record<string, unknown>;
      }>;
      mapTransmissionStatus(torrent: Record<string, unknown>): Record<string, unknown>;
      mapTransmissionDetails(torrent: Record<string, unknown>): Record<string, unknown>;
    };
    const makeRequestSpy = vi.spyOn(privateClient, "makeRequest");

    makeRequestSpy.mockResolvedValueOnce({ result: "success", arguments: { torrents: [] } });
    await expect(client.getDownloadStatus("7")).resolves.toBeNull();

    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: {
        torrents: [
          {
            id: 7,
            hashString: "hash-7",
            name: "Found",
            status: 4,
            percentDone: 0.5,
            rateDownload: 10,
            rateUpload: 0,
            eta: 60,
            totalSize: 100,
            downloadedEver: 50,
            peersSendingToUs: 2,
            peersGettingFromUs: 1,
            uploadRatio: 0.5,
            errorString: "",
          },
        ],
      },
    });
    await expect(client.getDownloadStatus("7")).resolves.toMatchObject({
      id: "hash-7",
      status: "downloading",
    });

    makeRequestSpy.mockRejectedValueOnce(new Error("status boom"));
    await expect(client.getDownloadStatus("7")).resolves.toBeNull();

    makeRequestSpy.mockResolvedValueOnce({ result: "success", arguments: { torrents: [] } });
    await expect(client.getDownloadDetails("7")).resolves.toBeNull();

    makeRequestSpy.mockRejectedValueOnce(new Error("details boom"));
    await expect(client.getDownloadDetails("7")).resolves.toBeNull();

    makeRequestSpy.mockResolvedValueOnce({ result: "success", arguments: {} });
    await expect(client.getAllDownloads()).resolves.toEqual([]);

    makeRequestSpy.mockResolvedValueOnce({
      result: "success",
      arguments: {
        torrents: [
          {
            id: 8,
            hashString: "hash-8",
            name: "Listed",
            status: 4,
            percentDone: 0.25,
            rateDownload: 5,
            rateUpload: 0,
            eta: 120,
            totalSize: 100,
            downloadedEver: 25,
            peersSendingToUs: 1,
            peersGettingFromUs: 2,
            uploadRatio: 0.1,
            errorString: "",
          },
        ],
      },
    });
    await expect(client.getAllDownloads()).resolves.toEqual([
      expect.objectContaining({ id: "hash-8", status: "downloading" }),
    ]);

    makeRequestSpy.mockRejectedValueOnce(new Error("pause boom"));
    await expect(client.pauseDownload("7")).resolves.toEqual({
      success: false,
      message: "Failed to pause download: pause boom",
    });

    makeRequestSpy.mockRejectedValueOnce(new Error("resume boom"));
    await expect(client.resumeDownload("7")).resolves.toEqual({
      success: false,
      message: "Failed to resume download: resume boom",
    });

    makeRequestSpy.mockRejectedValueOnce(new Error("remove boom"));
    await expect(client.removeDownload("7")).resolves.toEqual({
      success: false,
      message: "Failed to remove download: remove boom",
    });

    makeRequestSpy.mockRejectedValueOnce(new Error("space boom"));
    await expect(client.getFreeSpace()).resolves.toBe(0);

    expect(
      privateClient.mapTransmissionStatus({
        id: 1,
        hashString: "hash-complete",
        name: "Complete",
        status: 0,
        percentDone: 1,
        rateDownload: 0,
        rateUpload: 0,
        eta: 0,
        totalSize: 100,
        downloadedEver: 100,
        peersSendingToUs: 0,
        peersGettingFromUs: 0,
        uploadRatio: 1,
        errorString: "",
      }).status
    ).toBe("completed");

    expect(
      privateClient.mapTransmissionStatus({
        id: 2,
        name: "Unknown",
        status: 99,
        percentDone: 0.2,
        rateDownload: 0,
        rateUpload: 0,
        eta: 0,
        totalSize: 100,
        downloadedEver: 20,
        peersSendingToUs: 0,
        peersGettingFromUs: 0,
        uploadRatio: 0,
        errorString: "",
      }).status
    ).toBe("error");

    const details = privateClient.mapTransmissionDetails({
      id: 3,
      hashString: "hash-3",
      name: "Detailed",
      status: 4,
      percentDone: 0.5,
      rateDownload: 1,
      rateUpload: 0,
      eta: 0,
      totalSize: 100,
      downloadedEver: 50,
      peersSendingToUs: 2,
      peersGettingFromUs: 1,
      uploadRatio: 0.2,
      errorString: "",
      peersConnected: 3,
      trackerStats: [
        {
          announce: "https://backup.tracker",
          tier: 0,
          lastAnnounceSucceeded: false,
          isBackup: true,
          lastAnnounceResult: "",
          announceState: 0,
          seederCount: -1,
          leecherCount: -1,
          lastAnnounceTime: 0,
        },
      ],
    });
    expect(details.trackers).toEqual([expect.objectContaining({ status: "inactive" })]);
  });

  it("covers Transmission request retry and direct error branches", async () => {
    const client = new TransmissionClient(createDownloader()) as unknown as {
      makeRequest(method: string, arguments_: unknown): Promise<unknown>;
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
        ok: false,
        status: 500,
        statusText: "Offline",
        text: async () => {
          throw new Error("retry boom");
        },
      } as Response);
    await expect(client.makeRequest("session-get", {})).rejects.toThrow(
      "HTTP 500: Offline - No error details available"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "denied",
      headers: {
        get: (name: string) => (name === "www-authenticate" ? "Basic realm=Transmission" : null),
      },
    } as Response);
    await expect(client.makeRequest("session-get", {})).rejects.toThrow(
      "Authentication failed: Invalid username or password for Transmission - denied"
    );

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => {
        throw new Error("no body");
      },
      headers: { get: () => null },
    } as Response);
    await expect(client.makeRequest("session-get", {})).rejects.toThrow(
      "HTTP 500: Server Error - No error details available"
    );
  });
});
