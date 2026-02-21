/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CompactGameCard from "../src/components/CompactGameCard";
import GameCard from "../src/components/GameCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Game } from "@shared/schema";

// Mock resize observer
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock components
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Download: () => <div data-testid="icon-download" />,
    Info: () => <div data-testid="icon-info" />,
    Star: () => <div data-testid="icon-star" />,
    Calendar: () => <div data-testid="icon-calendar" />,
    Eye: () => <div data-testid="icon-eye" />,
    EyeOff: () => <div data-testid="icon-eye-off" />,
    Loader2: () => <div data-testid="icon-loader" />,
    Plus: () => <div data-testid="icon-plus" />,
    Search: () => <div data-testid="icon-search" />,
  };
});

// Mock hooks
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Setup QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
};

const mockGame = {
  id: "1",
  title: "Test Game",
  coverUrl: "http://example.com/cover.jpg",
  status: "wanted",
  releaseDate: "2023-01-01",
  rating: 8.5,
  genres: ["Action"],
  summary: "Test summary",
  releaseStatus: "released",
  hidden: false,
  folderName: "Test Game",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Game;

describe("Accessibility Improvements", () => {
  describe("CompactGameCard", () => {
    it("should have descriptive aria-labels for Discovery mode", () => {
      renderWithProviders(<CompactGameCard game={mockGame} isDiscovery={true} />);

      expect(screen.getByLabelText(`Download ${mockGame.title}`)).toBeInTheDocument();
      expect(screen.getByLabelText(`View details for ${mockGame.title}`)).toBeInTheDocument();
    });

    it("should have descriptive aria-labels for Library mode", () => {
      renderWithProviders(<CompactGameCard game={mockGame} isDiscovery={false} />);

      expect(screen.getByLabelText(`View details for ${mockGame.title}`)).toBeInTheDocument();
      expect(screen.getByLabelText(`Hide ${mockGame.title}`)).toBeInTheDocument();
    });
  });

  describe("GameCard", () => {
    it("should have descriptive aria-labels for Discovery mode", () => {
      renderWithProviders(<GameCard game={mockGame} isDiscovery={true} />);

      expect(screen.getByLabelText(`Download ${mockGame.title}`)).toBeInTheDocument();
      expect(screen.getByLabelText(`View details for ${mockGame.title}`)).toBeInTheDocument();
    });

    it("should have descriptive aria-labels for Library mode", () => {
      renderWithProviders(<GameCard game={mockGame} isDiscovery={false} />);

      expect(screen.getByLabelText(`View details for ${mockGame.title}`)).toBeInTheDocument();
      expect(screen.getByLabelText(`Hide ${mockGame.title}`)).toBeInTheDocument();
    });
  });
});
