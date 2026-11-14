import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
const notifyUser = vi.fn();
vi.mock("../socket.js", () => ({ notifyUser }));

const { recordVersionFromCompletedDownload, recordVersionFromInstallFolder } =
  await import("../game-version.js");

describe("recordVersionFromCompletedDownload", () => {
  const replaceGameInstalledVersion = vi.fn();
  const getGame = vi.fn();
  const store = { getGame, replaceGameInstalledVersion };
  const record = (installedVersion: string | null, title: string) => {
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion,
      installedVersionSource: installedVersion ? "release" : null,
    });
    return recordVersionFromCompletedDownload(store, "g1", title);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    replaceGameInstalledVersion.mockResolvedValue(true);
  });

  it("records the version of a finished full-game download when none is known", async () => {
    const recorded = await record(null, "Test.Game.v1.2.3-RUNE");
    expect(recorded).toBe("v1.2.3");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith(
      "g1",
      null,
      "v1.2.3",
      "release",
      false
    );
    expect(notifyUser).toHaveBeenCalledWith("gameUpdated", "g1");
  });

  it("never overwrites a version the user typed with an older or incomparable one", async () => {
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion: "v2.0",
      installedVersionSource: "manual",
    });
    expect(await recordVersionFromCompletedDownload(store, "g1", "Game.v1.5-RUNE")).toBeNull();
    expect(await recordVersionFromCompletedDownload(store, "g1", "Game.v2.0-RUNE")).toBeNull();
    expect(
      await recordVersionFromCompletedDownload(store, "g1", "Game.Build.1234-RUNE")
    ).toBeNull();
    // A value with no source recorded predates tracking: it was typed.
    getGame.mockResolvedValue({ id: "g1", installedVersion: "v2.0", installedVersionSource: null });
    expect(await recordVersionFromCompletedDownload(store, "g1", "Game.v1.5-RUNE")).toBeNull();
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });

  it("moves a version the user typed forward when a download is strictly newer", async () => {
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion: "v1.0",
      installedVersionSource: "manual",
    });
    expect(await recordVersionFromCompletedDownload(store, "g1", "game.update.v2.0")).toBe("v2.0");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith("g1", "v1.0", "v2.0", "release", true);
    // A legacy value with no source counts as typed too.
    replaceGameInstalledVersion.mockClear();
    getGame.mockResolvedValue({ id: "g1", installedVersion: "v1.0", installedVersionSource: null });
    expect(await recordVersionFromCompletedDownload(store, "g1", "Game.v1.1-RUNE")).toBe("v1.1");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith("g1", "v1.0", "v1.1", "release", true);
  });

  it("moves the version forward on a newer update", async () => {
    await record("v1.2", "Test.Game.v1.2.Update.v1.3-RUNE");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith(
      "g1",
      "v1.2",
      "v1.3",
      "release",
      false
    );
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

  it("trusts the category the user picked over the title", async () => {
    getGame.mockResolvedValue({ id: "g1", installedVersion: null });
    // Claimed as DLC although the title reads like the base game.
    expect(
      await recordVersionFromCompletedDownload(store, "g1", "Expansion.Name.v5.0", "dlc")
    ).toBeNull();
    // Claimed as the main game although the title mentions DLC.
    expect(
      await recordVersionFromCompletedDownload(store, "g1", "Game.Season.Pass.DLC.v2.0", "main")
    ).toBe("v2.0");
  });

  it("does not notify when the version changed before the write", async () => {
    replaceGameInstalledVersion.mockResolvedValue(false);
    expect(await record("v1.0", "Test.Game.Update.v1.1-RUNE")).toBeNull();
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("compares again after losing the write to a concurrent older import", async () => {
    // A v1.2 import wrote between this v1.3 import's read and its write.
    getGame
      .mockResolvedValueOnce({
        id: "g1",
        installedVersion: "v1.0",
        installedVersionSource: "release",
      })
      .mockResolvedValueOnce({
        id: "g1",
        installedVersion: "v1.2",
        installedVersionSource: "release",
      });
    replaceGameInstalledVersion.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const recorded = await recordVersionFromCompletedDownload(store, "g1", "Game.Update.v1.3-RUNE");
    expect(recorded).toBe("v1.3");
    expect(replaceGameInstalledVersion).toHaveBeenLastCalledWith(
      "g1",
      "v1.2",
      "v1.3",
      "release",
      false
    );
    expect(notifyUser).toHaveBeenCalledWith("gameUpdated", "g1");
  });

  it("stops when a concurrent import already wrote a newer version", async () => {
    getGame
      .mockResolvedValueOnce({
        id: "g1",
        installedVersion: "v1.0",
        installedVersionSource: "release",
      })
      .mockResolvedValueOnce({
        id: "g1",
        installedVersion: "v1.4",
        installedVersionSource: "release",
      });
    replaceGameInstalledVersion.mockResolvedValueOnce(false);
    expect(
      await recordVersionFromCompletedDownload(store, "g1", "Game.Update.v1.3-RUNE")
    ).toBeNull();
    expect(replaceGameInstalledVersion).toHaveBeenCalledTimes(1);
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

describe("recordVersionFromInstallFolder", () => {
  const replaceGameInstalledVersion = vi.fn();
  const getGame = vi.fn();
  const store = { getGame, replaceGameInstalledVersion };
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    replaceGameInstalledVersion.mockResolvedValue(true);
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "install-version-"));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("records the version read from the install files, over a release's", async () => {
    await fs.promises.writeFile(path.join(dir, "version.txt"), "1.4.2\n");
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion: "v1.0",
      installedVersionSource: "release",
    });
    expect(await recordVersionFromInstallFolder(store, "g1", dir)).toBe("v1.4.2");
    expect(replaceGameInstalledVersion).toHaveBeenCalledWith("g1", "v1.0", "v1.4.2", "install");
  });

  it("leaves a version the user typed alone", async () => {
    await fs.promises.writeFile(path.join(dir, "version.txt"), "1.4.2");
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion: "v1.0",
      installedVersionSource: "manual",
    });
    expect(await recordVersionFromInstallFolder(store, "g1", dir)).toBeNull();
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });

  it("never moves a comparable version backwards (patch not applied to the folder yet)", async () => {
    await fs.promises.writeFile(path.join(dir, "version.txt"), "1.0");
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion: "v1.3",
      installedVersionSource: "release",
    });
    expect(await recordVersionFromInstallFolder(store, "g1", dir)).toBeNull();
    // An incomparable one (build id against a dotted version) still replaces it.
    await fs.promises.writeFile(path.join(dir, "version.txt"), "Build 55");
    expect(await recordVersionFromInstallFolder(store, "g1", dir)).toBe("Build 55");
  });

  it("does nothing when the version is already recorded from the files", async () => {
    await fs.promises.writeFile(path.join(dir, "version.txt"), "1.4.2");
    getGame.mockResolvedValue({
      id: "g1",
      installedVersion: "v1.4.2",
      installedVersionSource: "install",
    });
    expect(await recordVersionFromInstallFolder(store, "g1", dir)).toBeNull();
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });

  it("does nothing for a folder without version files or a missing folder", async () => {
    getGame.mockResolvedValue({ id: "g1", installedVersion: null, installedVersionSource: null });
    expect(await recordVersionFromInstallFolder(store, "g1", dir)).toBeNull();
    expect(await recordVersionFromInstallFolder(store, "g1", path.join(dir, "nope"))).toBeNull();
    expect(await recordVersionFromInstallFolder(store, "g1", null)).toBeNull();
    expect(replaceGameInstalledVersion).not.toHaveBeenCalled();
  });
});
