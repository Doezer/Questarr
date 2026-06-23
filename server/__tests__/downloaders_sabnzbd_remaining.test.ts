import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Downloader } from "../../shared/schema.js";

const fetchMock = vi.fn();
const safeFetchMock = vi.fn();
const httpsRequestMock = vi.fn();

vi.mock("https", () => ({
  default: {
    request: httpsRequestMock,
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

vi.mock("../ssrf.js", () => ({
  isSafeUrl: vi.fn().mockResolvedValue(true),
  safeFetch: safeFetchMock,
  resolveSafeAddress: vi.fn().mockResolvedValue({ address: "127.0.0.1", family: 4 }),
}));

global.fetch = fetchMock as unknown as typeof fetch;

const { isSafeUrl } = await import("../ssrf.js");
const { SABnzbdClient } = await import("../downloaders/sabnzbd.js");

const createDownloader = (overrides: Partial<Downloader> = {}): Downloader => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  return {
    id: "sab-coverage",
    name: "SABnzbd",
    type: "sabnzbd",
    url: "sab.local",
    enabled: true,
    priority: 1,
    port: null,
    useSsl: false,
    urlPath: null,
    username: "api-key",
    password: null,
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

const queueResponse = (slots: Array<Record<string, unknown>>, speed = "0") =>
  ({
    ok: true,
    json: async () => ({
      queue: {
        slots,
        speed,
      },
    }),
  }) as Response;

const historyResponse = (slots?: Array<Record<string, unknown>>) =>
  ({
    ok: true,
    json: async () => ({
      history: {
        slots,
      },
    }),
  }) as Response;

class MockRequest extends EventEmitter {
  public writes: Array<Buffer | string> = [];

  destroy = vi.fn();

  write = vi.fn((chunk: Buffer | string) => {
    this.writes.push(chunk);
  });

  end = vi.fn();
}

describe("sabnzbd remaining regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    safeFetchMock.mockReset();
    httpsRequestMock.mockReset();
    vi.mocked(isSafeUrl).mockResolvedValue(true);
  });

  it("covers URL normalization, fetchInsecure branches, testConnection, and addDownload edge paths", async () => {
    const helperClient = new SABnzbdClient(
      createDownloader({
        url: "sab.local/root/",
        useSsl: true,
        port: 8085,
      })
    ) as unknown as {
      getBaseUrl(): string;
      fetchInsecure(url: string, options: RequestInit): Promise<Response>;
    };
    expect(helperClient.getBaseUrl()).toBe("https://sab.local:8085/root");

    const invalidUrlClient = new SABnzbdClient(
      createDownloader({
        url: "http://bad host/",
      })
    ) as unknown as {
      getBaseUrl(): string;
    };
    expect(invalidUrlClient.getBaseUrl()).toBe("http://bad host");

    httpsRequestMock.mockImplementationOnce(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (response: EventEmitter & Record<string, unknown>) => void
      ) => {
        const request = new MockRequest();
        request.end.mockImplementation(() => {
          const response = new EventEmitter() as EventEmitter & Record<string, unknown>;
          response.statusCode = 200;
          response.statusMessage = "OK";
          response.headers = { "content-type": "application/json" };
          callback(response);
          response.emit("data", Buffer.from('{"ok":true}'));
          response.emit("end");
        });
        return request;
      }
    );
    const insecureJson = await helperClient.fetchInsecure("https://sab.local", {
      method: "POST",
      body: "payload",
      headers: { Accept: "application/json" },
    });
    await expect(insecureJson.text()).resolves.toBe('{"ok":true}');
    await expect(insecureJson.json()).resolves.toEqual({ ok: true });
    expect(insecureJson.headers.get("content-type")).toBe("application/json");

    httpsRequestMock.mockImplementationOnce(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (response: EventEmitter & Record<string, unknown>) => void
      ) => {
        const request = new MockRequest();
        request.end.mockImplementation(() => {
          const response = new EventEmitter() as EventEmitter & Record<string, unknown>;
          response.statusCode = 200;
          response.statusMessage = "OK";
          response.headers = {};
          callback(response);
          response.emit("data", Buffer.from("not-json"));
          response.emit("end");
        });
        return request;
      }
    );
    const insecureInvalidJson = await helperClient.fetchInsecure("https://sab.local", {});
    await expect(insecureInvalidJson.json()).rejects.toThrow("Failed to parse JSON: not-json");

    httpsRequestMock.mockImplementationOnce(() => {
      const request = new MockRequest();
      request.end.mockImplementation(() => {
        request.emit("timeout");
      });
      return request;
    });
    await expect(helperClient.fetchInsecure("https://sab.local", {})).rejects.toThrow("Timeout");

    httpsRequestMock.mockImplementationOnce(() => {
      const request = new MockRequest();
      request.end.mockImplementation(() => {
        request.emit("error", new Error("socket boom"));
      });
      return request;
    });
    await expect(helperClient.fetchInsecure("https://sab.local", {})).rejects.toThrow(
      "socket boom"
    );

    const client = new SABnzbdClient(createDownloader());
    const privateClient = client as unknown as {
      fetchWithFallback(url: string, options?: RequestInit): Promise<Response>;
    };
    const fetchWithFallbackSpy = vi.spyOn(privateClient, "fetchWithFallback");

    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Broken",
      text: async () => {
        throw new Error("no body");
      },
    } as Response);
    await expect(client.testConnection()).resolves.toEqual({
      success: false,
      message:
        "Failed to connect to SABnzbd at http://sab.local/api?apikey=api-key&mode=version&output=json: HTTP 500: Broken - No error details",
    });

    safeFetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("nzb").buffer,
    } as Response);
    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => {
        throw new Error("no body");
      },
    } as Response);
    await expect(
      client.addDownload({ url: "http://indexer.local/bad.nzb", title: "Broken NZB" })
    ).resolves.toEqual({
      success: false,
      message: "HTTP 503: No error details",
    });

    safeFetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("nzb").buffer,
    } as Response);
    fetchWithFallbackSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: true, nzo_ids: ["sab-1"] }),
    } as Response);
    await expect(
      client.addDownload({ url: "http://indexer.local/good.nzb", title: "Good NZB" })
    ).resolves.toEqual({
      success: true,
      id: "sab-1",
      message: "NZB added successfully",
    });

    safeFetchMock.mockRejectedValueOnce("boom");
    await expect(
      client.addDownload({ url: "http://indexer.local/throw.nzb", title: "Thrown NZB" })
    ).resolves.toEqual({
      success: false,
      message: "Failed to add NZB to SABnzbd: Unknown error",
    });
  });

  it("covers queue/history status variants, details fallbacks, and control error branches", async () => {
    const client = new SABnzbdClient(createDownloader({ category: "games" }));
    const privateClient = client as unknown as {
      fetchWithFallback(url: string, options?: RequestInit): Promise<Response>;
      getFromHistory(id: string): Promise<unknown>;
      getDownloadStatus(id: string): Promise<unknown>;
    };
    const fetchWithFallbackSpy = vi.spyOn(privateClient, "fetchWithFallback");

    fetchWithFallbackSpy.mockResolvedValueOnce(
      queueResponse([
        {
          nzo_id: "repair",
          filename: "Repair NZB",
          status: "Repairing",
          percentage: "50",
          mb: "10",
          mbleft: "5",
          timeleft: "0:01:00",
          cat: "games",
          avg_age: "2",
        },
      ])
    );
    await expect(client.getDownloadStatus("repair")).resolves.toMatchObject({
      status: "repairing",
      repairStatus: "repairing",
    });

    fetchWithFallbackSpy.mockResolvedValueOnce(
      queueResponse([
        {
          nzo_id: "fetching",
          filename: "Fetching NZB",
          status: "Fetching",
          percentage: "10",
          mb: "10",
          mbleft: "9",
          timeleft: "unknown",
          cat: "games",
          avg_age: "2",
        },
      ])
    );
    await expect(client.getDownloadStatus("fetching")).resolves.toMatchObject({
      status: "downloading",
    });

    fetchWithFallbackSpy.mockResolvedValueOnce(
      queueResponse([
        {
          nzo_id: "paused",
          filename: "Paused NZB",
          status: "Paused",
          percentage: "0",
          mb: "10",
          mbleft: "10",
          timeleft: "unknown",
          cat: "games",
          avg_age: "2",
        },
      ])
    );
    await expect(client.getDownloadStatus("paused")).resolves.toMatchObject({
      status: "paused",
    });

    fetchWithFallbackSpy.mockResolvedValueOnce(
      queueResponse([
        {
          nzo_id: "failed",
          filename: "Failed NZB",
          status: "Failed",
          percentage: "10",
          mb: "10",
          mbleft: "9",
          timeleft: "unknown",
          cat: "games",
          avg_age: "2",
        },
      ])
    );
    await expect(client.getDownloadStatus("failed")).resolves.toMatchObject({
      status: "error",
      repairStatus: "failed",
    });

    fetchWithFallbackSpy.mockResolvedValueOnce(
      queueResponse([
        {
          nzo_id: "weird",
          filename: "Weird NZB",
          status: "SomethingElse",
          percentage: "5",
          mb: "10",
          mbleft: "9.5",
          timeleft: "unknown",
          cat: "games",
          avg_age: "2",
        },
      ])
    );
    await expect(client.getDownloadStatus("weird")).resolves.toMatchObject({
      status: "downloading",
    });

    fetchWithFallbackSpy.mockRejectedValueOnce(new Error("queue broke"));
    await expect(client.getDownloadStatus("broken")).resolves.toBeNull();

    fetchWithFallbackSpy
      .mockResolvedValueOnce(
        historyResponse([
          {
            nzo_id: "completed",
            name: "Completed NZB",
            status: "Completed",
            fail_message: "",
            path: "/downloads/completed",
            size: "1 GB",
            bytes: 1024,
            category: "games",
          },
        ])
      )
      .mockResolvedValueOnce(
        historyResponse([
          {
            nzo_id: "failed-history",
            name: "Failed History",
            status: "Failed",
            fail_message: "par2 failed",
            path: "/downloads/failed",
            size: "1 GB",
            bytes: 2048,
            category: "games",
          },
        ])
      )
      .mockResolvedValueOnce(
        historyResponse([
          {
            nzo_id: "paused-history",
            name: "Paused History",
            status: "Queued",
            fail_message: "",
            path: "/downloads/paused",
            size: "1 GB",
            bytes: 4096,
            category: "games",
          },
        ])
      )
      .mockResolvedValueOnce(historyResponse([]))
      .mockResolvedValueOnce(historyResponse([]))
      .mockResolvedValueOnce(historyResponse([]))
      .mockRejectedValueOnce(new Error("history broke"));

    await expect(privateClient.getFromHistory("completed")).resolves.toMatchObject({
      status: "completed",
      repairStatus: "good",
      unpackStatus: "completed",
    });
    await expect(privateClient.getFromHistory("failed-history")).resolves.toMatchObject({
      status: "error",
      repairStatus: "failed",
      error: "par2 failed",
    });
    await expect(privateClient.getFromHistory("paused-history")).resolves.toMatchObject({
      status: "paused",
      progress: 0,
    });
    await expect(privateClient.getFromHistory("missing-history")).resolves.toBeNull();
    await expect(privateClient.getFromHistory("history-error")).resolves.toBeNull();

    const statusSpy = vi.spyOn(privateClient, "getDownloadStatus").mockResolvedValueOnce(null);
    await expect(client.getDownloadDetails("missing")).resolves.toBeNull();
    statusSpy.mockRestore();

    fetchWithFallbackSpy.mockRejectedValueOnce("pause boom");
    await expect(client.pauseDownload("sab-1")).resolves.toEqual({
      success: false,
      message: "Unknown error",
    });

    fetchWithFallbackSpy.mockRejectedValueOnce(new Error("space boom"));
    await expect(client.getFreeSpace()).resolves.toBe(0);
  });
});
