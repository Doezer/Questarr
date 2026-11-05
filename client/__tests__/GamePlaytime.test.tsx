/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import GamePlaytime from "../src/components/GamePlaytime";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const finished = (id: string, minutes: number, day: number) => ({
  id,
  gameId: "g-1",
  userId: "u",
  startedAt: new Date(Date.UTC(2026, 9, day, 18, 0)).toISOString(),
  endedAt: new Date(Date.UTC(2026, 9, day, 18, 0) + minutes * 60_000).toISOString(),
  source: id === "s-2" ? "manual" : "timer",
});

function mockSessions(sessions: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    const body = u.includes("/play-sessions") ? sessions : { session: null };
    return { ok: true, json: async () => body } as Response;
  });
}

function renderPlaytime(timeToBeatHours: number | null = null) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <GamePlaytime gameId="g-1" gameTitle="Portal" timeToBeatHours={timeToBeatHours} />
    </QueryClientProvider>
  );
}

describe("GamePlaytime", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows an empty hint without sessions", async () => {
    mockSessions([]);
    renderPlaytime();
    expect(await screen.findByText(/No sessions yet/)).toBeInTheDocument();
    expect(screen.getByTestId("text-playtime-total")).toHaveTextContent("0m");
  });

  it("totals the finished sessions and compares with time to beat", async () => {
    mockSessions([finished("s-1", 90, 3), finished("s-2", 30, 2)]);
    renderPlaytime(12);

    await waitFor(() => expect(screen.getByTestId("text-playtime-total")).toHaveTextContent("2h"));
    expect(screen.getByText(/2 sessions · about 12h to beat/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Sessions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("manual")).toBeInTheDocument();
  });

  it("deletes a session", async () => {
    mockSessions([finished("s-1", 90, 3)]);
    renderPlaytime();

    fireEvent.click(await screen.findByRole("button", { name: /^Delete the 1h 30m session/ }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/games/g-1/play-sessions/s-1")
    );
  });

  it("adds a session for today without a start time", async () => {
    mockSessions([]);
    renderPlaytime();

    fireEvent.change(await screen.findByLabelText("Hours"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Add session" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/games/g-1/play-sessions", {
        startedAt: undefined,
        durationMinutes: 90,
      })
    );
  });

  it("adds a session for an earlier day at noon local time", async () => {
    mockSessions([]);
    renderPlaytime();

    fireEvent.change(await screen.findByLabelText("Played on"), {
      target: { value: "2026-01-02" },
    });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Add session" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const body = apiRequest.mock.calls[0]?.[2] as { startedAt: string; durationMinutes: number };
    expect(body.durationMinutes).toBe(45);
    expect(new Date(body.startedAt).getTime()).toBe(new Date("2026-01-02T12:00:00").getTime());
  });

  it("keeps Add session disabled until a duration is entered", async () => {
    mockSessions([]);
    renderPlaytime();
    expect(await screen.findByRole("button", { name: "Add session" })).toBeDisabled();
  });
});
