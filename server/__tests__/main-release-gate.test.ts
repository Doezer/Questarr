import { describe, expect, it, vi } from "vitest";
import { applyDeliveredStatus, mainReleaseGate } from "../main-release-gate.js";

const patch = { id: "patch", gameId: "g1", category: "update" };

function storageWith(siblings: { id: string; category: string; status: string }[]) {
  return {
    getDownloadsByGameId: vi.fn().mockResolvedValue(siblings),
    updateGameStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("mainReleaseGate", () => {
  it("never gates a main release itself", async () => {
    const storage = storageWith([{ id: "m", category: "main", status: "downloading" }]);
    expect(await mainReleaseGate(storage, { ...patch, category: "main" })).toBe("none");
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
