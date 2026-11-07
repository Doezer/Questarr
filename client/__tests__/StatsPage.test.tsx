/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StatsPage from "../src/pages/stats";
import { createTestQueryClient } from "./test-utils";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

// Stub apiRequest so game and discord-config queries resolve without network
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async (_method: string, url: string) => ({
    json: async () => (url.includes("/api/stats/play-time") ? { sessionCount: 0 } : []),
  })),
}));

vi.mock("@/components/StatsCard", () => ({
  default: ({ title, value }: { title: string; value: number | string }) => (
    <div data-testid="stats-card">
      {title}: {value}
    </div>
  ),
}));

vi.mock("@/components/ShareDiscordDialog", () => ({
  default: () => null,
}));

vi.mock("recharts", () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  Tooltip: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe("StatsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Statistics heading", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <StatsPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Statistics")).toBeInTheDocument();
  });

  it("renders stats cards when games are loaded", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <StatsPage />
      </QueryClientProvider>
    );

    const cards = await screen.findAllByTestId("stats-card");
    expect(cards.length).toBeGreaterThan(0);
  });
});
