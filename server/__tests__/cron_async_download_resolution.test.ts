// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---
const createMockLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

vi.mock("../logger.js", () => ({
  logger: { child: vi.fn().mockReturnThis() },
  igdbLogger: createMockLogger(),
  searchLogger: createMockLogger(),
  torznabLogger: createMockLogger(),
  routesLogger: createMockLogger(),
  expressLogger: createMockLogger(),
  downloadersLogger: createMockLogger(),
}));

const mockGetDownloadingGameDownloads = vi.fn();
const mockGetDownloader = vi.fn();
const mockUpdateGameDownloadStatus = vi.fn();
const mockUpdateGameStatus = vi.fn();
const mockGetGame = vi.fn();
const mockAddNotification = vi.fn();
const mockGetUserSettings = vi.fn();
const mockGetImportConfig = vi.fn();
const mockUpdateGameDownloadHash = vi.fn();

vi.mock("../storage.js", () => ({
  storage: {
    getDownloadingGameDownloads: mockGetDownloadingGameDownloads,
    getDownloader: mockGetDownloader,
    updateGameDownloadStatus: mockUpdateGameDownloadStatus,
    updateGameStatus: mockUpdateGameStatus,
    getGame: mockGetGame,
    addNotification: mockAddNotification,
    getUserSettings: mockGetUserSettings,
    getImportConfig: mockGetImportConfig,
    updateGameDownloadHash: mockUpdateGameDownloadHash,
  },
}));

const mockGetAllDownloads = vi.fn();
const mockGetDownloadStatus = vi.fn();
const mockGetDownloadDetails = vi.fn();
const mockFindDownloadByTag = vi.fn();

vi.mock("../downloaders.js", () => ({
  DownloaderManager: {
    getAllDownloads: mockGetAllDownloads,
    getDownloadStatus: mockGetDownloadStatus,
    getDownloadDetails: mockGetDownloadDetails,
    findDownloadByTag: mockFindDownloadByTag,
  },
}));

const mockProcessImport = vi.fn();

vi.mock("../services/index.js", () => ({
  importManager: {
    processImport: mockProcessImport,
  },
}));

const mockNotifyUser = vi.fn();

vi.mock("../socket.js", () => ({
  notifyUser: mockNotifyUser,
}));

vi.mock("../igdb.js", () => ({
  igdbClient: { getGamesByIds: vi.fn() },
}));

vi.mock("../search.js", () => ({
  searchAllIndexers: vi.fn(),
  filterBlacklistedReleases: vi.fn(),
}));

vi.mock("../xrel.js", () => ({
  xrelClient: { getLatestReleases: vi.fn() },
  DEFAULT_XREL_BASE: "http://example.com",
}));

vi.mock("../apprise.js", () => ({
  appriseClient: { send: vi.fn() },
}));

const { checkDownloadStatus } = await import("../cron.js");

const qbDownloader = {
  id: "dl-qbit",
  name: "qBittorrent",
  type: "qbittorrent" as const,
  url: "http://localhost:8080",
  enabled: true,
  priority: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  port: null,
  useSsl: null,
  urlPath: null,
  username: "admin",
  password: "password",
  downloadPath: null,
  category: null,
  label: null,
  addStopped: null,
  removeCompleted: null,
  postImportCategory: null,
  settings: null,
};

