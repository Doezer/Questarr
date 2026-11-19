/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import BacklogBurndown from "../src/components/BacklogBurndown";
import type { BacklogBurndown as Data } from "@shared/backlog-burndown";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const bucket = (start: string, backlog: number) => ({
  start,
  backlog,
  added: 0,
  completed: 0,
  remainingHours: backlog * 10,
});

const data: Data = {
  current: { backlog: 12, remainingHours: 130.5, withoutEstimate: 2 },
  perWeek: [bucket("2026-11-09", 14), bucket("2026-11-16", 12)],
  perMonth: [bucket("2026-10-01", 15), bucket("2026-11-01", 12)],
  projection: { hoursPerDay: 1.5, clearedOn: "2027-02-14" },
};

function renderIt(value: Data) {
  apiRequest.mockResolvedValue({ json: async () => value });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <BacklogBurndown />
    </QueryClientProvider>
  );
}

describe("BacklogBurndown", () => {
  afterEach(() => apiRequest.mockReset());

  it("sends the browser's time zone name and offset", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    renderIt(data);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "GET",
        `/api/stats/backlog?tz=${new Date().getTimezoneOffset()}&timeZone=${encodeURIComponent(zone)}`
      )
    );
  });

  it("shows the backlog, the time left and the projection", async () => {
    renderIt(data);
    expect(await screen.findByTestId("text-stats-value-in-backlog")).toHaveTextContent("12");
    expect(screen.getByTestId("text-stats-value-time-left")).toHaveTextContent("130.5 h");
    expect(screen.getByText("2 games without estimate")).toBeInTheDocument();
    expect(screen.getByTestId("text-stats-value-pace")).toHaveTextContent("1.5 h/day");
    expect(screen.getByTestId("backlog-projection")).toHaveTextContent(/1\.5 h per day/);
    expect(screen.getByTestId("backlog-projection")).toHaveTextContent(/2027/);
  });

  it("explains when no projection can be made", async () => {
    renderIt({ ...data, projection: { hoursPerDay: 0, clearedOn: null } });
    expect(await screen.findByTestId("backlog-projection")).toHaveTextContent(/No projection yet/);
  });

  it("says so when the backlog is empty", async () => {
    renderIt({
      current: { backlog: 0, remainingHours: 0, withoutEstimate: 0 },
      perWeek: [bucket("2026-11-16", 0)],
      perMonth: [bucket("2026-11-01", 0)],
      projection: { hoursPerDay: 0, clearedOn: null },
    });
    expect(await screen.findByText(/Your backlog is empty/)).toBeInTheDocument();
  });
});
