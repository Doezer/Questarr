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
});
