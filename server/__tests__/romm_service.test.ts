import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosCreateMock, getMock, postMock } = vi.hoisted(() => ({
  axiosCreateMock: vi.fn(),
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: axiosCreateMock,
  },
}));

import { RomMService } from "../services/RomMService.js";

describe("RomMService", () => {
  const storage = {
    getRomMConfig: vi.fn(),
    getSystemConfig: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    axiosCreateMock.mockReturnValue({
      get: getMock,
      post: postMock,
    });
    storage.getSystemConfig.mockResolvedValue(undefined);
  });

  it("returns false for availability when RomM is disabled", async () => {
    storage.getRomMConfig.mockResolvedValue({ enabled: false, url: "http://romm.local" });
    const service = new RomMService(storage as never);

    await expect(service.isAvailable()).resolves.toBe(false);
    expect(axiosCreateMock).not.toHaveBeenCalled();
  });

  it("returns true for availability when auth endpoint succeeds", async () => {
    storage.getRomMConfig.mockResolvedValue({
      enabled: true,
      url: "http://romm.local/",
      apiKey: "abc",
    });
    getMock.mockResolvedValue({ status: 200 });

    const service = new RomMService(storage as never);
    await expect(service.isAvailable()).resolves.toBe(true);

    expect(axiosCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://romm.local",
        timeout: 5000,
      })
    );
    expect(getMock).toHaveBeenCalledWith("/api/auth/me");
  });

  it("tries endpoint candidates in order until scan succeeds", async () => {
    storage.getRomMConfig.mockResolvedValue({ enabled: true, url: "http://romm.local" });
    storage.getSystemConfig.mockResolvedValue("api/custom-scan");
    postMock
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValue({ status: 202 });

    const service = new RomMService(storage as never);
    await expect(service.scanLibrary("snes")).resolves.toBe(true);

    expect(postMock).toHaveBeenNthCalledWith(1, "/api/custom-scan", { platforms: ["snes"] });
    expect(postMock).toHaveBeenNthCalledWith(2, "/api/scan", { platforms: ["snes"] });
  });

  it("returns false when all scan endpoints fail", async () => {
    storage.getRomMConfig.mockResolvedValue({ enabled: true, url: "http://romm.local" });
    postMock.mockResolvedValue({ status: 500 });

    const service = new RomMService(storage as never);
    await expect(service.scanLibrary()).resolves.toBe(false);
  });
});
