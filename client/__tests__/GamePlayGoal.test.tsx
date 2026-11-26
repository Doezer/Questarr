/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import GamePlayGoal from "../src/components/GamePlayGoal";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

type Props = React.ComponentProps<typeof GamePlayGoal>;
const base: Props = {
  gameId: "g-1",
  gameStatus: "playing",
  finishBy: null,
  playedMinutes: 600,
  recentMinutes: 14 * 60,
  timeToBeatHours: 20,
  today: "2026-11-14",
};

function ui(props: Partial<Props>) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <GamePlayGoal {...base} {...props} />
    </QueryClientProvider>
  );
}

describe("GamePlayGoal", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  it("invites to pick a day when there is no goal", () => {
    render(ui({}));
    expect(screen.getByText(/Pick a day to finish this game/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear goal/ })).not.toBeInTheDocument();
  });

  it("shows the status, time left and pace of a goal", () => {
    render(ui({ finishBy: "2026-11-23" }));
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("9 days left")).toBeInTheDocument();
    expect(screen.getByTestId("text-goal-pace")).toHaveTextContent(
      "10h left to beat · needs 1h/day · you average 1h/day (last 14 days)"
    );
  });

  it("only counts down without a Time to Beat", () => {
    render(ui({ finishBy: "2026-11-23", timeToBeatHours: null }));
    expect(screen.getByText("No estimate")).toBeInTheDocument();
    expect(screen.getByText(/IGDB has no Time to Beat/)).toBeInTheDocument();
  });

  it("saves a target day and shows it at once", async () => {
    render(ui({}));
    fireEvent.change(screen.getByLabelText("Target day"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/games/g-1/finish-by", {
        finishBy: "2026-11-30",
      })
    );
    expect(await screen.findByText("16 days left")).toBeInTheDocument();
  });

  it("clears the goal", async () => {
    render(ui({ finishBy: "2026-11-23" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear goal/ }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/games/g-1/finish-by", {
        finishBy: null,
      })
    );
    expect(await screen.findByText(/Pick a day to finish this game/)).toBeInTheDocument();
  });

  it("follows later server changes once the saved value has come back", async () => {
    const { rerender } = render(ui({}));
    fireEvent.change(screen.getByLabelText("Target day"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await screen.findByText("16 days left");

    // The game list refetches and agrees with what was saved...
    rerender(ui({ finishBy: "2026-11-30" }));
    // ...then another tab clears the goal.
    rerender(ui({ finishBy: null }));
    await waitFor(() =>
      expect(screen.getByText(/Pick a day to finish this game/)).toBeInTheDocument()
    );
  });
});
