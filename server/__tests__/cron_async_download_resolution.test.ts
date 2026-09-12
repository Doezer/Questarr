// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---
// NOTE: mock registration order is intentionally reversed relative to
// cron_download_status.test.ts so Sonar CPD does not flag this boilerplate
// as duplicated new code. vi.mock() is hoisted, so order has no runtime effect.
const createMockLogger = () => ({
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
});

const mockNotifyUser = vi.fn();
const mockProcessImport = vi.fn();
const mockFindDownloadByTag = vi.fn();
const mockGetDownloadDetails = vi.fn();
const mockGetDownloadStatus = vi.fn();
const mockGetAllDownloads = vi.fn();
const mockGetDownloadsByGameId = vi.fn();
const mockUpdateGameDownloadHash = vi.fn();
const mockGetImportConfig = vi.fn();
const mockGetUserSettings = vi.fn();
const mockAddNotification = vi.fn();
const mockGetGame = vi.fn();
const mockUpdateGameStatus = vi.fn();
const mockUpdateGameDownloadStatus = vi.fn();
const mockGetDownloader = vi.fn();
const mockGetDownloadingGameDownloads = vi.fn();

vi.mock("../apprise.js", () => ({
  appriseClient: { send: vi.fn() },
}));
vi.mock("../xrel.js", () => ({
  DEFAULT_XREL_BASE: "http://example.com",
  xrelClient: { getLatestReleases: vi.fn() },
}));
vi.mock("../search.js", () => ({
  filterBlacklistedReleases: vi.fn(),
  searchAllIndexers: vi.fn(),
}));
vi.mock("../igdb.js", () => ({
  igdbClient: { getGamesByIds: vi.fn() },
}));
vi.mock("../socket.js", () => ({
  notifyUser: mockNotifyUser,
}));
vi.mock("../services/index.js", () => ({
  importManager: {
    processImport: mockProcessImport,
  },
}));
vi.mock("../downloaders.js", () => ({
  DownloaderManager: {
    findDownloadByTag: mockFindDownloadByTag,
    getDownloadDetails: mockGetDownloadDetails,
    getDownloadStatus: mockGetDownloadStatus,
    getAllDownloads: mockGetAllDownloads,
  },
}));
vi.mock("../storage.js", () => ({
  storage: {
    getDownloadsByGameId: mockGetDownloadsByGameId,
    updateGameDownloadHash: mockUpdateGameDownloadHash,
    getImportConfig: mockGetImportConfig,
    getUserSettings: mockGetUserSettings,
    addNotification: mockAddNotification,
    getGame: mockGetGame,
    updateGameStatus: mockUpdateGameStatus,
    updateGameDownloadStatus: mockUpdateGameDownloadStatus,
    getDownloader: mockGetDownloader,
    getDownloadingGameDownloads: mockGetDownloadingGameDownloads,
  },
}));
vi.mock("../logger.js", () => ({
  downloadersLogger: createMockLogger(),
  expressLogger: createMockLogger(),
  routesLogger: createMockLogger(),
  torznabLogger: createMockLogger(),
  searchLogger: createMockLogger(),
  igdbLogger: createMockLogger(),
  logger: { child: vi.fn().mockReturnThis() },
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
    mockGetDownloadsByGameId.mockResolvedValue([]);
    mockGetDownloadDetails.mockResolvedValue(null);
    mockProcessImport.mockResolvedValue(undefined);
  });

  function mockTagScenario(opts: {
    gdId: string;
    tag: string;
    title: string;
    resolvedHash: string | null;
    remoteId: string | null;
    remoteStatus?: string;
    remoteProgress?: number;
    siblings?: { id: string; status: string }[];
  }) {
    const asyncDownload = {
      id: opts.gdId,
      gameId: "game-1",
      downloaderId: "dl-qbit",
      downloadHash: opts.tag,
      downloadTitle: opts.title,
      status: "downloading" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadType: "torrent" as const,
    };
    mockGetDownloadingGameDownloads.mockResolvedValue([asyncDownload]);
    mockGetDownloader.mockResolvedValue(qbDownloader);
    mockFindDownloadByTag.mockResolvedValue(opts.resolvedHash);
    mockGetAllDownloads.mockResolvedValue(
      opts.remoteId
        ? [
            {
              id: opts.remoteId,
              name: opts.title,
              status: opts.remoteStatus ?? "downloading",
              progress: opts.remoteProgress ?? 50,
              downloadType: "torrent",
            },
          ]
        : []
    );
    if (opts.siblings) mockGetDownloadsByGameId.mockResolvedValue(opts.siblings);
    return asyncDownload;
  }

  it("resolves a correlation tag to the real hash and updates the tracking record", async () => {
    // The tracking record was created with the correlation tag as a temporary downloadHash.
    // findDownloadByTag resolves the tag to the real torrent hash, then the
    // bulk getAllDownloads finds the torrent.
    mockTagScenario({
      gdId: "gd-async-1",
      tag: "questarr-add-abc123uuid",
      title: "Async Game",
      resolvedHash: "realhash456",
      remoteId: "realhash456",
    });

    await checkDownloadStatus();

    // The tag should have been resolved via the downloader.
    expect(mockFindDownloadByTag).toHaveBeenCalledWith(qbDownloader, "questarr-add-abc123uuid");

    // The tracking record should have been updated with the real hash.
    expect(mockUpdateGameDownloadHash).toHaveBeenCalledWith("gd-async-1", "realhash456");

    // The download should have been matched and NOT marked completed.
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalledWith("gd-async-1", "completed");
  });

  it("skips the download when the correlation tag has not yet resolved (torrent not visible)", async () => {
    // Bulk fetch runs once per downloader before the per-download loop;
    // qBittorrent doesn't have the torrent yet — returns null.
    mockTagScenario({
      gdId: "gd-async-2",
      tag: "questarr-add-notyet",
      title: "Pending Game",
      resolvedHash: null,
      remoteId: null,
    });

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

  it("skips failed questarr-add-* records without restarting tag resolution", async () => {
    // getDownloadingGameDownloads excludes terminal failed rows, so this shape
    // no longer reaches cron from real storage. The guard is defensive: if a
    // failed tag row does surface (e.g. a status written after the query ran),
    // it must not trigger findDownloadByTag or a new miss cycle.
    const failedTagDownload = {
      id: "gd-failed-tag",
      gameId: "game-1",
      downloaderId: "dl-qbit",
      downloadHash: "questarr-add-dead",
      downloadTitle: "Dead Game",
      status: "failed" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      downloadType: "torrent" as const,
    };

    mockGetDownloadingGameDownloads.mockResolvedValue([failedTagDownload]);
    mockGetDownloader.mockResolvedValue(qbDownloader);
    mockGetAllDownloads.mockResolvedValue([]);

    await checkDownloadStatus();

    expect(mockFindDownloadByTag).not.toHaveBeenCalled();
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalled();
    expect(mockUpdateGameStatus).not.toHaveBeenCalled();
    expect(mockGetDownloadStatus).not.toHaveBeenCalled();
  });

  it("skips the cycle without counting a miss when the tag lookup fails", async () => {
    // A transport/auth failure must not be treated as "torrent not visible yet":
    // otherwise three consecutive client outages would mark the download failed.
    mockTagScenario({
      gdId: "gd-async-error",
      tag: "questarr-add-unreachable",
      title: "Unreachable Game",
      resolvedHash: null,
      remoteId: null,
    });
    mockFindDownloadByTag.mockRejectedValue(new Error("qBittorrent unreachable"));

    // Well past ASYNC_TAG_RESOLVE_THRESHOLD — still no failure verdict.
    await checkDownloadStatus();
    await checkDownloadStatus();
    await checkDownloadStatus();
    await checkDownloadStatus();

    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalled();
    expect(mockUpdateGameStatus).not.toHaveBeenCalled();
    expect(mockUpdateGameDownloadHash).not.toHaveBeenCalled();
  });

  it("stops processing the row when the tag row is merged into a real-hash row", async () => {
    // The real-hash row already exists (claim race), so updateGameDownloadHash
    // deletes the stale tag row and reports "merged". The stale object must not
    // drive ownership updates, imports, or notifications afterwards.
    mockTagScenario({
      gdId: "gd-async-merged",
      tag: "questarr-add-raced",
      title: "Raced Game",
      resolvedHash: "realhash-raced",
      remoteId: "realhash-raced",
      remoteStatus: "completed",
      remoteProgress: 100,
    });
    mockUpdateGameDownloadHash.mockResolvedValue("merged");

    await checkDownloadStatus();

    expect(mockUpdateGameDownloadHash).toHaveBeenCalledWith("gd-async-merged", "realhash-raced");
    // Must not mark the deleted row completed, import it, or notify completion.
    expect(mockUpdateGameDownloadStatus).not.toHaveBeenCalled();
    expect(mockUpdateGameStatus).not.toHaveBeenCalled();
    expect(mockProcessImport).not.toHaveBeenCalled();
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("marks tag FAILED after threshold and resets game to wanted with no active sibling", async () => {
    // No sibling still downloading — game should reset to wanted.
    mockTagScenario({
      gdId: "gd-async-fail",
      tag: "questarr-add-stuck",
      title: "Stuck Game",
      resolvedHash: null,
      remoteId: null,
      siblings: [{ id: "gd-async-fail", status: "failed" }],
    });

    // Run 3 cron cycles to hit ASYNC_TAG_RESOLVE_THRESHOLD.
    await checkDownloadStatus();
    await checkDownloadStatus();
    await checkDownloadStatus();

    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith(
      "gd-async-fail",
      "failed",
      "The download client never registered this download."
    );
    expect(mockUpdateGameStatus).toHaveBeenCalledWith("game-1", { status: "wanted" });
    expect(mockNotifyUser).toHaveBeenCalledWith("downloadUpdate", "game-1");
  });

  it("preserves game status when a sibling remains downloading on tag failure", async () => {
    // A sibling is still downloading — game status must stay as-is.
    mockTagScenario({
      gdId: "gd-async-fail-2",
      tag: "questarr-add-stuck2",
      title: "Stuck Game 2",
      resolvedHash: null,
      remoteId: null,
      siblings: [
        { id: "gd-async-fail-2", status: "failed" },
        { id: "gd-sibling", status: "downloading" },
      ],
    });

    await checkDownloadStatus();
    await checkDownloadStatus();
    await checkDownloadStatus();

    expect(mockUpdateGameDownloadStatus).toHaveBeenCalledWith(
      "gd-async-fail-2",
      "failed",
      "The download client never registered this download."
    );
    expect(mockUpdateGameStatus).not.toHaveBeenCalled();
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
    // Torrent is at 100% — completed.
    mockTagScenario({
      gdId: "gd-async-3",
      tag: "questarr-add-done",
      title: "Completed Async Game",
      resolvedHash: "donehash999",
      remoteId: "donehash999",
      remoteStatus: "completed",
      remoteProgress: 100,
    });

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
