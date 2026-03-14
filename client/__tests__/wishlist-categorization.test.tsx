/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import WishlistPage from "../src/pages/wishlist";

const now = new Date("2024-01-15T12:00:00Z");

const mockGames = [
  { id: "1", title: "Released Game", status: "wanted", releaseDate: "2024-01-01T00:00:00Z", hidden: false },
  { id: "2", title: "Upcoming Game", status: "wanted", releaseDate: "2024-02-01T00:00:00Z", hidden: false },
  { id: "3", title: "TBA Game", status: "wanted", releaseDate: null, hidden: false },
  { id: "4", title: "Owned Game", status: "owned", releaseDate: "2023-01-01T00:00:00Z", hidden: false },
];

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockImplementation(() => ({
      data: mockGames,
      isLoading: false,
    })),
    useMutation: vi.fn().mockImplementation(() => ({
      mutate: vi.fn(),
      isPending: false,
    })),
  };
});

describe("WishlistPage Categorization", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("categorizes games correctly based on current date", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
        <WishlistPage />
      </TooltipProvider>
      </QueryClientProvider>
    );

    // Assert sections exist
    expect(screen.getAllByText("Released").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Upcoming").length).toBeGreaterThan(0);
    expect(screen.getByText("To Be Announced")).toBeInTheDocument();

    // Assert correct games in correct sections
    // Released Game (Jan 1) should be in Released since "now" is Jan 15
    expect(screen.getByTestId("text-title-1")).toBeInTheDocument();

    // Upcoming Game (Feb 1) should be in Upcoming
    expect(screen.getByTestId("text-title-2")).toBeInTheDocument();

    // TBA Game should be in TBA
    expect(screen.getByTestId("text-title-3")).toBeInTheDocument();

    // Owned Game should NOT be rendered at all
    expect(screen.queryByTestId("text-title-4")).not.toBeInTheDocument();
  });
});
