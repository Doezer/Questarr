/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LogsPage from "../src/pages/logs";

const { apiRequestMock, useLogStreamMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useLogStreamMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: apiRequestMock,
    queryClient: new QueryClient(),
  };
});

vi.mock("@/hooks/use-log-stream", () => ({
  useLogStream: (onLine: (line: string) => void) => {
    useLogStreamMock(onLine);
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function createLogLine(index: number, extraFields: Record<string, unknown> = {}) {
  return JSON.stringify({
    level: 30,
    time: `2026-04-16T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
    module: "routes",
    msg: `Log message ${index}`,
    ...extraFields,
  });
}

describe("LogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    apiRequestMock.mockResolvedValue({
      json: async () => ({
        lines: Array.from({ length: 300 }, (_, index) => createLogLine(index)),
      }),
    } as Response);
  });

  it("window-renders large log buffers instead of mounting every row", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <LogsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Server Logs");

    await waitFor(() => {
      const rows = screen.getAllByTestId("log-line-row");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(100);
    });

    expect(screen.getByText("Log message 0")).toBeInTheDocument();
    expect(useLogStreamMock).toHaveBeenCalled();
  });

  it("shows every parsed JSON field in the log inspector", async () => {
    apiRequestMock.mockResolvedValue({
      json: async () => ({
        lines: [
          createLogLine(1, {
            userId: 42,
            gameId: 7,
            method: "GET",
            path: "/api/logs",
            error: {
              message: "Boom",
              stack: "stack-trace-line",
            },
          }),
        ],
      }),
    } as Response);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <LogsPage />
      </QueryClientProvider>
    );

    const row = await screen.findByRole("button", { name: /Inspect log Log message 1/i });
    fireEvent.click(row);

    expect(await screen.findByText("Log details")).toBeInTheDocument();
    expect(screen.getByText("userId: 42")).toBeInTheDocument();
    expect(screen.getByText("gameId: 7")).toBeInTheDocument();
    expect(screen.getByText("/api/logs")).toBeInTheDocument();

    expect(screen.getAllByText(/Boom/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/stack-trace-line/).length).toBeGreaterThan(0);

    expect(screen.getByText(/"userId":42/)).toBeInTheDocument();
    expect(screen.getByText(/"path":"\/api\/logs"/)).toBeInTheDocument();
  });
});
