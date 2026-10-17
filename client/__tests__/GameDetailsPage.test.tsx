/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Game } from "@shared/schema";
import { ApiError } from "../src/lib/queryClient";
import GameDetailsPage from "../src/pages/game-details";
import { useGameDetailsLink } from "../src/hooks/use-game-details-link";

vi.mock("../src/components/GameDetails", () => ({
  default: ({ game }: { game: Game }) => <h1>{game.title}</h1>,
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const game = { id: "g1", title: "Quest One", status: "wanted" } as Game;

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={hook}>
        <Route path="/games/:id" component={GameDetailsPage} />
      </Router>
    </QueryClientProvider>
  );
}

describe("GameDetailsPage", () => {
  beforeEach(() => apiRequest.mockReset());
  afterEach(cleanup);

  it("shows a message when the game does not exist", async () => {
    apiRequest.mockResolvedValue({
      json: async () => {
        throw new ApiError(404, "Not found");
      },
    });
    renderAt("/games/missing");
    expect(await screen.findByText("Game not found")).toBeInTheDocument();
  });

  it("drops a card-seeded game when the server says it is gone", async () => {
    window.history.replaceState({ game }, "", "/games/g1");
    apiRequest.mockResolvedValue({
      json: async () => {
        throw new ApiError(404, "Not found");
      },
    });
    renderAt("/games/g1");
    expect(await screen.findByText("Game not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quest One" })).toBeNull();
    window.history.replaceState(null, "", "/");
  });

  it("tells a server failure apart from a missing game", async () => {
    apiRequest.mockResolvedValue({
      json: async () => {
        throw new ApiError(500, "Boom");
      },
    });
    renderAt("/games/g500");
    expect(await screen.findByText("Couldn't load this game", {}, { timeout: 5000 })).toBeVisible();
    expect(screen.queryByText("Game not found")).toBeNull();
  });

  it("loads a library game by id and names the tab after it", async () => {
    apiRequest.mockResolvedValue({ json: async () => game });
    renderAt("/games/g1");
    expect(await screen.findByRole("heading", { name: "Quest One" })).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/games/g1");
    await waitFor(() => expect(document.title).toBe("Quest One · Questarr"));
  });

  it("loads a Discover game from IGDB by its numeric id", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ ...game, id: "igdb-77" }) });
    renderAt("/games/igdb-77");
    await screen.findByRole("heading", { name: "Quest One" });
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/igdb/game/77");
  });
});

describe("useGameDetailsLink", () => {
  it("builds the game's path and opens a new tab on ctrl-click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useGameDetailsLink(game));
    expect(result.current.path).toBe("/games/g1");
    result.current.openDetails({ ctrlKey: true });
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/games/g1"),
      "_blank",
      "noopener,noreferrer"
    );
    open.mockRestore();
  });
});
