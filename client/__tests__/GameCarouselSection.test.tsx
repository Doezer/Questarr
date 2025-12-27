import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import GameCarouselSection from "@/components/GameCarouselSection";
import { vi } from "vitest";

/** @vitest-environment jsdom */

// Mock browser APIs for carousel component
if (typeof window !== "undefined") {
  window.matchMedia =
    window.matchMedia ||
    function () {
      return {
        matches: false,
        addListener: function () {},
        removeListener: function () {},
      };
    };

  class MockIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  window.IntersectionObserver = MockIntersectionObserver as any;

  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  window.ResizeObserver = MockResizeObserver as any;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const mockGames = Array.from({ length: 7 }, (_, i) => ({
  id: `${i + 1}`,
  name: `Game ${i + 1}`,
  cover: { url: `url${i + 1}` },
}));

const mockQueryFn = vi.fn().mockResolvedValue(mockGames);

const renderComponent = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GameCarouselSection
          title="Popular Games"
          queryKey={["popular"]}
          queryFn={mockQueryFn}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

describe("GameCarouselSection", () => {
  it("renders the carousel with navigation buttons", async () => {
    renderComponent();

    // Wait for the games to be loaded
    await screen.findAllByText("Upcoming");

    expect(screen.getByLabelText("Previous")).toBeInTheDocument();
    expect(screen.getByLabelText("Next")).toBeInTheDocument();
  });
});
