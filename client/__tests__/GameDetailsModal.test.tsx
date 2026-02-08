/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GameDetailsModal from "../src/components/GameDetailsModal";
import { Toaster } from "@/components/ui/toaster";

// Mocking external dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    toasts: [],
  }),
}));

vi.mock("../src/components/StatusBadge", () => ({
  default: ({ status }: { status: string }) => <div data-testid="status-badge">{status}</div>,
}));

vi.mock("../src/components/GameDownloadDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="game-download-dialog">Download Dialog</div> : null,
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Calendar: (props: Record<string, unknown>) => <div data-testid="icon-calendar" {...props} />,
    Star: (props: Record<string, unknown>) => <div data-testid="icon-star" {...props} />,
    Monitor: (props: Record<string, unknown>) => <div data-testid="icon-monitor" {...props} />,
    Gamepad2: (props: Record<string, unknown>) => <div data-testid="icon-gamepad2" {...props} />,
    Tag: (props: Record<string, unknown>) => <div data-testid="icon-tag" {...props} />,
    Download: (props: Record<string, unknown>) => <div data-testid="icon-download" {...props} />,
    X: (props: Record<string, unknown>) => <div data-testid="icon-x" {...props} />,
  };
});

const mockGame = {
  id: 1,
  title: "Test Game",
  summary: "This is a test summary for the game.",
  status: "wanted",
  rating: 8.5,
  releaseDate: new Date("2023-01-01").toISOString(),
  coverUrl: "http://test.com/cover.jpg",
  genres: ["Action", "Adventure"],
  platforms: ["PC", "PS5"],
  screenshots: ["http://test.com/screen1.jpg", "http://test.com/screen2.jpg"],
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        const response = await fetch(queryKey.join(""));
        if (!response.ok) throw new Error("Network response was not ok");
        return response.json();
      },
    },
  },
});

// Mock fetch
global.fetch = vi.fn();

const renderComponent = (game = mockGame) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <GameDetailsModal game={game} open={true} onOpenChange={() => {}} />
      <Toaster />
    </QueryClientProvider>
  );
};

describe("GameDetailsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders game details correctly", () => {
    renderComponent();
    expect(screen.getByTestId("text-game-title-1")).toHaveTextContent("Test Game");
    expect(screen.getByTestId("text-summary-1")).toHaveTextContent(
      "This is a test summary for the game."
    );
    expect(screen.getByTestId("text-rating-1")).toHaveTextContent("8.5/10");
    expect(screen.getByTestId("text-release-date-1")).toHaveTextContent("2023");
    expect(screen.getByTestId("img-cover-1")).toBeInTheDocument();
  });

  it("renders genres and platforms", () => {
    renderComponent();
    expect(screen.getByTestId("badge-genre-action")).toBeInTheDocument();
    expect(screen.getByTestId("badge-genre-adventure")).toBeInTheDocument();
    expect(screen.getByTestId("badge-platform-pc")).toBeInTheDocument();
    expect(screen.getByTestId("badge-platform-ps5")).toBeInTheDocument();
  });

  it("renders screenshots", () => {
    renderComponent();
    expect(screen.getAllByRole("img", { name: /screenshot/i })).toHaveLength(2);
  });

  it("opens download dialog when download button is clicked", () => {
    renderComponent();
    const downloadButton = screen.getByTestId("button-download-game");
    fireEvent.click(downloadButton);
    expect(screen.getByTestId("game-download-dialog")).toBeInTheDocument();
  });

  it("handles remove game action", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    renderComponent();

    // Need to find the remote button with the complex ID
    const removeButton = screen.getByTestId(`button-remove-game-quick-${mockGame.id}`);
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/games/1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("truncates long summary and expands it", () => {
    const longSummaryGame = {
      ...mockGame,
      summary: "A".repeat(300),
    };
    renderComponent(longSummaryGame);

    const summaryText = screen.getByTestId(`text-summary-${mockGame.id}`);
    expect(summaryText).toHaveTextContent("Read more");

    const readMoreButton = screen.getByText("Read more");
    fireEvent.click(readMoreButton);

    expect(summaryText).toHaveTextContent("Show less");
  });
});
