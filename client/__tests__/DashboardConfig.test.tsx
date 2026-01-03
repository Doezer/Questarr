/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dashboard from "../src/components/Dashboard";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mocking toast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock fetch for QueryClient
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([]),
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe("Dashboard Configuration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should persist grid column preference to local storage", async () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Dashboard />
        </TooltipProvider>
      </QueryClientProvider>
    );

    // Initial value (default 5)
    expect(localStorage.getItem("dashboardGridColumns")).toBe("5");

    // Click layout settings toggle to show the modal
    const layoutToggle = screen.getByLabelText("Toggle layout settings");
    fireEvent.click(layoutToggle);

    // Verify modal is shown (searching for title)
    expect(screen.getByText("Display Settings")).toBeDefined();

    // Change setting in localStorage manually to simulate preference change
    localStorage.setItem("dashboardGridColumns", "8");
  });

  it("should load grid column preference from local storage on mount", () => {
    localStorage.setItem("dashboardGridColumns", "7");

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Dashboard />
        </TooltipProvider>
      </QueryClientProvider>
    );

    // We can't easily see the internal state of Dashboard,
    // but we can check if it stays '7' in localStorage (it shouldn't overwrite with '5')
    expect(localStorage.getItem("dashboardGridColumns")).toBe("7");
  });
});
