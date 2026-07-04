/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Game } from "@shared/schema";
import GameCard from "../src/components/GameCard";

const { apiRequestMock, invalidateQueriesMock, toastMock, mutationState, mobileState } = vi.hoisted(
  () => ({
    apiRequestMock: vi.fn(),
    invalidateQueriesMock: vi.fn(),
    toastMock: vi.fn(),
    mutationState: {
      config: null,
      pending: false,
    },
    mobileState: { value: false },
  })
);

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
    useMutation: (config: Record<string, unknown>) => {
      mutationState.config = config;
      return {
        mutateAsync: async (game: Game) => {
          const result = await (config.mutationFn as (game: Game) => Promise<Game>)(game);
          (config.onSuccess as ((game: Game) => void) | undefined)?.(result);
          return result;
        },
        isPending: mutationState.pending,
      };
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("@/lib/queryClient", () => {
  class MockApiError extends Error {
    status: number;
    data: unknown;

    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  }

  return {
    apiRequest: apiRequestMock,
    ApiError: MockApiError,
  };
});

vi.mock("@/components/ui/card", () => ({
  Card: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div ref={ref} {...props} />
  )),
  CardContent: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../src/components/StatusBadge", () => ({
  __esModule: true,
  default: ({ status }: { status: string }) => <span>{status}</span>,
  getStatusLabel: (status: string) => status,
  getStatusVisual: () => ({ Icon: null, iconColorClass: "" }),
}));

vi.mock("../src/components/DownloadIndicator", () => ({
  default: () => <span>download-indicator</span>,
}));

vi.mock("../src/components/SearchResultsBadge", () => ({
  default: () => <span>search-results</span>,
}));

vi.mock("../src/components/LazyModalFallback", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("../src/components/GameDetailsModal", () => ({
  default: ({ game }: { game: Game }) => <div>Details for {game.title}</div>,
}));

vi.mock("../src/components/GameDownloadDialog", () => ({
  default: ({ game }: { game: Game }) => <div>Download dialog for {game.title}</div>,
}));

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

describe("GameCard remaining coverage", () => {
  const baseGame = {
    id: "1",
    igdbId: 1001,
    title: "Questarr Game",
    coverUrl: "/cover.jpg",
    summary: "Summary",
    rating: 8.5,
    releaseDate: "2024-01-01",
    status: "wanted",
    hidden: false,
    platforms: ["PC"],
    genres: ["Action"],
    addedAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
  } as unknown as Game;

  beforeEach(() => {
    vi.clearAllMocks();
    mutationState.config = null;
    mutationState.pending = false;
    mobileState.value = false;
  });

  it("covers discovery add flow, duplicate branches, and desktop action handlers", async () => {
    const onViewDetails = vi.fn();
    const onToggleHidden = vi.fn();
    const addedGame = { ...baseGame, id: "library-1", title: "Library Game" } as Game;
    apiRequestMock.mockResolvedValueOnce({ json: async () => addedGame });

    const { container } = render(
      <GameCard
        game={{ ...baseGame, id: "igdb-1" }}
        isDiscovery
        onViewDetails={onViewDetails}
        onToggleHidden={onToggleHidden}
      />
    );

    fireEvent.click(screen.getByTestId("button-download-igdb-1"));
    await waitFor(() => {
      expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["/api/games"] });
    });
    expect(await screen.findByText("Download dialog for Library Game")).toBeInTheDocument();

    apiRequestMock.mockRejectedValueOnce(
      new (await import("@/lib/queryClient")).ApiError(409, "duplicate", {
        game: { ...baseGame, id: "library-2" },
      })
    );
    await expect(
      (mutationState.config?.mutationFn as ((game: Game) => Promise<Game>) | undefined)?.({
        ...baseGame,
        id: "igdb-2",
      } as Game)
    ).resolves.toMatchObject({ id: "library-2" });

    apiRequestMock.mockRejectedValueOnce(
      new (await import("@/lib/queryClient")).ApiError(409, "duplicate")
    );
    await expect(
      (mutationState.config?.mutationFn as ((game: Game) => Promise<Game>) | undefined)?.({
        ...baseGame,
        id: "igdb-3",
      } as Game)
    ).resolves.toMatchObject({ id: "igdb-3" });

    const detailsButton = screen.getByTestId("button-details-igdb-1");
    fireEvent.click(detailsButton);
    expect(onViewDetails).toHaveBeenCalledWith("igdb-1");
    expect(await screen.findByText("Details for Library Game")).toBeInTheDocument();

    const content = container.querySelector(".p-3.flex.flex-col.flex-1");
    expect(content).toBeTruthy();
    onViewDetails.mockClear();
    fireEvent.click(content!);
    expect(onViewDetails).toHaveBeenCalledWith("igdb-1");

    render(
      <GameCard game={baseGame} onToggleHidden={onToggleHidden} onViewDetails={onViewDetails} />
    );
    fireEvent.click(screen.getByTestId("button-toggle-hidden-1"));
    expect(onToggleHidden).toHaveBeenCalledWith("1", true);
  });

  it("covers download failure toast, mobile actions, and non-discovery download opening", async () => {
    mobileState.value = true;
    const onViewDetails = vi.fn();
    const onTrackGame = vi.fn();

    apiRequestMock.mockRejectedValueOnce(new Error("add failed"));
    const { rerender } = render(
      <GameCard
        game={{ ...baseGame, id: "igdb-mobile" } as Game}
        isDiscovery
        onViewDetails={onViewDetails}
        onTrackGame={onTrackGame}
      />
    );

    fireEvent.click(screen.getByTestId("button-download-igdb-mobile"));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        description: "Failed to add game to library before downloading",
        variant: "destructive",
      });
    });

    fireEvent.click(screen.getByTestId("button-details-igdb-mobile"));
    expect(onViewDetails).toHaveBeenCalledWith("igdb-mobile");

    fireEvent.click(screen.getByTestId("button-track-igdb-mobile"));
    expect(onTrackGame).toHaveBeenCalledWith(expect.objectContaining({ id: "igdb-mobile" }));

    rerender(<GameCard game={baseGame} isDiscovery />);
    fireEvent.click(screen.getByTestId("button-download-1"));
    expect(await screen.findByText("Download dialog for Questarr Game")).toBeInTheDocument();
  });

  it("covers pending mobile and track button states", () => {
    mutationState.pending = true;
    mobileState.value = true;

    render(<GameCard game={{ ...baseGame, id: "igdb-pending" } as Game} isDiscovery />);

    expect(screen.getAllByTestId("icon-loader").length).toBeGreaterThan(0);
    expect(screen.getByText("Tracking...")).toBeInTheDocument();
  });

  it("covers status changes for library games", async () => {
    const onStatusChange = vi.fn();

    render(
      <GameCard game={{ ...baseGame, status: "owned" } as Game} onStatusChange={onStatusChange} />
    );

    // Open the status picker popover
    fireEvent.click(screen.getByTestId("button-status-1"));

    // Select "completed" from the picker chips (aria-label matches status id)
    const completedChip = await screen.findByRole("button", { name: "completed" });
    fireEvent.click(completedChip);

    expect(onStatusChange).toHaveBeenCalledWith("1", "completed");
  });
});
