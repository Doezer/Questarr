import { describe, expect, it, vi } from "vitest";

const { recordVersion } = vi.hoisted(() => ({ recordVersion: vi.fn() }));
vi.mock("../game-version.js", () => ({ recordVersionFromCompletedDownload: recordVersion }));

import {
  applyDeliveredStatus,
  applyFailureStatus,
  hasMainReleaseInFlight,
  mainReleaseGate,
  recordDeliveredVersion,
  replayAfterMainFailure,
} from "../main-release-gate.js";

const patch = { id: "patch", gameId: "g1", category: "update" };

function storageWith(
  siblings: { id: string; category: string | null; status: string; downloadTitle?: string }[]
) {
  return {
    getDownloadsByGameId: vi.fn().mockResolvedValue(siblings),
    updateGameStatus: vi.fn().mockResolvedValue(undefined),
    getGame: vi.fn().mockResolvedValue(undefined),
    replaceGameInstalledVersion: vi.fn(),
  };
}

describe("mainReleaseGate", () => {
  it("never gates a main release when no other main is on its way", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "failed" }]);
    expect(await mainReleaseGate(storage, { ...patch, category: "main" })).toBe("none");
  });

  it("waits for another main release still downloading, even for a main itself", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "downloading" }]);
    expect(await mainReleaseGate(storage, { ...patch, category: "main" })).toBe("active");
    expect(
      await mainReleaseGate(storage, {
        id: "full",
        gameId: "g1",
        category: null,
        downloadTitle: "Some.Game-GROUP",
      })
    ).toBe("active");
  });

  it("is active while a main release is on its way", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "downloading" }]);
    expect(await mainReleaseGate(storage, patch)).toBe("active");
  });

  it("is failed when every main release failed", async () => {
    const storage = storageWith([
      { id: "m1", category: "main", status: "failed" },
      { id: "m2", category: "main", status: "error" },
    ]);
    expect(await mainReleaseGate(storage, patch)).toBe("failed");
  });

  it("stays active while a newer main release is on its way, even after an older one was delivered", async () => {
    const storage = storageWith([
      { id: "m1", category: "main", status: "imported" },
      { id: "m2", category: "main", status: "downloading" },
    ]);
    expect(await mainReleaseGate(storage, patch)).toBe("active");
  });

  it("classifies a download without a stored category by its release name", async () => {
    const storage = storageWith([
      { id: "old", category: "main", status: "failed" },
      { id: "full", category: null, status: "downloading", downloadTitle: "Some.Game-GROUP" },
    ]);
    expect(await mainReleaseGate(storage, patch)).toBe("active");
    expect(
      await mainReleaseGate(storage, {
        id: "full",
        gameId: "g1",
        category: null,
        downloadTitle: "Some.Game-GROUP",
      })
    ).toBe("none");
  });

  it("is none once a main release was delivered, or when the game has none", async () => {
    expect(
      await mainReleaseGate(
        storageWith([
          { id: "m1", category: "main", status: "failed" },
          { id: "m2", category: "main", status: "imported" },
        ]),
        patch
      )
    ).toBe("none");
    expect(await mainReleaseGate(storageWith([]), patch)).toBe("none");
  });
});

describe("applyDeliveredStatus", () => {
  it("marks the game owned when nothing stands in the way", async () => {
    const storage = storageWith([]);
    await applyDeliveredStatus(storage, patch, { status: "downloading" });
    expect(storage.updateGameStatus).toHaveBeenCalledWith(
      "g1",
      { status: "owned" },
      { preserveCurated: true }
    );
  });

  it("leaves the status while the main release is active", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "downloading" }]);
    await applyDeliveredStatus(storage, patch, { status: "downloading" });
    expect(storage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("puts the game back to wanted when only the patch arrived", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "failed" }]);
    await applyDeliveredStatus(storage, patch, { status: "downloading" });
    expect(storage.updateGameStatus).toHaveBeenCalledWith(
      "g1",
      { status: "wanted" },
      { preserveCurated: true }
    );
  });

  it("never touches a game the user moved past owned", async () => {
    const storage = storageWith([]);
    await applyDeliveredStatus(storage, patch, { status: "playing" });
    expect(storage.updateGameStatus).not.toHaveBeenCalled();
  });
});

