import { beforeEach, describe, expect, it, vi } from "vitest";

const { fsMock, rommMock } = vi.hoisted(() => ({
  fsMock: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
    readdir: vi.fn().mockResolvedValue([]),
  },
  rommMock: {
    isRommPlatformFoldersEnabled: vi.fn<() => Promise<boolean>>(),
    requestRommScanAfterImport: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({ default: fsMock }));
vi.mock("../downloaders.js", () => ({ DownloaderManager: { getDownloadDetails: vi.fn() } }));
vi.mock("../romm.js", () => rommMock);

import { ImportManager } from "../services/ImportManager.js";
import { isValidRommSlug, ROMM_SLUG_BY_IGDB_PLATFORM_ID } from "../../shared/romm-platforms.js";
import { makeImportConfig } from "./helpers/import-test-helpers.js";

function planFor(platforms: unknown[], downloadTitle = "Some.Game-GRP") {
  const storage = {
    getGameDownload: vi.fn().mockResolvedValue({
      id: "dl-1",
      gameId: "g1",
      downloaderId: "d1",
      downloadHash: "abc",
      downloadTitle,
    }),
    getGame: vi.fn().mockResolvedValue({ id: "g1", title: "Some Game", userId: "u1", platforms }),
    getImportConfig: vi.fn().mockResolvedValue(makeImportConfig({ libraryRoot: "/roms" })),
    getDownloader: vi.fn().mockResolvedValue(undefined),
  };
  const manager = new ImportManager(
    storage as never, // NOSONAR
    { translatePath: vi.fn(), getConfiguredRoots: vi.fn().mockResolvedValue([]) } as never, // NOSONAR
    {} as never, // NOSONAR
    {} as never // NOSONAR
  );
  return manager.planConfirmImport("dl-1");
}

describe("RomM platform folders", () => {
  beforeEach(() => {
    rommMock.isRommPlatformFoldersEnabled.mockResolvedValue(true);
  });

  it("uses the RomM slug of the game's platform", async () => {
    expect((await planFor([{ id: 19, name: "Super Nintendo" }])).proposedPath).toBe(
      "/roms/snes/Some Game"
    );
    expect((await planFor([8])).proposedPath).toBe("/roms/ps2/Some Game");
  });

  it("prefers the platform named in the release", async () => {
    expect((await planFor([6], "Some.Game.NSW-GRP")).proposedPath).toBe("/roms/switch/Some Game");
  });

  it("puts PC games in win", async () => {
    expect((await planFor([])).proposedPath).toBe("/roms/win/Some Game");
    expect((await planFor([6])).proposedPath).toBe("/roms/win/Some Game");
  });

  it("keeps the readable folder for a platform RomM has no slug for", async () => {
    expect((await planFor([9999])).proposedPath).toBe("/roms/PC/Some Game");
  });

  it("keeps readable folder names when the option is off", async () => {
    rommMock.isRommPlatformFoldersEnabled.mockResolvedValue(false);
    expect((await planFor([19])).proposedPath).toBe("/roms/SNES/Some Game");
  });
});

describe("RomM platform table", () => {
  it("only holds slugs that are safe folder names", () => {
    for (const slug of Object.values(ROMM_SLUG_BY_IGDB_PLATFORM_ID)) {
      expect(isValidRommSlug(slug)).toBe(true);
    }
    for (const bad of ["../x", "a/b", "A", "", ".hidden", "a\\b", "x..y"]) {
      expect(isValidRommSlug(bad)).toBe(false);
    }
  });
});
