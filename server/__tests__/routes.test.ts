import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Downloader } from "../../shared/schema";
import { DownloaderManager } from "../downloaders.js";

describe("/api/downloads endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  type DownloadWithDownloader = Awaited<
    ReturnType<typeof DownloaderManager.getAllDownloads>
  >[number] & {
    downloaderId: string;
    downloaderName: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("should return errors when a downloader fails", async () => {
    const testDownloader1: Downloader = {
      id: "downloader-1",
      name: "Working Downloader",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
    };

    const testDownloader2: Downloader = {
      id: "downloader-2",
      name: "Failing Downloader",
      type: "transmission",
      url: "http://localhost:9092/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 2,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
    };

    // Mock successful response for first downloader
    const headers1 = new Headers();
    headers1.set("X-Transmission-Session-Id", "session-123");
    const response409_1 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: headers1,
      json: async () => ({}),
      text: async () => "",
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          torrents: [
            {
              id: 1,
              name: "Test Game.torrent",
              status: 4,
              percentDone: 0.5,
              rateDownload: 102400,
              rateUpload: 51200,
              eta: 300,
              totalSize: 1000000000,
              downloadedEver: 500000000,
              peersSendingToUs: 10,
              peersGettingFromUs: 5,
              uploadRatio: 1.5,
              errorString: "",
            },
          ],
        },
        result: "success",
      }),
    };

    // Mock error response for second downloader
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: async () => ({ error: "Connection failed" }),
      text: async () => "Connection failed",
    };

    fetchMock
      .mockResolvedValueOnce(response409_1) // First downloader 409
      .mockResolvedValueOnce(successResponse) // First downloader success
      .mockResolvedValueOnce(errorResponse); // Second downloader fails

    // Simulate what the /api/downloads endpoint does
    const enabledDownloaders = [testDownloader1, testDownloader2];
    const allDownloads: DownloadWithDownloader[] = [];
    const errors: Array<{ downloaderId: string; downloaderName: string; error: string }> = [];

    for (const downloader of enabledDownloaders) {
      try {
        const downloads = await DownloaderManager.getAllDownloads(downloader);
        const downloadsWithDownloader: DownloadWithDownloader[] = downloads.map((download) => ({
          ...download,
          downloaderId: downloader.id,
          downloaderName: downloader.name,
        }));
        allDownloads.push(...downloadsWithDownloader);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({
          downloaderId: downloader.id,
          downloaderName: downloader.name,
          error: errorMessage,
        });
      }
    }

    // Verify that we have one successful download
    expect(allDownloads).toHaveLength(1);
    expect(allDownloads[0].downloaderId).toBe("downloader-1");
    expect(allDownloads[0].downloaderName).toBe("Working Downloader");

    // Verify that we have one error
    expect(errors).toHaveLength(1);
    expect(errors[0].downloaderId).toBe("downloader-2");
    expect(errors[0].downloaderName).toBe("Failing Downloader");
    expect(errors[0].error).toContain("HTTP 500");
  });

  it("should return empty errors array when all downloaders succeed", async () => {
    const testDownloader: Downloader = {
      id: "downloader-1",
      name: "Working Downloader",
      type: "transmission",
      url: "http://localhost:9091/transmission/rpc",
      username: null,
      password: null,
      enabled: true,
      priority: 1,
      downloadPath: null,
      category: "games",
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      port: null,
      useSsl: null,
      urlPath: null,
      label: null,
      addStopped: null,
      removeCompleted: null,
      postImportCategory: null,
    };

    // Mock successful response
    const headers = new Headers();
    headers.set("X-Transmission-Session-Id", "session-123");
    const response409 = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers,
      json: async () => ({}),
      text: async () => "",
    };

    const successResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        arguments: {
          torrents: [
            {
              id: 1,
              name: "Test Game.torrent",
              status: 4,
              percentDone: 0.5,
              rateDownload: 102400,
              rateUpload: 51200,
              eta: 300,
              totalSize: 1000000000,
              downloadedEver: 500000000,
              peersSendingToUs: 10,
              peersGettingFromUs: 5,
              uploadRatio: 1.5,
              errorString: "",
            },
          ],
        },
        result: "success",
      }),
    };

    fetchMock.mockResolvedValueOnce(response409).mockResolvedValueOnce(successResponse);

    // Simulate what the /api/downloads endpoint does
    const enabledDownloaders = [testDownloader];
    const allDownloads: DownloadWithDownloader[] = [];
    const errors: Array<{ downloaderId: string; downloaderName: string; error: string }> = [];

    for (const downloader of enabledDownloaders) {
      try {
        const downloads = await DownloaderManager.getAllDownloads(downloader);
        const downloadsWithDownloader: DownloadWithDownloader[] = downloads.map((download) => ({
          ...download,
          downloaderId: downloader.id,
          downloaderName: downloader.name,
        }));
        allDownloads.push(...downloadsWithDownloader);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({
          downloaderId: downloader.id,
          downloaderName: downloader.name,
          error: errorMessage,
        });
      }
    }

    // Verify that we have downloads
    expect(allDownloads).toHaveLength(1);

    // Verify that we have no errors
    expect(errors).toHaveLength(0);
  });
});
