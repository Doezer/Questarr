import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformMappingService } from "../services/PlatformMappingService.js";

describe("PlatformMappingService", () => {
  const storage = {
    seedPlatformMappingsIfEmpty: vi.fn(),
    getPlatformMappings: vi.fn(),
    getPlatformMapping: vi.fn(),
    addPlatformMapping: vi.fn(),
    updatePlatformMapping: vi.fn(),
    removePlatformMapping: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds defaults when there are no mappings", async () => {
    storage.seedPlatformMappingsIfEmpty.mockResolvedValue({ seeded: true, count: 20 });

    const service = new PlatformMappingService(storage as never);
    await service.initializeDefaults();

    expect(storage.seedPlatformMappingsIfEmpty).toHaveBeenCalledTimes(1);
  });

  it("does not seed defaults when mappings already exist", async () => {
    storage.seedPlatformMappingsIfEmpty.mockResolvedValue({ seeded: false, count: 1 });

    const service = new PlatformMappingService(storage as never);
    await service.initializeDefaults();

    expect(storage.seedPlatformMappingsIfEmpty).toHaveBeenCalledTimes(1);
  });

  it("returns mapping values and supports CRUD pass-through", async () => {
    const mapping = { id: "m1", igdbPlatformId: 19, sourcePlatformName: "snes" };
    storage.getPlatformMappings.mockResolvedValue([mapping]);
    storage.getPlatformMapping.mockResolvedValueOnce(mapping).mockResolvedValueOnce(undefined);
    storage.addPlatformMapping.mockResolvedValue(mapping);
    storage.updatePlatformMapping.mockResolvedValue({ ...mapping, sourcePlatformName: "sfc" });
    storage.removePlatformMapping.mockResolvedValue(true);

    const service = new PlatformMappingService(storage as never);

    await expect(service.getAllMappings()).resolves.toEqual([mapping]);
    await expect(service.getRomMPlatform(19)).resolves.toBe("snes");
    await expect(service.getRomMPlatform(1234)).resolves.toBeNull();
    await expect(service.addMapping(mapping)).resolves.toEqual(mapping);
    await expect(service.updateMapping("m1", { sourcePlatformName: "sfc" })).resolves.toEqual({
      ...mapping,
      sourcePlatformName: "sfc",
    });
    await expect(service.removeMapping("m1")).resolves.toBe(true);
  });

  it("addMapping propagates storage error on duplicate igdbPlatformId", async () => {
    const duplicate = { id: "m2", igdbPlatformId: 19, sourcePlatformName: "snes" };
    storage.addPlatformMapping.mockRejectedValue(new Error("UNIQUE constraint failed"));

    const service = new PlatformMappingService(storage as never);

    await expect(service.addMapping(duplicate)).rejects.toThrow("UNIQUE constraint failed");
  });

  it("removeMapping returns false when id does not exist", async () => {
    storage.removePlatformMapping.mockResolvedValue(false);

    const service = new PlatformMappingService(storage as never);

    await expect(service.removeMapping("nonexistent-id")).resolves.toBe(false);
  });

  it("listMappings returns all seeded entries after initializeDefaults", async () => {
    const seeded = [
      { id: "d1", igdbPlatformId: 18, sourcePlatformName: "nes" },
      { id: "d2", igdbPlatformId: 19, sourcePlatformName: "snes" },
    ];
    storage.seedPlatformMappingsIfEmpty.mockResolvedValue({ seeded: true, count: seeded.length });
    storage.getPlatformMappings.mockResolvedValue(seeded);

    const service = new PlatformMappingService(storage as never);
    await service.initializeDefaults();

    const result = await service.getAllMappings();
    expect(result).toEqual(seeded);
    expect(result.length).toBe(2);
  });

  it("initializeDefaults is idempotent — calling twice does not error and seeding is attempted both times", async () => {
    storage.seedPlatformMappingsIfEmpty.mockResolvedValue({ seeded: false, count: 21 });

    const service = new PlatformMappingService(storage as never);
    await service.initializeDefaults();
    await service.initializeDefaults();

    // seedPlatformMappingsIfEmpty should be called once per initializeDefaults call
    expect(storage.seedPlatformMappingsIfEmpty).toHaveBeenCalledTimes(2);
  });

  it("getRomMPlatform returns the mapped slug for a known IGDB platform ID", async () => {
    storage.getPlatformMapping.mockResolvedValue({
      id: "m1",
      igdbPlatformId: 7,
      sourcePlatformName: "psx",
    });

    const service = new PlatformMappingService(storage as never);
    const slug = await service.getRomMPlatform(7);

    expect(slug).toBe("psx");
    expect(storage.getPlatformMapping).toHaveBeenCalledWith(7);
  });

  it("getRomMPlatform returns null for an IGDB platform ID with no mapping", async () => {
    storage.getPlatformMapping.mockResolvedValue(undefined);

    const service = new PlatformMappingService(storage as never);
    const slug = await service.getRomMPlatform(9999);

    expect(slug).toBeNull();
  });

  it("updateMapping persists changes and getRomMPlatform reflects the new slug", async () => {
    const original = { id: "m3", igdbPlatformId: 8, sourcePlatformName: "ps2" };
    const updated = { ...original, sourcePlatformName: "playstation2" };

    storage.updatePlatformMapping.mockResolvedValue(updated);
    storage.getPlatformMapping.mockResolvedValue(updated);

    const service = new PlatformMappingService(storage as never);
    const result = await service.updateMapping("m3", { sourcePlatformName: "playstation2" });

    expect(result).toEqual(updated);
    expect(storage.updatePlatformMapping).toHaveBeenCalledWith("m3", {
      sourcePlatformName: "playstation2",
    });

    const slug = await service.getRomMPlatform(8);
    expect(slug).toBe("playstation2");
  });
});
