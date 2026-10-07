import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCronJobs } from "../cron.js";
import { rssService } from "../rss.js";

vi.mock("../storage.js");
vi.mock("../socket.js");
vi.mock("../rss.js", () => ({
  rssService: { refreshFeeds: vi.fn().mockResolvedValue(undefined) },
}));
// the startup xREL check must not reach the network
vi.mock("../xrel.js", () => ({
  DEFAULT_XREL_BASE: "https://xrel-api.nfos.to",
  xrelClient: { getLatestReleases: vi.fn().mockResolvedValue({ list: [] }) },
}));
vi.mock("../logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: mockLogger,
    igdbLogger: mockLogger,
    routesLogger: mockLogger,
    expressLogger: mockLogger,
    downloadersLogger: mockLogger,
    torznabLogger: mockLogger,
    searchLogger: mockLogger,
  };
});

describe("startCronJobs RSS refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("refreshes RSS feeds shortly after startup and then every hour", async () => {
    startCronJobs();
    expect(rssService.refreshFeeds).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rssService.refreshFeeds).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(rssService.refreshFeeds).toHaveBeenCalledTimes(2);
  });

  it("keeps the schedule running when a refresh fails", async () => {
    vi.mocked(rssService.refreshFeeds).mockRejectedValue(new Error("feed down"));
    startCronJobs();

    await vi.advanceTimersByTimeAsync(10_000 + 2 * 60 * 60 * 1000);
    expect(rssService.refreshFeeds).toHaveBeenCalledTimes(3);
  });
});
