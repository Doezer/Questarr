/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  range: { from: null, to: null },
  totalMinutes: 0,
  sessionCount: 0,
  longestSession: null,
  currentStreakDays: 0,
  longestStreakDays: 0,
  topGames: [],
  goals: [],
  topGenres: [],
  topPlatforms: [],
  perWeek: [],
  perMonth: [],
  sessionStats: { sampleSize: 0, averageMinutes: 0, medianMinutes: 0, buckets: [] },
  heatmap: { days: [], perWeekday: [0, 0, 0, 0, 0, 0, 0], perHour: new Array<number>(24).fill(0) },
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

  it("lists finish-by goals even before any session", async () => {
    renderStats({
      ...empty,
      goals: [
        {
          gameId: "g-9",
          title: "Hades",
          finishBy: "2026-12-01",
          status: "behind",
          daysLeft: 10,
          remainingMinutes: 600,
          neededMinutesPerDay: 55,
          recentMinutesPerDay: 20,
          playedMinutes: 0,
          timeToBeatHours: 10,
        },
      ],
    });
    expect(await screen.findByText("Finish-by goals")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hades" })).toHaveAttribute("href", "/games/g-9");
    expect(screen.getByText("Behind")).toBeInTheDocument();
    expect(screen.getByText(/10 days left · 10h to beat · 55m\/day needed/)).toBeInTheDocument();
  });

  it("draws the heatmap and session length figures", async () => {
    renderStats({
      ...empty,
      totalMinutes: 150,
      sessionCount: 2,
      topGames: [
        { gameId: "g-1", title: "Portal", minutes: 150, sessions: 2, timeToBeatHours: null },
      ],
      sessionStats: {
        sampleSize: 2,
        averageMinutes: 75,
        medianMinutes: 75,
        buckets: [
          { label: "30–60 min", count: 1 },
          { label: "1–2 h", count: 1 },
        ],
      },
      heatmap: {
        days: [
          { start: "2026-11-02", minutes: 0 },
          { start: "2026-11-03", minutes: 90 },
          { start: "2026-11-04", minutes: 60 },
        ],
        perWeekday: [0, 90, 60, 0, 0, 0, 0],
        perHour: new Array<number>(24).fill(0),
      },
    });
    const heatmap = await screen.findByTestId("play-heatmap");
    expect(within(heatmap).getAllByRole("img")).toHaveLength(3);
    expect(within(heatmap).getByLabelText(/(Nov 3, 2026|3 Nov 2026): 1h 30m/)).toBeInTheDocument();
    expect(within(heatmap).getByLabelText(/(Nov 2, 2026|2 Nov 2026): no play/)).toBeInTheDocument();
    const lengths = screen.getByTestId("play-session-lengths");
    expect(lengths).toHaveTextContent("Average 1h 15m");
    expect(lengths).toHaveTextContent("Median 1h 15m");
  });

  it("downloads the export with the current range", async () => {
    renderStats({ ...empty, sessionCount: 1, totalMinutes: 30 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("a,b", { status: 200 }));
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/stats/play-time/export?tz=");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("format=csv");
    fetchSpy.mockRestore();
  });

  it("keeps the all-time charts when the selected range has no sessions", async () => {
    renderStats({
      ...empty,
      range: { from: "2025-01-01", to: "2025-01-31" },
      longestStreakDays: 4,
      perWeek: [{ start: "2026-11-02", minutes: 120 }],
    });
    expect(await screen.findByText(/No play sessions in this range/)).toBeInTheDocument();
    expect(screen.getByText("Hours played")).toBeInTheDocument();
    expect(screen.getByText("best 4")).toBeInTheDocument();
  });

  it("keeps the range controls and offers a retry when the request fails", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <PlayTimeStats />
      </QueryClientProvider>
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load/);
    expect(screen.getByLabelText("Range")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
