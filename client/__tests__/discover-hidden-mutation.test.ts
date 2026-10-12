/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDiscoveryGameToLibrary, hideDiscoveryGame } from "../src/lib/discover-hidden-mutation";
import { apiRequest } from "@/lib/queryClient";
import { mapGameToInsertGame } from "@/lib/utils";
import { type Game } from "@shared/schema";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  mapGameToInsertGame: vi.fn(),
}));

const mockGame = {
  id: "igdb-42",
  igdbId: 42,
  title: "Test Game",
} as Game;

describe("hideDiscoveryGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns hidden true for PATCH without reading response body", async () => {
    const response = {
      json: vi.fn().mockRejectedValue(new Error("json should not be called")),
    } as unknown as Response;

    vi.mocked(apiRequest).mockResolvedValue(response);

    await expect(hideDiscoveryGame(mockGame, "local-123")).resolves.toEqual({ hidden: true });

    expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/games/local-123/hidden", {
      hidden: true,
    });
    expect(response.json).not.toHaveBeenCalled();
  });

  it("returns hidden true for POST without reading response body", async () => {
    const mappedGame = {
      title: "Mapped Game",
      igdbId: 42,
    };

    const response = {
      json: vi.fn().mockRejectedValue(new Error("json should not be called")),
    } as unknown as Response;

    vi.mocked(mapGameToInsertGame).mockReturnValue(mappedGame as never);
    vi.mocked(apiRequest).mockResolvedValue(response);

    await expect(hideDiscoveryGame(mockGame)).resolves.toEqual({ hidden: true });

    expect(mapGameToInsertGame).toHaveBeenCalledWith(mockGame);
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/games", {
      ...mappedGame,
      status: "wanted",
      hidden: true,
    });
    expect(response.json).not.toHaveBeenCalled();
  });

  it("falls back to PATCH hidden when POST returns 409 with existing game", async () => {
    const mappedGame = {
      title: "Mapped Game",
      igdbId: 42,
    };

    vi.mocked(mapGameToInsertGame).mockReturnValue(mappedGame as never);
    vi.mocked(apiRequest)
      .mockRejectedValueOnce({
        status: 409,
        data: {
          game: { id: "existing-local-id" },
        },
      })
      .mockResolvedValueOnce({} as Response);

    await expect(hideDiscoveryGame(mockGame)).resolves.toEqual({ hidden: true });

    expect(apiRequest).toHaveBeenNthCalledWith(1, "POST", "/api/games", {
      ...mappedGame,
      status: "wanted",
      hidden: true,
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, "PATCH", "/api/games/existing-local-id/hidden", {
      hidden: true,
    });
  });
});

describe("addDiscoveryGameToLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mapGameToInsertGame).mockReturnValue({ igdbId: 42 } as never);
  });

  it("returns the created library game", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({ id: "new-id", status: "owned" }),
    } as Response);

    await expect(addDiscoveryGameToLibrary(mockGame, "owned")).resolves.toEqual({
      id: "new-id",
      status: "owned",
    });
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/games", {
      igdbId: 42,
      status: "owned",
    });
  });

  it("returns the existing library game when the POST answers 409", async () => {
    vi.mocked(apiRequest).mockRejectedValue({
      status: 409,
      data: { game: { id: "existing-id", status: "wanted" } },
    });

    await expect(addDiscoveryGameToLibrary(mockGame)).resolves.toEqual({
      id: "existing-id",
      status: "wanted",
    });
  });

  it("rethrows other errors", async () => {
    vi.mocked(apiRequest).mockRejectedValue({ status: 500 });

    await expect(addDiscoveryGameToLibrary(mockGame)).rejects.toEqual({ status: 500 });
  });
});
