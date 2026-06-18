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

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(async () => ({ json: async () => [] })),
    queryClient: new QueryClient(),
  };
});

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
}));

describe("StatsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as typeof fetch;
  });

  it("renders the Statistics heading", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <StatsPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Statistics")).toBeInTheDocument();
  });
});
