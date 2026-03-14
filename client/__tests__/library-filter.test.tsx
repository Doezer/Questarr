/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import LibraryPage from "../src/pages/library";

const mockGames = [
  { id: "1", title: "Game 1", status: "owned", hidden: false },
  { id: "2", title: "Game 2", status: "wanted", hidden: false },
  { id: "3", title: "Game 3", status: "completed", hidden: false },
  { id: "4", title: "Game 4", status: "downloading", hidden: false },
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

describe("LibraryPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  it("filters games to only show owned, completed, or downloading statuses", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
        <LibraryPage />
      </TooltipProvider>
      </QueryClientProvider>
    );

    // Give it a tick to render
    await screen.findByText("Library");

    // The grid should render Game 1, 3, 4, but not 2
    expect(screen.queryByTestId("text-title-1")).toBeInTheDocument();
    expect(screen.queryByTestId("text-title-3")).toBeInTheDocument();
    expect(screen.queryByTestId("text-title-4")).toBeInTheDocument();
    expect(screen.queryByTestId("text-title-2")).not.toBeInTheDocument();
  });
});
