/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
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

function createLogLine(index: number) {
  return JSON.stringify({
    level: 30,
    time: `2026-04-16T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
    module: "routes",
    msg: `Log message ${index}`,
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
});
