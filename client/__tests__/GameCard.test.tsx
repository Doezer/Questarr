/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import GameCard from "../src/components/GameCard";
import React from "react";
import { type Game } from "@shared/schema";
import "@testing-library/jest-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mocks
const { mockInvalidateQueries, mockMutateAsync, mockToast } = vi.hoisted(() => {
  return {
    mockInvalidateQueries: vi.fn(),
    mockMutateAsync: vi.fn(),
    mockToast: vi.fn(),
  };
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
    useMutation: () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock icons to avoid issues with rendering SVGs in jsdom
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
  };
});

// Mock StatusBadge
vi.mock("../src/components/StatusBadge", () => ({
  default: ({ status }: { status: string }) => <div data-testid={`status-${status}`}>{status}</div>,
}));

describe("GameCard", () => {
  const mockGame: Game = {
    id: "1",
    title: "Test Game",
    coverUrl: "http://example.com/cover.jpg",
    status: "wanted",
    releaseDate: "2023-01-01",
    rating: 8.5,
    genres: ["Action", "Adventure"],
    summary: "Test summary",
    releaseStatus: "released",
    hidden: false,
    folderName: "Test Game",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
  };

  it("renders accessible rating with aria-label", () => {
    renderWithProviders(<GameCard game={mockGame} />);

    // Find by role 'img' and the expected label
    const ratingElement = screen.getByRole("img", { name: "Rating: 8.5 out of 10" });
    expect(ratingElement).toBeInTheDocument();

    // Also verify the visible text is still there
    expect(screen.getByText("8.5/10")).toBeInTheDocument();
  });

  it("renders accessible release date with aria-label", () => {
    renderWithProviders(<GameCard game={mockGame} />);

    // Find by role 'img' and the expected label
    const dateElement = screen.getByRole("img", { name: "Release Date: 2023-01-01" });
    expect(dateElement).toBeInTheDocument();

    // Also verify the visible text is still there
    expect(screen.getByText("2023-01-01")).toBeInTheDocument();
  });

  it("handles missing rating correctly", () => {
    const gameWithoutRating = { ...mockGame, rating: null };
    renderWithProviders(<GameCard game={gameWithoutRating} />);

    const ratingElement = screen.getByRole("img", { name: "Rating: Not available" });
    expect(ratingElement).toBeInTheDocument();
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("handles missing release date correctly", () => {
    const gameWithoutDate = { ...mockGame, releaseDate: null };
    renderWithProviders(<GameCard game={gameWithoutDate} />);

    const dateElement = screen.getByRole("img", { name: "Release Date: To be announced" });
    expect(dateElement).toBeInTheDocument();

    // "TBA" appears in both the release date text and the status badge
    const tbaElements = screen.getAllByText("TBA");
    expect(tbaElements.length).toBeGreaterThan(0);
  });
});
