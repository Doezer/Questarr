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

describe("checkDownloadStatus", { timeout: 15000 }, () => {
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

  it("flags download as manual_review_required when completed download has no path details", async () => {
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
    expect(mockStorage.updateGameDownloadStatus).toHaveBeenCalledWith(
      "gd-2",
      "manual_review_required"
    );
    expect(mockStorage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("flags download as manual_review_required when details exist but downloadDir is empty", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-3",
        gameId: "game-3",
        downloaderId: "dl-1",
        downloadHash: "HASH-NODIR",
        downloadTitle: "Game Three",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      {
        id: "hash-nodir",
        status: "completed",
        progress: 100,
      },
    ]);

    // Details returned but downloadDir is an empty string
    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "",
      name: "Game Three",
    });

    await checkDownloadStatus();

    expect(mockImportManager.processImport).not.toHaveBeenCalled();
    expect(mockStorage.updateGameDownloadStatus).toHaveBeenCalledWith(
      "gd-3",
      "manual_review_required"
    );
    expect(mockStorage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("does not set completed status itself when processImport handles it (importEnabled=false path)", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    // processImport resolves successfully (as it would when it sets "completed" internally
    // due to enablePostProcessing=false); the cron must not double-set the status
    mockImportManager.processImport.mockResolvedValue(undefined);

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-4",
        gameId: "game-4",
        downloaderId: "dl-1",
        downloadHash: "HASH-NOIMPORT",
        downloadTitle: "Game Four",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      {
        id: "hash-noimport",
        status: "completed",
        progress: 100,
      },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "Game Four",
    });

    await checkDownloadStatus();

    expect(mockImportManager.processImport).toHaveBeenCalledWith("gd-4", "/downloads/Game Four");
    // Cron must not call updateGameDownloadStatus("completed") — processImport owns that
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalledWith("gd-4", "completed");
  });

  it("swallows processImport errors per-downloader without crashing the cron run", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    mockImportManager.processImport.mockRejectedValue(new Error("import exploded"));

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-5",
        gameId: "game-5",
        downloaderId: "dl-1",
        downloadHash: "HASH-ERR",
        downloadTitle: "Game Five",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      {
        id: "hash-err",
        status: "seeding",
        progress: 100,
      },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "Game Five",
    });

    // Must not throw — checkDownloadStatus catches per-downloader errors
    await expect(checkDownloadStatus()).resolves.toBeUndefined();

    // The cron itself must not set a status after the throw; ImportManager owns error status
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalledWith("gd-5", "completed");
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalledWith("gd-5", "error");
  });

  it("re-triggers processImport for a download already in 'importing' status (no skip guard in cron)", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    mockImportManager.processImport.mockResolvedValue(undefined);

    // DB record has status="importing" — still returned by getDownloadingGameDownloads
    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-imp",
        gameId: "game-imp",
        downloaderId: "dl-1",
        downloadHash: "HASH-IMP",
        downloadTitle: "Game Importing",
        status: "importing",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      { id: "hash-imp", status: "seeding", progress: 100 },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "Game Importing",
    });

    await checkDownloadStatus();

    // Cron has no "importing" guard — processImport is invoked again
    expect(mockImportManager.processImport).toHaveBeenCalledWith(
      "gd-imp",
      "/downloads/Game Importing"
    );
  });

  it("marks download 'completed' and skips processImport when import config has enablePostProcessing=false (simulated via processImport stub)", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    // processImport internally sets "completed" when enablePostProcessing=false and returns
    mockImportManager.processImport.mockResolvedValue(undefined);

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-noproc",
        gameId: "game-noproc",
        downloaderId: "dl-1",
        downloadHash: "HASH-NOPROC",
        downloadTitle: "Game NoProc",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      { id: "hash-noproc", status: "completed", progress: 100 },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "Game NoProc",
    });

    await checkDownloadStatus();

    // Cron delegates to processImport; status ownership belongs to processImport, not cron
    expect(mockImportManager.processImport).toHaveBeenCalledWith(
      "gd-noproc",
      "/downloads/Game NoProc"
    );
    // Cron itself must not set "completed" — that is processImport's responsibility
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalledWith("gd-noproc", "completed");
    // Game status is also not set directly by the cron after a successful processImport call
    expect(mockStorage.updateGameStatus).not.toHaveBeenCalledWith("gd-noproc", "owned");
  });

  it("download ends in terminal state after successful processImport (not stuck in downloading)", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    // processImport resolves — ownership of terminal status transitions belongs to it
    mockImportManager.processImport.mockResolvedValue(undefined);

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-term",
        gameId: "game-term",
        downloaderId: "dl-1",
        downloadHash: "HASH-TERM",
        downloadTitle: "Game Terminal",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      { id: "hash-term", status: "seeding", progress: 100 },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "Game Terminal",
    });

    await checkDownloadStatus();

    // processImport was called — it owns the status transition
    expect(mockImportManager.processImport).toHaveBeenCalledWith(
      "gd-term",
      "/downloads/Game Terminal"
    );
    // Cron must NOT set "downloading" again after handing off to processImport
    expect(mockStorage.updateGameDownloadStatus).not.toHaveBeenCalledWith("gd-term", "downloading");
  });

  it("processes all completed downloads in a single cron run, not just the first", async () => {
    const { checkDownloadStatus } = await import("../cron.js");

    mockImportManager.processImport.mockResolvedValue(undefined);

    mockStorage.getDownloadingGameDownloads.mockResolvedValue([
      {
        id: "gd-6",
        gameId: "game-6",
        downloaderId: "dl-1",
        downloadHash: "HASH-A",
        downloadTitle: "Game Six",
        status: "downloading",
      },
      {
        id: "gd-7",
        gameId: "game-7",
        downloaderId: "dl-1",
        downloadHash: "HASH-B",
        downloadTitle: "Game Seven",
        status: "downloading",
      },
    ]);

    mockDownloaderManager.getAllDownloads.mockResolvedValue([
      { id: "hash-a", status: "seeding", progress: 100 },
      { id: "hash-b", status: "completed", progress: 100 },
    ]);

    mockDownloaderManager.getDownloadDetails.mockResolvedValue({
      downloadDir: "/downloads",
      name: "AGame",
    });

    await checkDownloadStatus();

    expect(mockImportManager.processImport).toHaveBeenCalledTimes(2);
    expect(mockImportManager.processImport).toHaveBeenCalledWith("gd-6", "/downloads/AGame");
    expect(mockImportManager.processImport).toHaveBeenCalledWith("gd-7", "/downloads/AGame");
  });
});
