// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GameCard from "../src/components/GameCard";
import { Game } from "@shared/schema";
import * as toastHook from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mocks
vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(),
    queryClient: new QueryClient(),
  };
});

// Setup QueryClient
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const mockGame: Game = {
  id: "game-123",
  title: "Super Mario Odyssey",
  coverUrl: "http://example.com/mario.jpg",
  rating: 9,
  releaseDate: "2017-10-27",
  genres: ["Platformer", "Action"],
  status: "wanted",
  hidden: false,
  summary: "Mario travels the world.",
  igdbId: 123,
  platform: "Nintendo Switch",
  releaseStatus: "released",
  folderName: null,
  monitored: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("GameCard", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
    (toastHook.useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: mockToast,
    });
  });

  const renderComponent = (component: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{component}</TooltipProvider>
      </QueryClientProvider>
    );
  };

  it("renders with correct accessibility labels", async () => {
    renderComponent(<GameCard game={mockGame} />);

    // Check for "View details" button
    const detailsButton = screen.getByRole("button", {
      name: `View details for ${mockGame.title}`,
    });
    expect(detailsButton).toBeInTheDocument();

    // Check for "Hide game" button
    const hideButton = screen.getByRole("button", {
      name: `Hide ${mockGame.title}`,
    });
    expect(hideButton).toBeInTheDocument();
  });

  it("renders 'Unhide' label when game is hidden", async () => {
    const hiddenGame = { ...mockGame, hidden: true };
    renderComponent(<GameCard game={hiddenGame} />);

    const unhideButton = screen.getByRole("button", {
      name: `Unhide ${hiddenGame.title}`,
    });
    expect(unhideButton).toBeInTheDocument();
  });

  it("renders download button with correct label in discovery mode", async () => {
    // Discovery mode uses a different button set
    renderComponent(<GameCard game={mockGame} isDiscovery={true} />);

    const downloadButton = screen.getByRole("button", {
      name: `Download ${mockGame.title}`,
    });
    expect(downloadButton).toBeInTheDocument();
  });
});
