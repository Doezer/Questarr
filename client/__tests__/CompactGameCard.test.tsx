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
  const mockGame = {
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
  } as unknown as Game;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
  };

  it("renders game title and metadata correctly", () => {
    renderWithProviders(<CompactGameCard game={mockGame} />);

    expect(screen.getByText("Test Game")).toBeInTheDocument();
    expect(screen.getByText("8.5")).toBeInTheDocument();
    expect(screen.getByText("2023")).toBeInTheDocument();
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByText("Adventure")).toBeInTheDocument();
  });

  it("renders no genre pills when genres is empty", () => {
    const gameWithoutGenres = { ...mockGame, genres: [] };
    renderWithProviders(<CompactGameCard game={gameWithoutGenres} />);
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
    expect(screen.queryByText("Adventure")).not.toBeInTheDocument();
  });

  it("calls onStatusChange when a status chip is selected from the picker", async () => {
    const onStatusChange = vi.fn();
    renderWithProviders(<CompactGameCard game={mockGame} onStatusChange={onStatusChange} />);

    // Open the status picker via the trigger button
    const trigger = screen.getByLabelText(`Change status for ${mockGame.title}`);
    fireEvent.click(trigger);

    // Select "owned" from the chips
    const ownedChip = await screen.findByRole("button", { name: "owned" });
    fireEvent.click(ownedChip);

    expect(onStatusChange).toHaveBeenCalledWith("1", "owned");
  });

  it("calls onViewDetails when info button is clicked", () => {
    const onViewDetails = vi.fn();
    renderWithProviders(<CompactGameCard game={mockGame} onViewDetails={onViewDetails} />);

    // Info button is wrapped in a tooltip, but the button content is accessible via the icon mock or aria-label
    const infoButton = screen.getByLabelText(`View details for ${mockGame.title}`);
    fireEvent.click(infoButton);

    expect(onViewDetails).toHaveBeenCalledWith("1");
  });

  describe("status picker trigger", () => {
    it.each([
      { status: "wanted" as const },
      { status: "owned" as const },
      { status: "completed" as const },
      { status: "shelved" as const },
    ])("shows Change status trigger for $status", ({ status }) => {
      renderWithProviders(<CompactGameCard game={{ ...mockGame, status }} />);

      expect(screen.getByLabelText(`Change status for ${mockGame.title}`)).toBeInTheDocument();
    });
  });

  it("shows a loading fallback when opening details", async () => {
    renderWithProviders(<CompactGameCard game={mockGame} />);

    const infoButton = screen.getByLabelText(`View details for ${mockGame.title}`);
    fireEvent.click(infoButton);

    expect(await screen.findByText("Loading game details...")).toBeInTheDocument();
  });

  it("shows Early Access badge when earlyAccess is true", () => {
    const game = { ...mockGame, earlyAccess: true } as unknown as Game;
    renderWithProviders(<CompactGameCard game={game} />);
    expect(screen.getByText("EA")).toBeInTheDocument();
  });

  it("does not show Early Access badge when earlyAccess is false", () => {
    const game = { ...mockGame, earlyAccess: false } as unknown as Game;
    renderWithProviders(<CompactGameCard game={game} />);
    expect(screen.queryByText("Early Access")).not.toBeInTheDocument();
  });

  it("shows overflow pill when genres exceed 2", () => {
    const game = {
      ...mockGame,
      genres: ["Action", "Adventure", "RPG", "Strategy"],
    } as unknown as Game;
    renderWithProviders(<CompactGameCard game={game} />);
    expect(screen.getByText("Action")).toBeInTheDocument();
    expect(screen.getByText("Adventure")).toBeInTheDocument();
    // Both mobile card and comfortable list row render +2 more indicators
    const overflowIndicators = screen.getAllByText(/^\+2/);
    expect(overflowIndicators.length).toBeGreaterThanOrEqual(1);
  });
});
