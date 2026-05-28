/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GameGrid from "../src/components/GameGrid";

const { mobileState } = vi.hoisted(() => ({
  mobileState: { value: false },
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("../src/components/GameCard", () => ({
  default: ({
    game,
    isDiscovery,
  }: {
    game: { id: string; title: string };
    isDiscovery?: boolean;
  }) => (
    <div
      data-testid={`game-card-${game.id}`}
    >{`${game.title}-${isDiscovery ? "discovery" : "library"}`}</div>
  ),
}));

vi.mock("../src/components/CompactGameCard", () => ({
  default: ({
    game,
    density,
    mobileLayout,
    useSubgrid,
  }: {
    game: { id: string; title: string };
    density?: string;
    mobileLayout?: boolean;
    useSubgrid?: boolean;
  }) => (
    <div
      data-testid={`compact-card-${game.id}`}
      data-density={density}
      data-mobile-layout={mobileLayout ? "true" : "false"}
      data-subgrid={useSubgrid ? "true" : "false"}
    >
      {game.title}
    </div>
  ),
}));

describe("GameGrid", () => {
  const games = [
    { id: "g1", title: "Game 1", status: "wanted" },
    { id: "g2", title: "Game 2", status: "owned" },
  ] as never;

  beforeEach(() => {
    mobileState.value = false;
  });

  it("renders loading skeletons for grid and list layouts", () => {
    const { rerender } = render(<GameGrid games={games} isLoading columns={2} />);
    const loadingGrid = screen.getByTestId("grid-games-loading");
    expect(loadingGrid).toHaveClass("grid-cols-2");

    rerender(<GameGrid games={games} isLoading viewMode="list" />);
    expect(screen.getByTestId("grid-games-loading")).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<GameGrid games={[]} />);
    expect(screen.getByTestId("text-no-games")).toHaveTextContent("No games found");
  });

  it("covers every grid column mapping including the default", () => {
    const expectations = new Map<number, string>([
      [2, "grid-cols-2"],
      [3, "sm:grid-cols-3"],
      [4, "md:grid-cols-4"],
      [5, "md:grid-cols-5"],
      [6, "md:grid-cols-6"],
      [7, "md:grid-cols-7"],
      [8, "md:grid-cols-8"],
      [9, "md:grid-cols-9"],
      [10, "md:grid-cols-10"],
      [11, "xl:grid-cols-10"],
    ]);

    const { rerender } = render(<GameGrid games={games} columns={2} />);
    for (const [columns, className] of expectations) {
      rerender(<GameGrid games={games} columns={columns} isFetching={columns === 11} />);
      expect(screen.getByTestId("grid-games")).toHaveClass(className);
    }
    expect(screen.getByTestId("game-card-g1")).toHaveTextContent("Game 1-library");
  });

  it("renders mobile list mode with compact cards", () => {
    mobileState.value = true;
    render(
      <GameGrid
        games={games}
        viewMode="list"
        density="compact"
        isDiscovery
        downloadSummaries={{ g1: { progress: 50 } as never }}
      />
    );

    expect(screen.getByTestId("grid-games")).toBeInTheDocument();
    expect(screen.getByTestId("compact-card-g1")).toHaveAttribute("data-mobile-layout", "true");
    expect(screen.getByTestId("compact-card-g1")).toHaveAttribute("data-density", "compact");
  });

  it("renders desktop comfortable and compact list layouts with subgrid rows", () => {
    const { rerender } = render(<GameGrid games={games} viewMode="list" density="comfortable" />);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByTestId("compact-card-g1")).toHaveAttribute("data-subgrid", "true");

    rerender(<GameGrid games={games} viewMode="list" density="compact" isFetching />);
    expect(screen.getByTestId("grid-games")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByText("Title").length).toBeGreaterThan(0);
  });
});
