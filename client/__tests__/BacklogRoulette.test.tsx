/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@shared/schema";
import BacklogRoulette from "../src/components/BacklogRoulette";

vi.mock("@/components/GameDetailsModal", () => ({
  default: ({ game, onOpenChange }: { game: Game; onOpenChange: (open: boolean) => void }) => (
    <div role="dialog" aria-label="Game details">
      <h2>{game.title}</h2>
      <p>Rating: {game.userRating}</p>
      <button onClick={() => onOpenChange(false)}>Close details</button>
    </div>
  ),
}));

/** Build a Library fixture with the fields used by roulette. */
function game(id: string, status = "owned", hidden = false): Game {
  return {
    id,
    title: `Quest ${id}`,
    status,
    hidden,
    genres: ["Adventure"],
    platforms: ["PC"],
  } as Game;
}

/** Select a pool through the real Radix dropdown's keyboard interaction. */
async function choosePool(name: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Pick from" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name, exact: true }));
}

describe("Backlog roulette", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint32Array) array[0] = 0;
      return array;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("draws only visible owned games and never repeats on consecutive rerolls", () => {
    render(
      <BacklogRoulette
        games={[game("a"), game("b"), game("hidden", "owned", true), game("wanted", "wanted")]}
        loading={false}
        onStartPlaying={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest a");
    expect(screen.getByText("Chosen from 2 matching games.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Roll again" }));
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest b");
    fireEvent.click(screen.getByRole("button", { name: "Roll again" }));
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest a");
  });

  it("supports playing and all-visible pools while always excluding hidden games", async () => {
    render(
      <BacklogRoulette
        games={[
          game("playing", "playing"),
          game("wanted", "wanted"),
          game("hidden", "playing", true),
        ]}
        loading={false}
        onStartPlaying={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    expect(screen.getByText("No games in this draw")).toBeVisible();
    expect(screen.getByRole("button", { name: "Roll again" })).toBeDisabled();
    await choosePool("Currently playing");
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest playing");
    expect(screen.getByText("Chosen from 1 matching game.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Roll again" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Mark as Playing" })).not.toBeInTheDocument();
    await choosePool("All visible games");
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest wanted");
    expect(screen.getByText("Chosen from 2 matching games.")).toBeVisible();
  });

  it("does not draw while loading and discards a choice removed by updated filters", () => {
    const props = { games: [game("a")], loading: true, onStartPlaying: vi.fn() };
    const { rerender } = render(<BacklogRoulette {...props} />);
    expect(screen.getByRole("button", { name: "Pick a game" })).toBeDisabled();
    rerender(<BacklogRoulette {...props} loading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest a");
    rerender(<BacklogRoulette {...props} games={[game("b")]} loading={false} />);
    expect(screen.getByText("Ready for another quest?")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mark as Playing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Roll again" }));
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest b");
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(screen.queryByRole("dialog", { name: "Backlog roulette" })).not.toBeInTheDocument();
  });

  it("opens the chosen game's details and closes them again", async () => {
    render(<BacklogRoulette games={[game("a")]} loading={false} onStartPlaying={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    fireEvent.click(screen.getByRole("button", { name: "View game" }));
    expect(await screen.findByRole("dialog", { name: "Game details" })).toHaveTextContent(
      "Quest a"
    );
    expect(screen.queryByRole("dialog", { name: "Backlog roulette" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("dialog", { name: "Game details" })).not.toBeInTheDocument();
  });

  it("keeps open details synchronized with refreshed Library data", async () => {
    const props = {
      games: [{ ...game("a"), userRating: 3 }],
      loading: false,
      onStartPlaying: vi.fn(),
    };
    const { rerender } = render(<BacklogRoulette {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    fireEvent.click(screen.getByRole("button", { name: "View game" }));
    expect(await screen.findByRole("dialog", { name: "Game details" })).toHaveTextContent(
      "Rating: 3"
    );
    rerender(<BacklogRoulette {...props} games={[{ ...game("a"), userRating: 5 }]} />);
    expect(screen.getByRole("dialog", { name: "Game details" })).toHaveTextContent("Rating: 5");
    rerender(<BacklogRoulette {...props} games={[]} />);
    expect(screen.queryByRole("dialog", { name: "Game details" })).not.toBeInTheDocument();
    rerender(<BacklogRoulette {...props} />);
    expect(screen.queryByRole("dialog", { name: "Game details" })).not.toBeInTheDocument();
  });

  it("keeps a failed save open for retry and closes only after a successful save", async () => {
    let rejectSave: (error: Error) => void = () => {};
    const pendingSave = new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    });
    const save = vi.fn().mockReturnValueOnce(pendingSave).mockResolvedValueOnce(undefined);
    render(
      <BacklogRoulette games={[game("a"), game("b")]} loading={false} onStartPlaying={save} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as Playing" }));
    expect(save).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: "Mark as Playing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Roll again" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "View game" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(screen.getByRole("dialog", { name: "Backlog roulette" })).toBeVisible();
    await act(async () => {
      rejectSave(new Error("Save failed"));
    });
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest a");
    expect(screen.getByRole("button", { name: "Mark as Playing" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mark as Playing" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Backlog roulette" })).not.toBeInTheDocument()
    );
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("rejects the biased tail of a random uint32 draw", () => {
    vi.mocked(crypto.getRandomValues).mockImplementationOnce((array) => {
      if (array instanceof Uint32Array) array[0] = 2 ** 32 - 1;
      return array;
    });
    render(
      <BacklogRoulette
        games={[game("a"), game("b"), game("c")]}
        loading={false}
        onStartPlaying={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick a game" }));
    expect(crypto.getRandomValues).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("roulette-title")).toHaveTextContent("Quest a");
  });
});
