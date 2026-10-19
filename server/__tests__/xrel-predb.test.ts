import { describe, it, expect, vi, beforeEach } from "vitest";

const searchReleases = vi.fn();
vi.mock("../xrel.js", () => ({
  xrelClient: { searchReleases: (...a: unknown[]) => searchReleases(...a) },
}));
vi.mock("../storage.js", () => ({
  storage: { getSystemConfig: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { getXrelPredb, clearXrelPredbCache, xrelEnabledFor } = await import("../xrel-predb.js");

describe("getXrelPredb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearXrelPredbCache();
  });

  it("maps releases to dirname and nuke reason", async () => {
    searchReleases.mockResolvedValue([
      { dirname: "Game-CODEX", nukeReason: "dupe" },
      { dirname: "Game-FLT" },
    ]);
    expect(await getXrelPredb("Game")).toEqual([
      { dirname: "Game-CODEX", nukeReason: "dupe" },
      { dirname: "Game-FLT" },
    ]);
    expect(searchReleases).toHaveBeenCalledWith(
      "Game",
      expect.objectContaining({ scene: true, p2p: true, limit: 100 })
    );
  });

  it("passes only the enabled release types and caches them apart", async () => {
    searchReleases.mockResolvedValue([]);
    await getXrelPredb("Game", { scene: true, p2p: false });
    await getXrelPredb("Game", { scene: false, p2p: true });
    expect(searchReleases).toHaveBeenNthCalledWith(
      1,
      "Game",
      expect.objectContaining({ scene: true, p2p: false })
    );
    expect(searchReleases).toHaveBeenNthCalledWith(
      2,
      "Game",
      expect.objectContaining({ scene: false, p2p: true })
    );
    expect(await getXrelPredb("Game", { scene: false, p2p: false })).toBeUndefined();
    expect(searchReleases).toHaveBeenCalledTimes(2);
  });

  it("gives up waiting after the timeout but keeps the lookup for the next caller", async () => {
    vi.useFakeTimers();
    try {
      let resolveSearch: (value: { dirname: string }[]) => void = () => {};
      searchReleases.mockReturnValue(new Promise((resolve) => (resolveSearch = resolve)));
      const first = getXrelPredb("Slow Game", { scene: true, p2p: true }, { timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      expect(await first).toBeUndefined();
      resolveSearch([{ dirname: "Slow.Game-CODEX" }]);
      expect(await getXrelPredb("Slow Game")).toEqual([{ dirname: "Slow.Game-CODEX" }]);
      expect(searchReleases).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one call between parallel and repeated lookups of a title", async () => {
    searchReleases.mockResolvedValue([{ dirname: "Game-CODEX" }]);
    await Promise.all([getXrelPredb("Game"), getXrelPredb("game!")]);
    await getXrelPredb("Game");
    expect(searchReleases).toHaveBeenCalledTimes(1);
  });

  it("keeps the cache bounded and drops the oldest titles first", async () => {
    searchReleases.mockResolvedValue([]);
    for (let i = 0; i < 205; i++) await getXrelPredb(`Game number ${i} alpha`);
    expect(searchReleases).toHaveBeenCalledTimes(205);
    // the newest title is still cached, the oldest was evicted
    await getXrelPredb("Game number 204 alpha");
    expect(searchReleases).toHaveBeenCalledTimes(205);
    await getXrelPredb("Game number 0 alpha");
    expect(searchReleases).toHaveBeenCalledTimes(206);
  });

  it("returns undefined on failure and tries again next time", async () => {
    searchReleases.mockRejectedValueOnce(new Error("rate limit"));
    expect(await getXrelPredb("Game")).toBeUndefined();
    searchReleases.mockResolvedValueOnce([{ dirname: "Game-CODEX" }]);
    expect(await getXrelPredb("Game")).toEqual([{ dirname: "Game-CODEX" }]);
  });

  it("is only used when an xREL feature is on", () => {
    expect(xrelEnabledFor({ xrelSceneReleases: true, xrelP2pReleases: false })).toBe(true);
    expect(xrelEnabledFor({ xrelSceneReleases: false, xrelP2pReleases: false })).toBe(false);
    expect(xrelEnabledFor(undefined)).toBe(false);
  });
});
