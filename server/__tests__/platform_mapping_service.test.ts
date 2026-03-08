import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformMappingService } from "../services/PlatformMappingService.js";

describe("PlatformMappingService", () => {
  const storage = {
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
    storage.getPlatformMappings
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "seeded-1", igdbPlatformId: 18, rommPlatformName: "nes" }]);
    storage.addPlatformMapping.mockImplementation(async (mapping) => ({ id: "x", ...mapping }));

    const service = new PlatformMappingService(storage as never);
    await service.initializeDefaults();

    expect(storage.addPlatformMapping).toHaveBeenCalled();
    expect(storage.addPlatformMapping.mock.calls.length).toBeGreaterThan(10);
  });

  it("does not seed defaults when mappings already exist", async () => {
    storage.getPlatformMappings.mockResolvedValue([{ id: "m1" }]);

    const service = new PlatformMappingService(storage as never);
    await service.initializeDefaults();

    expect(storage.addPlatformMapping).not.toHaveBeenCalled();
  });

  it("returns mapping values and supports CRUD pass-through", async () => {
    const mapping = { id: "m1", igdbPlatformId: 19, rommPlatformName: "snes" };
    storage.getPlatformMappings.mockResolvedValue([mapping]);
    storage.getPlatformMapping.mockResolvedValueOnce(mapping).mockResolvedValueOnce(undefined);
    storage.addPlatformMapping.mockResolvedValue(mapping);
    storage.updatePlatformMapping.mockResolvedValue({ ...mapping, rommPlatformName: "sfc" });
    storage.removePlatformMapping.mockResolvedValue(true);

    const service = new PlatformMappingService(storage as never);

    await expect(service.getAllMappings()).resolves.toEqual([mapping]);
    await expect(service.getRomMPlatform(19)).resolves.toBe("snes");
    await expect(service.getRomMPlatform(1234)).resolves.toBeNull();
    await expect(service.addMapping(mapping)).resolves.toEqual(mapping);
    await expect(service.updateMapping("m1", { rommPlatformName: "sfc" })).resolves.toEqual({
      ...mapping,
      rommPlatformName: "sfc",
    });
    await expect(service.removeMapping("m1")).resolves.toBe(true);
  });
});
