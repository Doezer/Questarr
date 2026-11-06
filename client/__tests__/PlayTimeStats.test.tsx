/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import PlayTimeStats from "../src/components/PlayTimeStats";
import type { PlayTimeStats as Data } from "@shared/play-stats";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const empty: Data = {
  totalMinutes: 0,
  sessionCount: 0,
  longestSession: null,
  currentStreakDays: 0,
  longestStreakDays: 0,
  topGames: [],
  topGenres: [],
  topPlatforms: [],
  perWeek: [],
  perMonth: [],
};

function renderStats(data: Data) {
  apiRequest.mockResolvedValue({ json: async () => data });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PlayTimeStats />
    </QueryClientProvider>
  );
}

describe("PlayTimeStats", () => {
  afterEach(() => apiRequest.mockReset());

  it("sends the browser's time zone name and offset", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    renderStats(empty);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "GET",
        `/api/stats/play-time?tz=${new Date().getTimezoneOffset()}&timeZone=${encodeURIComponent(zone)}`
      )
    );
  });

  it("explains how to start tracking when there are no sessions", async () => {
    renderStats(empty);
    expect(await screen.findByText(/No play sessions yet/)).toBeInTheDocument();
  });

  it("shows totals, streak, most played games and tags", async () => {
    renderStats({
      ...empty,
      totalMinutes: 600,
      sessionCount: 4,
      longestSession: { gameId: "g-1", title: "Portal", minutes: 180 },
      currentStreakDays: 3,
      longestStreakDays: 5,
      topGames: [
        { gameId: "g-1", title: "Portal", minutes: 420, sessions: 3, timeToBeatHours: 10 },
        { gameId: "g-2", title: "Celeste", minutes: 180, sessions: 1, timeToBeatHours: null },
      ],
      topGenres: [{ name: "Puzzle", minutes: 420 }],
      topPlatforms: [{ name: "PC", minutes: 600 }],
    });

    await waitFor(() =>
      expect(screen.getByTestId("text-stats-value-time-played")).toHaveTextContent("10h")
    );
    expect(screen.getByTestId("text-stats-value-sessions")).toHaveTextContent("4");
    expect(screen.getByTestId("text-stats-value-longest-session")).toHaveTextContent("3h");
    expect(screen.getByTestId("text-stats-value-play-streak")).toHaveTextContent("3 days");
    expect(screen.getByText("best 5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portal" })).toHaveAttribute("href", "/games/g-1");
    expect(screen.getByText("7h / ~10h")).toBeInTheDocument();
    expect(screen.getByText("Puzzle")).toBeInTheDocument();
    expect(screen.getByText("PC")).toBeInTheDocument();
  });
});
