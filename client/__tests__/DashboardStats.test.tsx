/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "../src/components/Dashboard";
import { TooltipProvider } from "../src/components/ui/tooltip";

// Mock dependencies
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock the API client
const mockGames = [
  {
    id: "1",
    title: "Game 1",
    status: "wanted",
    rating: 8,
    releaseDate: "2020-01-01",
    genres: ["RPG"],
    platforms: ["PC"],
    publishers: ["Pub 1"],
    developers: ["Dev 1"],
    summary: "Summary",
    coverUrl: "url",
  },
  {
    id: "2",
    title: "Game 2",
    status: "owned",
    rating: null, // missing rating
    releaseDate: "invalid date", // invalid date
    genres: ["Action", "RPG"],
    platforms: ["Console"],
    publishers: ["Pub 2"],
    developers: ["Dev 1"],
    summary: "Summary 2",
    coverUrl: "url2",
  },
];

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: mockGames,
      isLoading: false,
      isFetching: false,
    }),
  };
});

describe("Dashboard Stats Calculation", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("renders correctly and calculates stats without throwing", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Dashboard />
        </TooltipProvider>
      </QueryClientProvider>
    );

    // Verify it rendered successfully by checking if a title is present
    expect(screen.getByText("Recent Additions")).toBeDefined();
  });
});
