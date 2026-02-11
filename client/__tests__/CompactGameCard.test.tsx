/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CompactGameCard from "../src/components/CompactGameCard";
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
    useQuery: () => ({
      data: undefined,
      isLoading: false,
      error: null,
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

describe("CompactGameCard", () => {
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

  it("renders game title and metadata correctly", () => {
    renderWithProviders(<CompactGameCard game={mockGame} />);

    expect(screen.getByText("Test Game")).toBeInTheDocument();
    expect(screen.getByText("8.5/10")).toBeInTheDocument();
    expect(screen.getByText("2023-01-01")).toBeInTheDocument();
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByText("Adventure")).toBeInTheDocument();
  });

  it("renders 'No genres' when genres is empty or undefined", () => {
    const gameWithoutGenres = { ...mockGame, genres: [] };
    renderWithProviders(<CompactGameCard game={gameWithoutGenres} />);
    expect(screen.getByText("No genres")).toBeInTheDocument();
  });

  it("calls onStatusChange when status button is clicked", () => {
    const onStatusChange = vi.fn();
    renderWithProviders(<CompactGameCard game={mockGame} onStatusChange={onStatusChange} />);

    const button = screen.getByText("Mark Owned");
    fireEvent.click(button);

    expect(onStatusChange).toHaveBeenCalledWith("1", "owned");
  });

  it("calls onViewDetails when info button is clicked", () => {
    const onViewDetails = vi.fn();
    renderWithProviders(<CompactGameCard game={mockGame} onViewDetails={onViewDetails} />);

    // Info button is wrapped in a tooltip, but the button content is accessible via the icon mock or aria-label
    const infoButton = screen.getByLabelText("View details for Test Game");
    fireEvent.click(infoButton);

    expect(onViewDetails).toHaveBeenCalledWith("1");
  });
});
