/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hideDiscoveryGame } from "../src/lib/discover-hidden-mutation";
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
