import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../storage.js", () => ({
  storage: {
    getSystemConfig: vi.fn(async (k: string) => store.get(k)),
    setSystemConfig: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  },
}));
vi.mock("../logger.js", () => ({
  routesLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  getPlayniteSyncState,
  recordPlayniteSync,
  recordPlayniteSyncError,
} from "../playnite-sync-state.js";

describe("Playnite sync state", () => {
  beforeEach(() => store.clear());

  it("starts empty", async () => {
    const state = await getPlayniteSyncState("u1");
    expect(state.playStatus).toEqual({ at: null, counts: {}, error: null });
  });

  it("keeps the last good counts next to a later failure, then clears it on success", async () => {
    await recordPlayniteSync("u1", "playStatus", { received: 3, updated: 2 });
    await recordPlayniteSyncError("u1", "playStatus", "boom");
    let state = await getPlayniteSyncState("u1");
    expect(state.playStatus.counts).toEqual({ received: 3, updated: 2 });
    expect(state.playStatus.at).not.toBeNull();
    expect(state.playStatus.error?.message).toBe("boom");

    await recordPlayniteSync("u1", "playStatus", { received: 1 });
    state = await getPlayniteSyncState("u1");
    expect(state.playStatus.error).toBeNull();
  });

  it("keeps kinds and users apart", async () => {
    await recordPlayniteSync("u1", "playTime", { received: 1 });
    expect((await getPlayniteSyncState("u1")).playStatus.at).toBeNull();
    expect((await getPlayniteSyncState("u2")).playTime.at).toBeNull();
  });

  it("starts again from a damaged document", async () => {
    store.set("playnite.sync.libraryImport.u1", "{nope");
    expect((await getPlayniteSyncState("u1")).libraryImport.at).toBeNull();
  });
});
