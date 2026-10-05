import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
const notifyUser = vi.fn();
vi.mock("../socket.js", () => ({ notifyUser }));

const { recordVersionFromCompletedDownload } = await import("../game-version.js");

describe("recordVersionFromCompletedDownload", () => {
  const replaceGameInstalledVersion = vi.fn();
  const getGame = vi.fn();
  const store = { getGame, replaceGameInstalledVersion };
  const record = (installedVersion: string | null, title: string) => {
    getGame.mockResolvedValue({ id: "g1", installedVersion });
    return recordVersionFromCompletedDownload(store, "g1", title);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    replaceGameInstalledVersion.mockResolvedValue(true);
  });

  it("records the version of a finished full-game download when none is known", async () => {
    const recorded = await record(null, "Test.Game.v1.2.3-RUNE");
    expect(recorded).toBe("v1.2.3");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith("g1", null, "v1.2.3");
    expect(notifyUser).toHaveBeenCalledWith("gameUpdated", "g1");
  });

  it("moves the version forward on a newer update", async () => {
    await record("v1.2", "Test.Game.v1.2.Update.v1.3-RUNE");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith("g1", "v1.2", "v1.3");
  });

  it("never moves the version backwards or across numbering schemes", async () => {
    await record("v1.5", "Test.Game.Update.v1.3-RUNE");
    await record("Build 1234", "Test.Game.v1.3-RUNE");
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });

  it("ignores DLC releases and releases without a version", async () => {
    await record(null, "Test.Game.Season.Pass.DLC.v2.0-RUNE");
    await record(null, "Test.Game-RUNE");
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });

  it("takes the version from full-game editions, even those bundling DLC", async () => {
    expect(await record(null, "Test.Game.Deluxe.Edition.v1.4-RUNE")).toBe("v1.4");
    expect(await record(null, "Test.Game.GOTY.v2.0.incl.DLC-GOG")).toBe("v2.0");
    expect(await record(null, "Test.Game.Complete.Edition.v3.1-RUNE")).toBe("v3.1");
  });

  it("does not notify when the version changed before the write", async () => {
    replaceGameInstalledVersion.mockResolvedValue(false);
    expect(await record("v1.0", "Test.Game.Update.v1.1-RUNE")).toBeNull();
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("compares against the current row, not the caller's snapshot", async () => {
    // The user moved to v2.0 while the v1.5 import was running.
    expect(await record("v2.0", "Test.Game.v1.5-RUNE")).toBeNull();
    expect(getGame).toHaveBeenCalledWith("g1");
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });

  it("swallows storage failures", async () => {
    replaceGameInstalledVersion.mockRejectedValue(new Error("db down"));
    await expect(record(null, "Test.Game.v1.0-RUNE")).resolves.toBeNull();
  });
});
