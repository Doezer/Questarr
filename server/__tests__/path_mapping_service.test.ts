import { beforeEach, describe, expect, it, vi } from "vitest";
import { PathMappingService } from "../services/PathMappingService.js";

describe("PathMappingService", () => {
  const storage = {
    getPathMappings: vi.fn(),
    addPathMapping: vi.fn(),
    updatePathMapping: vi.fn(),
    removePathMapping: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through CRUD mapping methods", async () => {
    const mapping = {
      id: "m1",
      remotePath: "/downloads",
      localPath: "/data/downloads",
      remoteHost: null,
    };
    storage.getPathMappings.mockResolvedValue([mapping]);
    storage.addPathMapping.mockResolvedValue(mapping);
    storage.updatePathMapping.mockResolvedValue({ ...mapping, localPath: "/new" });
    storage.removePathMapping.mockResolvedValue(true);

    const service = new PathMappingService(storage as never);

    await expect(service.getAllMappings()).resolves.toEqual([mapping]);
    await expect(service.addMapping(mapping)).resolves.toEqual(mapping);
    await expect(service.updateMapping("m1", { localPath: "/new" })).resolves.toEqual({
      ...mapping,
      localPath: "/new",
    });
    await expect(service.removeMapping("m1")).resolves.toBe(true);
  });

  it("translates path using longest prefix match", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "base",
        remotePath: "/downloads",
        localPath: "C:/data/downloads",
        remoteHost: null,
      },
      {
        id: "nested",
        remotePath: "/downloads/incoming",
        localPath: "C:/data/incoming",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    const translated = await service.translatePath("/downloads/incoming/game/file.rom");

    expect(translated).toMatch(/data[\\/]incoming[\\/]game[\\/]file\.rom$/);
  });

  it("applies host-specific mapping when host matches", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "generic",
        remotePath: "/downloads",
        localPath: "/data/generic",
        remoteHost: null,
      },
      {
        id: "hosted",
        remotePath: "/downloads/special",
        localPath: "/data/hosted",
        remoteHost: "qbittorrent.local",
      },
    ]);

    const service = new PathMappingService(storage as never);

    await expect(
      service.translatePath("/downloads/special/a.bin", "qbittorrent.local")
    ).resolves.toMatch(/data[\\/]hosted[\\/]a\.bin$/);
    await expect(service.translatePath("/downloads/a.bin", "other.local")).resolves.toMatch(
      /data[\\/]generic[\\/]a\.bin$/
    );
  });

  it("returns original path when no mapping matches", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "m1",
        remotePath: "/downloads",
        localPath: "/data/downloads",
        remoteHost: "qbittorrent.local",
      },
    ]);

    const service = new PathMappingService(storage as never);
    await expect(service.translatePath("/other/path/file.iso", "other.local")).resolves.toBe(
      "/other/path/file.iso"
    );
  });

  it("falls through to generic match when remoteHost does not match any host-specific mapping", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "nas",
        remotePath: "/downloads",
        localPath: "/nas/data",
        remoteHost: "nas.local",
      },
      {
        id: "generic",
        remotePath: "/downloads",
        localPath: "/generic/data",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    // "other.host" does not match "nas.local", so only the generic mapping is a candidate
    const result = await service.translatePath("/downloads/file.rom", "other.host");
    expect(result).toMatch(/generic[\\/]data[\\/]file\.rom$/);
  });

  it("returns path unchanged when remoteHost matches no mapping and no generic mapping exists", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "nas",
        remotePath: "/downloads",
        localPath: "/nas/data",
        remoteHost: "nas.local",
      },
    ]);

    const service = new PathMappingService(storage as never);
    // "other.host" does not match "nas.local" and there is no generic mapping
    await expect(service.translatePath("/downloads/file.rom", "other.host")).resolves.toBe(
      "/downloads/file.rom"
    );
  });

  it("translates path with trailing slash by stripping the extra separator", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "m1",
        remotePath: "/downloads/incoming",
        localPath: "/local/incoming",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    // The trailing slash becomes the relative part; after stripping the leading separator it
    // is an empty string, so path.join returns the local path itself.
    const result = await service.translatePath("/downloads/incoming/");
    expect(result).toMatch(/local[\\/]incoming$/);
  });

  it("translates path that exactly equals the mapping remotePath (no subdirectory)", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "m1",
        remotePath: "/downloads",
        localPath: "/local/data",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    const result = await service.translatePath("/downloads");
    // Relative part is "", path.join("/local/data", "") === "/local/data"
    expect(result).toMatch(/local[\\/]data$/);
    // Must not have an extra trailing separator
    expect(result).not.toMatch(/[\\/]$/);
  });

  it("returns empty string unchanged when remotePath is empty", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "m1",
        remotePath: "/downloads",
        localPath: "/local/data",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    // Empty string does not start with any mapping prefix, so it passes through
    await expect(service.translatePath("")).resolves.toBe("");
  });

  it("returns remotePath unchanged when storage returns no mappings", async () => {
    storage.getPathMappings.mockResolvedValue([]);

    const service = new PathMappingService(storage as never);
    await expect(service.translatePath("/some/remote/path")).resolves.toBe("/some/remote/path");
  });

  it("getAllMappings returns empty array when storage returns no mappings", async () => {
    storage.getPathMappings.mockResolvedValue([]);

    const service = new PathMappingService(storage as never);
    await expect(service.getAllMappings()).resolves.toEqual([]);
  });

  it("multiple mappings — longest prefix wins between /downloads and /downloads/games", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "base",
        remotePath: "/downloads",
        localPath: "/local/downloads",
        remoteHost: null,
      },
      {
        id: "games",
        remotePath: "/downloads/games",
        localPath: "/local/games",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    const result = await service.translatePath("/downloads/games/rom.zip");

    // Should match /downloads/games (longer prefix), not /downloads
    expect(result).toMatch(/local[\\/]games[\\/]rom\.zip$/);
    expect(result).not.toMatch(/local[\\/]downloads/);
  });

  it("path with no matching prefix returns the original path unchanged", async () => {
    storage.getPathMappings.mockResolvedValue([
      {
        id: "m1",
        remotePath: "/downloads",
        localPath: "/local/downloads",
        remoteHost: null,
      },
    ]);

    const service = new PathMappingService(storage as never);
    await expect(service.translatePath("/media/roms/game.iso")).resolves.toBe(
      "/media/roms/game.iso"
    );
  });

  it("addMapping() then translatePath() round-trip uses the stored mapping", async () => {
    const mapping = {
      id: "rt1",
      remotePath: "/remote/roms",
      localPath: "/local/roms",
      remoteHost: null,
    };
    storage.addPathMapping.mockResolvedValue(mapping);
    // After adding, getPathMappings returns the new mapping
    storage.getPathMappings.mockResolvedValue([mapping]);

    const service = new PathMappingService(storage as never);
    await service.addMapping(mapping);
    const result = await service.translatePath("/remote/roms/zelda.rom");

    expect(result).toMatch(/local[\\/]roms[\\/]zelda\.rom$/);
  });
});
