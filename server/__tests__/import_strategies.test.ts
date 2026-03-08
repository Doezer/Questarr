import { describe, expect, it, vi, beforeEach } from "vitest";

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("fs-extra", () => ({
  default: fsMock,
}));

import { PCImportStrategy, RomMImportStrategy } from "../services/ImportStrategies.js";
import type { Game } from "../../shared/schema.js";

function makeGame(platforms: unknown): Game {
  return {
    id: "g1",
    title: "Test Game",
    status: "wanted",
    userId: null,
    igdbId: null,
    steamAppid: null,
    summary: null,
    coverUrl: null,
    releaseDate: null,
    rating: null,
    platforms: platforms as Game["platforms"],
    genres: null,
    publishers: null,
    developers: null,
    screenshots: null,
    hidden: false,
    originalReleaseDate: null,
    releaseStatus: null,
    addedAt: null,
    completedAt: null,
  };
}

describe("ImportStrategies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PCImportStrategy.canHandle detects IGDB platform id 6 across shapes", () => {
    const strategy = new PCImportStrategy();

    expect(strategy.canHandle(makeGame([6]))).toBe(true);
    expect(strategy.canHandle(makeGame(["6"]))).toBe(true);
    expect(strategy.canHandle(makeGame([{ id: 6 }]))).toBe(true);
    expect(strategy.canHandle(makeGame(["Nintendo Switch"]))).toBe(false);
  });

  it("RomMImportStrategy.executeImport accepts directory-style proposedPath", async () => {
    const strategy = new RomMImportStrategy("snes");

    await strategy.executeImport(
      {
        needsReview: false,
        strategy: "romm",
        originalPath: "/downloads/My.Game.rom",
        proposedPath: "/library/roms/snes",
      },
      false
    );

    expect(fsMock.ensureDir).toHaveBeenCalledWith(expect.stringMatching(/roms[\\/]snes$/));
    expect(fsMock.move).toHaveBeenNthCalledWith(
      1,
      "/downloads/My.Game.rom",
      expect.stringMatching(/roms[\\/]snes[\\/]My\.Game\.rom\.tmp$/),
      { overwrite: true }
    );
    expect(fsMock.move).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/roms[\\/]snes[\\/]My\.Game\.rom\.tmp$/),
      expect.stringMatching(/roms[\\/]snes[\\/]My\.Game\.rom$/),
      { overwrite: true }
    );
  });
});
