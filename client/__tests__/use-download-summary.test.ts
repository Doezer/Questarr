/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", () => ({
  getQueryFn: vi.fn(() => async () => ({
    "game-1": { topStatus: "downloading", count: 1, downloadTypes: ["torrent"] },
  })),
}));

const { useDownloadSummary } = await import("../src/hooks/use-download-summary");

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useDownloadSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty object by default before data loads", () => {
    vi.mock("@/lib/queryClient", () => ({
      getQueryFn: vi.fn(() => async () => undefined),
    }));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useDownloadSummary(), { wrapper });
    expect(result.current).toEqual({});
  });

  it("returns the summary data after query resolves", async () => {
    const mockData = {
      "game-1": {
        topStatus: "downloading" as const,
        count: 1,
        downloadTypes: ["torrent" as const],
      },
    };

    const { getQueryFn } = await import("@/lib/queryClient");
    vi.mocked(getQueryFn).mockReturnValue(async () => mockData);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useDownloadSummary(), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual(mockData);
    });
  });

  it("calls getQueryFn with on401: returnNull", async () => {
    const { getQueryFn } = await import("@/lib/queryClient");
    vi.mocked(getQueryFn).mockReturnValue(async () => ({}));

    const wrapper = createWrapper();
    renderHook(() => useDownloadSummary(), { wrapper });

    expect(getQueryFn).toHaveBeenCalledWith({ on401: "returnNull" });
  });
});
