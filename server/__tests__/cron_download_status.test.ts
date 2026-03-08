import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getDownloadingGameDownloads: vi.fn(),
  getDownloader: vi.fn(),
  updateGameDownloadStatus: vi.fn(),
  updateGameStatus: vi.fn(),
  addNotification: vi.fn(),
  getGame: vi.fn(),
};

const mockDownloaderManager = {
  getAllDownloads: vi.fn(),
  getDownloadDetails: vi.fn(),
};

const mockImportManager = {
  processImport: vi.fn(),
};

const mockNotifyUser = vi.fn();

vi.mock("../storage.js", () => ({
  storage: mockStorage,
}));

vi.mock("../downloaders.js", () => ({
  DownloaderManager: mockDownloaderManager,
}));

vi.mock("../services/index.js", () => ({
  importManager: mockImportManager,
}));

vi.mock("../socket.js", () => ({
  notifyUser: mockNotifyUser,
}));

vi.mock("../logger.js", () => ({
  logger: {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  igdbLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../igdb.js", () => ({
  igdbClient: {
    getGamesByIds: vi.fn(),
    getGameIdsBySteamAppIds: vi.fn(),
    formatGameData: vi.fn(),
  },
}));

vi.mock("../search.js", () => ({
  searchAllIndexers: vi.fn(),
}));

vi.mock("../xrel.js", () => ({
  xrelClient: {
    getLatestReleases: vi.fn(),
  },
  DEFAULT_XREL_BASE: "https://xrel.example",
}));

vi.mock("../steam.js", () => ({
  steamService: {
    getWishlist: vi.fn(),
  },
}));

describe("checkDownloadStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([]);
    mockStorage.getDownloader.mockResolvedValue({ id: "dl-1", enabled: true });
    mockStorage.addNotification.mockResolvedValue({ id: "notif-1" });
    mockStorage.getGame.mockResolvedValue({ id: "game-1", title: "Game One" });

    mockDownloaderManager.getAllDownloads.mockResolvedValue([]);
    mockDownloaderManager.getDownloadDetails.mockResolvedValue(null);
  });

  it("delegates completed downloads to importManager when details are available", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-1",
        gameId: "game-1",
        downloaderId: "dl-1",
        downloadHash: "HASH-ABC",
        downloadTitle: "Game One",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      {
        id: "hash-abc",
        status: "seeding",
        progress: 100,
      },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "Game One",
    });

    await checkDownloadStatus();

    expect(mockImportManager.processImport).toHaveBeenCalledWith("gd-1", "/downloads/Game One");
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalledWith("gd-1", "completed");
    expect(mockStorage.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Download Completed",
        message: "Download finished for Game One",
      })
    );
    expect(mockNotifyUser).toHaveBeenCalledWith("notification", { id: "notif-1" });
  });

  it("falls back to completed/owned when completed download has no path details", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-2",
        gameId: "game-2",
        downloaderId: "dl-1",
        downloadHash: "HASH-XYZ",
        downloadTitle: "Game Two",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      {
        id: "hash-xyz",
        status: "completed",
        progress: 100,
      },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue(null);

    await checkDownloadStatus();

    expect(mockImportManager.processImport).not.toHaveBeenCalled();
    expect(mockStorage.updateGameDownloadStatus).toHaveBeenCalledWith("gd-2", "completed");
    expect(mockStorage.updateGameStatus).toHaveBeenCalledWith("game-2", { status: "owned" });
  });
});
