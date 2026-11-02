import { describe, it, expect, vi, beforeEach } from "vitest";

const { cfg, scanAll } = vi.hoisted(() => ({
  cfg: new Map<string, string>(),
  scanAll: vi.fn(async (_userId: string) => {}),
}));
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(async (k: string) => cfg.get(k)),
    setSystemConfig: vi.fn(async (k: string, v: string) => void cfg.set(k, v)),
    getAllUsers: vi.fn(async () => [{ id: "u1" }]),
    getEnabledRootFolders: vi.fn(async () => [{ id: "r1" }]),
  },
}));
vi.mock("../logger.js", () => ({ igdbLogger: { info: vi.fn() } }));
vi.mock("../library-scanner.js", () => ({ scanAllEnabledRootFolders: scanAll }));

import { runScheduledLibraryRescan, LIBRARY_RESCAN_INTERVAL_KEY } from "../library-rescan.js";

describe("runScheduledLibraryRescan", () => {
  beforeEach(() => {
    cfg.clear();
    scanAll.mockClear();
  });

  it("does nothing when the schedule is off", async () => {
    expect(await runScheduledLibraryRescan(1_000_000)).toBe(false);
    expect(scanAll).not.toHaveBeenCalled();
  });

  it("scans once the interval elapsed, not before", async () => {
    cfg.set(LIBRARY_RESCAN_INTERVAL_KEY, "60");
    expect(await runScheduledLibraryRescan(10_000_000)).toBe(true);
    expect(scanAll).toHaveBeenCalledWith("u1");
    expect(await runScheduledLibraryRescan(10_000_000 + 30 * 60_000)).toBe(false);
    expect(await runScheduledLibraryRescan(10_000_000 + 61 * 60_000)).toBe(true);
    expect(scanAll).toHaveBeenCalledTimes(2);
  });
});
