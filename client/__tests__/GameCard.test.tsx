/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import GameCard from "../src/components/GameCard";
import { Game } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock Tooltip
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock useToast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock Card components
vi.mock("@/components/ui/card", () => ({
  Card: React.forwardRef(({ children, className, onClick }: any, ref: any) => (
    <div ref={ref} className={className} onClick={onClick}>{children}</div>
  )),
  CardContent: ({ children, className, onClick }: any) => <div className={className} onClick={onClick}>{children}</div>,
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const mockGame: Game = {
  id: "1",
  title: "Test Game",
  status: "wanted",
  platform: "PC",
  igdbId: 123,
  releaseDate: "2023-01-01",
  coverUrl: "http://example.com/cover.jpg",
  rating: 85,
  summary: "A test game",
  genres: ["Action"],
  hidden: false,
  releaseStatus: "released",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("GameCard Accessibility", () => {
  it("has accessible labels for status toggle button", () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <GameCard
          game={mockGame}
        />
      </QueryClientProvider>
    );

    // The status is "wanted", so the next status is "owned"
    const statusButton = screen.getByRole("button", { name: /Mark Test Game as Owned/i });
    expect(statusButton).toBeInTheDocument();
  });

  it("has accessible labels for details button", () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <GameCard
          game={mockGame}
        />
      </QueryClientProvider>
    );

    const detailsButton = screen.getByRole("button", { name: /View details for Test Game/i });
    expect(detailsButton).toBeInTheDocument();
  });

  it("has accessible labels for hide button", () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <GameCard
          game={mockGame}
        />
      </QueryClientProvider>
    );

    const hideButton = screen.getByRole("button", { name: /Hide Test Game/i });
    expect(hideButton).toBeInTheDocument();
  });
});
