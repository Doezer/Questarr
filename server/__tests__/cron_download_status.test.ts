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
const mockGetDownloadsByGameId = vi.fn();

vi.mock("../storage.js", () => ({
  storage: {
    getDownloadingGameDownloads: mockGetDownloadingGameDownloads,
    getDownloader: mockGetDownloader,
    updateGameDownloadStatus: mockUpdateGameDownloadStatus,
    updateGameStatus: mockUpdateGameStatus,
    getGame: mockGetGame,
    addNotification: mockAddNotification,
    getDownloadsByGameId: mockGetDownloadsByGameId,
  },
}));

const mockGetAllDownloads = vi.fn();
const mockGetDownloadStatus = vi.fn();

vi.mock("../downloaders.js", () => ({
  DownloaderManager: {
    getAllDownloads: mockGetAllDownloads,
    getDownloadStatus: mockGetDownloadStatus,
  },
}));

vi.mock("../socket.js", () => ({
  notifyUser: vi.fn(),
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

const { checkDownloadStatus, _resetDownloadCountersForTesting } = await import("../cron.js");

const baseDownloader = {
  id: "dl-sabnzbd",
  name: "SABnzbd",
  type: "sabnzbd" as const,
  url: "http://localhost:8080",
  enabled: true,
  priority: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  port: null,
  useSsl: null,
  urlPath: null,
  username: "apikey",
  password: null,
  downloadPath: null,
  category: null,
  label: null,
  addStopped: null,
  removeCompleted: null,
  postImportCategory: null,
  settings: null,
};

const baseDownload = {
  id: "dlrecord-1",
  gameId: "game-1",
  downloaderId: "dl-sabnzbd",
  downloadHash: "SABnzbd_nzo_abc123",
  downloadTitle: "Test Game",
  status: "downloading" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  downloadType: "usenet" as const,
};

describe("Cron - checkDownloadStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDownloadCountersForTesting();
    mockGetGame.mockResolvedValue({ id: "game-1", title: "Test Game", status: "downloading" });
    mockAddNotification.mockResolvedValue({ id: "notif-1" });
    mockUpdateGameDownloadStatus.mockResolvedValue(undefined);
    mockUpdateGameStatus.mockResolvedValue(undefined);
    mockGetDownloadsByGameId.mockResolvedValue([]);
  });

  it("should find a download via the bulk map when it is in the queue", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    // Bulk getAllDownloads returns the download (it's still in queue)
    mockGetAllDownloads.mockResolvedValue([
      {
        id: "SABnzbd_nzo_abc123",
        name: "Test Game",
        status: "downloading",
        progress: 50,
        downloadType: "usenet",
      },
    ]);

    await checkDownloadStatus();

    // Should NOT fall back to individual status check
    expect(mockGetDownloadStatus).not.toHaveBeenCalled();
    // Should NOT mark as completed yet (still at 50%)
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalledWith(baseDownload.id, "completed");
    // Status unchanged (already "downloading" in DB), so no update call
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalled();
  });

  it("should fall back to getDownloadStatus when a download is absent from getAllDownloads", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    // Bulk getAllDownloads returns empty (download moved to SABnzbd history)
    mockGetAllDownloads.mockResolvedValue([]);

    // Individual getDownloadStatus finds it in history as completed
    mockGetDownloadStatus.mockResolvedValue({
      id: "SABnzbd_nzo_abc123",
      name: "Test Game",
      status: "completed",
      progress: 100,
      downloadType: "usenet",
    });

    await checkDownloadStatus();

    expect(mockGetDownloadStatus).toHaveBeenCalledWith(baseDownloader, baseDownload.downloadHash);
    // Should mark as completed via the normal completion path
    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith(baseDownload.id, "completed");
    expect(mockUpdateGameStatus).toHaveBeenCalledWith(baseDownload.gameId, { status: "owned" });
  });

  it("should mark as completed via error path when both bulk and individual checks return null", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    // Both bulk and individual checks return nothing
    mockGetAllDownloads.mockResolvedValue([]);
    mockGetDownloadStatus.mockResolvedValue(null);

    // DOWNLOAD_MISS_THRESHOLD = 3: must miss 3 consecutive times before completing
    await checkDownloadStatus();
    await checkDownloadStatus();
    await checkDownloadStatus();

    expect(mockGetDownloadStatus).toHaveBeenCalledWith(baseDownloader, baseDownload.downloadHash);
    // Falls through to the "missing" path after threshold is reached
    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith(baseDownload.id, "completed");
    expect(mockUpdateGameStatus).toHaveBeenCalledWith(baseDownload.gameId, { status: "owned" });
  });

  it("should not call getDownloadStatus when the bulk map already contains the download", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    mockGetAllDownloads.mockResolvedValue([
      {
        id: "SABnzbd_nzo_abc123",
        name: "Test Game",
        status: "completed",
        progress: 100,
        downloadType: "usenet",
      },
    ]);

    await checkDownloadStatus();

    expect(mockGetDownloadStatus).not.toHaveBeenCalled();
    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith(baseDownload.id, "completed");
  });

  it("should not mark a download as failed on the first error (transient tracker error)", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    // qBittorrent reports "error" (e.g. transient tracker timeout right after magnet add)
    mockGetAllDownloads.mockResolvedValue([
      {
        id: "SABnzbd_nzo_abc123",
        name: "Test Game",
        status: "error",
        progress: 0,
        error: "Torrent error",
      },
    ]);

    await checkDownloadStatus();

    // Should NOT mark as failed yet — below DOWNLOAD_ERROR_THRESHOLD
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalledWith(baseDownload.id, "failed");
    expect(mockUpdateGameStatus).not.toHaveBeenCalledWith(baseDownload.gameId, {
      status: "wanted",
    });
  });

  it("should mark a download as failed only after DOWNLOAD_ERROR_THRESHOLD consecutive errors", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    const errorStatus = {
      id: "SABnzbd_nzo_abc123",
      name: "Test Game",
      status: "error",
      progress: 0,
      error: "Torrent error",
    };
    mockGetAllDownloads.mockResolvedValue([errorStatus]);

    // DOWNLOAD_ERROR_THRESHOLD = 3: must see 3 consecutive errors before failing
    await checkDownloadStatus(); // errors = 1 → skip
    await checkDownloadStatus(); // errors = 2 → skip
    await checkDownloadStatus(); // errors = 3 → mark failed

    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith(baseDownload.id, "failed");
    expect(mockUpdateGameStatus).toHaveBeenCalledWith(baseDownload.gameId, { status: "wanted" });
  });

  it("should reset the error counter when a download recovers from error state", async () => {
    mockGetDownloadingGameDownloads.mockResolvedValue([baseDownload]);
    mockGetDownloader.mockResolvedValue(baseDownloader);

    const errorStatus = {
      id: "SABnzbd_nzo_abc123",
      name: "Test Game",
      status: "error",
      progress: 0,
      error: "Torrent error",
    };
    const downloadingStatus = {
      id: "SABnzbd_nzo_abc123",
      name: "Test Game",
      status: "downloading",
      progress: 10,
    };

    // Two errors, then a recovery
    mockGetAllDownloads.mockResolvedValueOnce([errorStatus]);
    await checkDownloadStatus(); // errors = 1

    mockGetAllDownloads.mockResolvedValueOnce([errorStatus]);
    await checkDownloadStatus(); // errors = 2

    // Recovery — error counter should reset
    mockGetAllDownloads.mockResolvedValueOnce([downloadingStatus]);
    await checkDownloadStatus(); // recovers, counter reset to 0

    // Two more errors after recovery — still below threshold
    mockGetAllDownloads.mockResolvedValueOnce([errorStatus]);
    await checkDownloadStatus(); // errors = 1 again

    mockGetAllDownloads.mockResolvedValueOnce([errorStatus]);
    await checkDownloadStatus(); // errors = 2

    // Should NOT have marked as failed (only 2 consecutive errors since recovery)
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalledWith(baseDownload.id, "failed");
    expect(mockUpdateGameStatus).not.toHaveBeenCalledWith(baseDownload.gameId, {
      status: "wanted",
    });
  });
});