describe("Cron — async qBittorrent correlation tag resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue({
      id: "game-1",
      title: "Test Game",
      status: "downloading",
      userId: "user-1",
    });
    mockAddNotification.mockResolvedValue({ id: "notif-1" });
    mockGetUserSettings.mockResolvedValue({ notificationPreferences: null });
    mockGetImportConfig.mockResolvedValue({ enablePostProcessing: false });
    mockUpdateGameDownloadStatus.mockResolvedValue(undefined);
    mockUpdateGameStatus.mockResolvedValue(undefined);
    mockUpdateGameDownloadHash.mockResolvedValue(undefined);
    mockGetDownloadDetails.mockResolvedValue(null);
    mockProcessImport.mockResolvedValue(undefined);
  });

  it("resolves a correlation tag to the real hash and updates the tracking record", async () => {
    // The tracking record was created with the correlation tag as a temporary downloadHash.
    const asyncDownload = {
      id: "gd-async-1",
      gameId: "game-1",
      downloaderId: "dl-qbit",
      downloadHash: "questarr-add-abc123uuid",
      downloadTitle: "Async Game",
      status: "downloading" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadType: "torrent" as const,
    };

    mockGetDownloadingGameDownloads.mockResolvedValue([asyncDownload]);
    mockGetDownloader.mockResolvedValue(qbDownloader);

    // findDownloadByTag resolves the tag to the real torrent hash.
    mockFindDownloadByTag.mockResolvedValue("realhash456");

    // After resolution, the bulk getAllDownloads finds the torrent.
    mockGetAllDownloads.mockResolvedValue([
      {
        id: "realhash456",
        name: "Async Game",
        status: "downloading",
        progress: 50,
        downloadType: "torrent",
      },
    ]);

    await checkDownloadStatus();

    // The tag should have been resolved via the downloader.
    expect(mockFindDownloadByTag).toHaveBeenCalledWith(qbDownloader, "questarr-add-abc123uuid");

    // The tracking record should have been updated with the real hash.
    expect(mockUpdateGameDownloadHash).toHaveBeenCalledWith("gd-async-1", "realhash456");

    // The download should have been matched and NOT marked completed.
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalledWith("gd-async-1", "completed");
  });

  it("skips the download when the correlation tag has not yet resolved (torrent not visible)", async () => {
    const asyncDownload = {
      id: "gd-async-2",
      gameId: "game-1",
      downloaderId: "dl-qbit",
      downloadHash: "questarr-add-notyet",
      downloadTitle: "Pending Game",
      status: "downloading" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadType: "torrent" as const,
    };

    mockGetDownloadingGameDownloads.mockResolvedValue([asyncDownload]);
    mockGetDownloader.mockResolvedValue(qbDownloader);
    // Bulk fetch runs once per downloader before the per-download loop.
    mockGetAllDownloads.mockResolvedValue([]);

    // qBittorrent doesn't have the torrent yet — returns null.
    mockFindDownloadByTag.mockResolvedValue(null);

    await checkDownloadStatus();

    // The tag resolution was attempted.
    expect(mockFindDownloadByTag).toHaveBeenCalledWith(qbDownloader, "questarr-add-notyet");

    // The tracking record was NOT updated (still has the tag as hash).
    expect(mockUpdateGameDownloadHash).not.toHaveBeenCalled();

    // The download was skipped entirely — no status change, no completion.
    // NOTE: bulk getAllDownloads still runs once per downloader before the
    // per-download tag-resolution loop, so only per-item follow-ups are skipped.
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalled();
    expect(mockUpdateGameStatus).not.toHaveBeenCalled();
    expect(mockGetDownloadStatus).not.toHaveBeenCalled();
  });

  it("does NOT attempt tag resolution for downloads with a real hash (non-async)", async () => {
    const syncDownload = {
      id: "gd-sync-1",
      gameId: "game-1",
      downloaderId: "dl-qbit",
      downloadHash: "realhash789",
      downloadTitle: "Sync Game",
      status: "downloading" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadType: "torrent" as const,
    };

    mockGetDownloadingGameDownloads.mockResolvedValue([syncDownload]);
    mockGetDownloader.mockResolvedValue(qbDownloader);

    mockGetAllDownloads.mockResolvedValue([
      {
        id: "realhash789",
        name: "Sync Game",
        status: "downloading",
        progress: 75,
        downloadType: "torrent",
      },
    ]);

    await checkDownloadStatus();

    // findDownloadByTag should never be called for non-async downloads.
    expect(mockFindDownloadByTag).not.toHaveBeenCalled();

    // updateGameDownloadHash should never be called either.
    expect(mockUpdateGameDownloadHash).not.toHaveBeenCalled();
  });

  it("resolves tag and then marks download as completed when torrent is done", async () => {
    const asyncDownload = {
      id: "gd-async-3",
      gameId: "game-1",
      downloaderId: "dl-qbit",
      downloadHash: "questarr-add-done",
      downloadTitle: "Completed Async Game",
      status: "downloading" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadType: "torrent" as const,
    };

    mockGetDownloadingGameDownloads.mockResolvedValue([asyncDownload]);
    mockGetDownloader.mockResolvedValue(qbDownloader);
    mockFindDownloadByTag.mockResolvedValue("donehash999");

    // Torrent is at 100% — completed.
    mockGetAllDownloads.mockResolvedValue([
      {
        id: "donehash999",
        name: "Completed Async Game",
        status: "completed",
        progress: 100,
        downloadType: "torrent",
      },
    ]);

    await checkDownloadStatus();

    // Tag was resolved.
    expect(mockFindDownloadByTag).toHaveBeenCalledWith(qbDownloader, "questarr-add-done");
    expect(mockUpdateGameDownloadHash).toHaveBeenCalledWith("gd-async-3", "donehash999");

    // After resolution, the download was matched and marked completed + owned.
    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith("gd-async-3", "completed");
    expect(mockUpdateGameStatus).toHaveBeenCalledWith("game-1", { status: "owned" });
    expect(mockNotifyUser).toHaveBeenCalledWith("downloadUpdate", "game-1");
  });
});
