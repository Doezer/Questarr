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

  it("shares one call between parallel and repeated lookups of a title", async () => {
    searchReleases.mockResolvedValue([{ dirname: "Game-CODEX" }]);
    await Promise.all([getXrelPredb("Game"), getXrelPredb("game!")]);
    await getXrelPredb("Game");
    expect(searchReleases).toHaveBeenCalledTimes(1);
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
