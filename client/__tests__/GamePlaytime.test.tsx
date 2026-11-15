/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import GamePlaytime from "../src/components/GamePlaytime";
import { toLocalInput } from "../src/components/PlaySessionDialogs";

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

  it("moves a long session from yesterday earlier so it does not end in the future", async () => {
    mockSessions([]);
    renderPlaytime();
    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    const date = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0"),
    ].join("-");

    fireEvent.change(await screen.findByLabelText("Played on"), { target: { value: date } });
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "23" } });
    fireEvent.click(screen.getByRole("button", { name: "Add session" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const body = apiRequest.mock.calls[0]?.[2] as { startedAt: string; durationMinutes: number };
    expect(body.durationMinutes).toBe(23 * 60);
    expect(new Date(body.startedAt).getTime() + 23 * 3_600_000).toBeLessThanOrEqual(Date.now());
  });

  it("keeps Add session disabled until a duration is entered", async () => {
    mockSessions([]);
    renderPlaytime();
    expect(await screen.findByRole("button", { name: "Add session" })).toBeDisabled();
  });

  it("edits the start and end of a session", async () => {
    mockSessions([finished("s-1", 90, 3)]);
    renderPlaytime();

    fireEvent.click(await screen.findByRole("button", { name: /^Edit the 1h 30m session/ }));
    fireEvent.change(await screen.findByLabelText("Started"), {
      target: { value: "2026-10-03T17:00" },
    });
    fireEvent.change(screen.getByLabelText("Stopped"), { target: { value: "2026-10-03T19:15" } });
    expect(screen.getByText("Length: 2h 15m")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [method, url, body] = apiRequest.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
    ];
    expect([method, url]).toEqual(["PATCH", "/api/games/g-1/play-sessions/s-1"]);
    expect(new Date(body.startedAt!).getTime()).toBe(new Date("2026-10-03T17:00").getTime());
    expect(new Date(body.endedAt!).getTime()).toBe(new Date("2026-10-03T19:15").getTime());
  });

  it("blocks an edit that ends before it starts", async () => {
    mockSessions([finished("s-1", 90, 3)]);
    renderPlaytime();

    fireEvent.click(await screen.findByRole("button", { name: /^Edit the 1h 30m session/ }));
    fireEvent.change(await screen.findByLabelText("Stopped"), {
      target: { value: "2026-10-01T10:00" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/at least a minute/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("splits a session at the chosen time", async () => {
    mockSessions([finished("s-1", 120, 3)]);
    renderPlaytime();

    fireEvent.click(await screen.findByRole("button", { name: /^Split the 2h session/ }));
    const cut = await screen.findByLabelText("Cut at");
    const start = new Date(finished("s-1", 120, 3).startedAt).getTime();
    const target = new Date(start + 30 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(cut, {
      target: {
        value: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [method, url, body] = apiRequest.mock.calls[0] as [string, string, { splitAt: string }];
    expect([method, url]).toEqual(["POST", "/api/games/g-1/play-sessions/s-1/split"]);
    expect(new Date(body.splitAt).getTime()).toBe(target.getTime());
  });

  it("splits at the exact midpoint when the cut is left alone", async () => {
    const session = {
      ...finished("s-1", 2, 3),
      startedAt: new Date(Date.UTC(2026, 9, 3, 10, 0, 45)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 9, 3, 10, 2, 45)).toISOString(),
    };
    mockSessions([session]);
    renderPlaytime();

    fireEvent.click(await screen.findByRole("button", { name: /^Split the / }));
    await screen.findByLabelText("Cut at");
    const split = screen.getByRole("button", { name: "Split" });
    expect(split).toBeEnabled();
    fireEvent.click(split);

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const body = apiRequest.mock.calls[0]?.[2] as { splitAt: string };
    expect(body.splitAt).toBe(new Date(Date.UTC(2026, 9, 3, 10, 1, 45)).toISOString());
  });

  it("merges the selected sessions", async () => {
    mockSessions([finished("s-1", 90, 3), finished("s-2", 30, 2)]);
    renderPlaytime();

    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(screen.queryByRole("button", { name: "Merge sessions" })).not.toBeInTheDocument();
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Merge sessions" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/games/g-1/play-sessions/merge", {
        sessionIds: ["s-1", "s-2"],
      })
    );
  });

  it("only offers delete for imported sessions", async () => {
    mockSessions([{ ...finished("s-1", 90, 3), source: "steam" }]);
    renderPlaytime();

    await screen.findByRole("button", { name: /^Delete the 1h 30m session/ });
    expect(screen.queryByRole("button", { name: /^Edit the/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Split the/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps the exact time of a field left alone when editing", async () => {
    const session = {
      ...finished("s-1", 90, 3),
      startedAt: new Date(Date.UTC(2026, 9, 3, 18, 0, 37)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 9, 3, 19, 30, 50)).toISOString(),
    };
    mockSessions([session]);
    renderPlaytime();

    fireEvent.click(await screen.findByRole("button", { name: /^Edit the 1h 30m session/ }));
    const localEnd = toLocalInput(new Date(Date.parse(session.startedAt) + 100 * 60_000));
    fireEvent.change(await screen.findByLabelText("Stopped"), { target: { value: localEnd } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const body = apiRequest.mock.calls[0]?.[2] as { startedAt: string; endedAt: string };
    expect(body.startedAt).toBe(session.startedAt);
    expect(new Date(body.endedAt).getTime()).toBe(new Date(localEnd).getTime());
  });
});