describe("applyFailureStatus", () => {
  const failed = { id: "f", gameId: "g1", category: "main" };

  it("owns the game when another main release was delivered", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "completed" }]);
    await applyFailureStatus(storage, failed, { status: "downloading" });
    expect(storage.updateGameStatus).toHaveBeenCalledWith(
      "g1",
      { status: "owned" },
      { preserveCurated: true }
    );
  });

  it("goes back to wanted when no main release was delivered", async () => {
    const storage = storageWith([{ id: "p", category: "update", status: "completed" }]);
    await applyFailureStatus(storage, failed, { status: "downloading" });
    expect(storage.updateGameStatus).toHaveBeenCalledWith(
      "g1",
      { status: "wanted" },
      { preserveCurated: true }
    );
  });

  it("replays a delivered patch's version when the last main fails and a base exists", async () => {
    recordVersion.mockClear();
    const storage = storageWith([
      { id: "p", category: "update", status: "completed", downloadTitle: "Game.Update.v1.1-GRP" },
    ]);
    storage.getGame.mockResolvedValue({ status: "owned", installedVersion: "1.0" });
    await replayAfterMainFailure(storage, failed);
    expect(recordVersion).toHaveBeenCalledWith(storage, "g1", "Game.Update.v1.1-GRP", "update");
  });

  it("does not replay patches when the failed main leaves the game without a base", async () => {
    recordVersion.mockClear();
    const storage = storageWith([
      { id: "p", category: "update", status: "completed", downloadTitle: "Game.Update.v1.1-GRP" },
    ]);
    storage.getGame.mockResolvedValue({ status: "downloading", installedVersion: null });
    await replayAfterMainFailure(storage, failed);
    expect(recordVersion).not.toHaveBeenCalled();
  });

  it("leaves user-curated statuses alone", async () => {
    const storage = storageWith([]);
    await applyFailureStatus(storage, failed, { status: "playing" });
    expect(storage.updateGameStatus).not.toHaveBeenCalled();
  });

  it("does not let a main parked for review block another delivered main", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "manual_review_required" }]);
    expect(await mainReleaseGate(storage, { ...patch, category: "main" })).toBe("none");
  });
});

describe("recordDeliveredVersion", () => {
  const withStore = (siblings: Parameters<typeof storageWith>[0]) => ({
    ...storageWith(siblings),
  });
  const patchDownload = {
    id: "patch",
    gameId: "g1",
    category: "update",
    downloadTitle: "Game.Update.v1.1-GRP",
  };

  it("keeps a patch's version back while its base release is still on its way", async () => {
    recordVersion.mockClear();
    const store = withStore([
      { id: "m", category: "main", status: "downloading", downloadTitle: "Game.v1.0-GRP" },
    ]);
    expect(await recordDeliveredVersion(store, patchDownload)).toBe(false);
    expect(recordVersion).not.toHaveBeenCalled();
  });

  it("records a patch for a game that already has its base although every main failed", async () => {
    recordVersion.mockClear();
    const store = withStore([{ id: "m", category: "main", status: "failed" }]);
    store.getGame.mockResolvedValue({ status: "owned", installedVersion: null });
    expect(await recordDeliveredVersion(store, patchDownload)).toBe(true);
    expect(recordVersion).toHaveBeenCalledTimes(1);
  });

  it("holds a patch back when every main failed and the game has no base", async () => {
    recordVersion.mockClear();
    const store = withStore([{ id: "m", category: "main", status: "failed" }]);
    store.getGame.mockResolvedValue({ status: "downloading", installedVersion: null });
    expect(await recordDeliveredVersion(store, patchDownload)).toBe(false);
    expect(recordVersion).not.toHaveBeenCalled();
  });

  it("records a patch once a main release was delivered", async () => {
    recordVersion.mockClear();
    const store = withStore([
      { id: "m", category: "main", status: "completed", downloadTitle: "Game.v1.0-GRP" },
    ]);
    expect(await recordDeliveredVersion(store, patchDownload)).toBe(true);
    expect(recordVersion).toHaveBeenCalledWith(store, "g1", "Game.Update.v1.1-GRP", "update");
  });

  it("replays the patches delivered before the main release", async () => {
    recordVersion.mockClear();
    const store = withStore([
      {
        id: "patch",
        category: "update",
        status: "completed",
        downloadTitle: "Game.Update.v1.1-GRP",
      },
    ]);
    const main = { id: "m", gameId: "g1", category: "main", downloadTitle: "Game.v1.0-GRP" };
    expect(await recordDeliveredVersion(store, main)).toBe(true);
    expect(recordVersion.mock.calls.map((c) => c[2])).toEqual([
      "Game.v1.0-GRP",
      "Game.Update.v1.1-GRP",
    ]);
  });
});

describe("recordDeliveredVersion with several mains", () => {
  it("defers the patch replay while another main is still in flight", async () => {
    recordVersion.mockClear();
    const store = storageWith([
      { id: "m2", category: "main", status: "downloading", downloadTitle: "Game.v2.0-GRP" },
      { id: "p", category: "update", status: "completed", downloadTitle: "Game.Update.v1.1-GRP" },
    ]);
    const main = { id: "m1", gameId: "g1", category: "main", downloadTitle: "Game.v1.0-GRP" };
    expect(await recordDeliveredVersion(store, main)).toBe(true);
    expect(recordVersion.mock.calls.map((c) => c[2])).toEqual(["Game.v1.0-GRP"]);
  });
});

describe("hasMainReleaseInFlight", () => {
  it("ignores a paused patch but not a paused main release", async () => {
    const download = { id: "x", gameId: "g1", category: "main" };
    expect(
      await hasMainReleaseInFlight(
        storageWith([{ id: "p", category: "update", status: "paused" }]),
        download
      )
    ).toBe(false);
    expect(
      await hasMainReleaseInFlight(
        storageWith([{ id: "m", category: "main", status: "paused" }]),
        download
      )
    ).toBe(true);
  });
});
