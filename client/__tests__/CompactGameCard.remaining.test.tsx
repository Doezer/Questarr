/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Game } from "@shared/schema";
import CompactGameCard from "../src/components/CompactGameCard";

const {
  mockInvalidateQueries,
  mockToast,
  apiRequestMock,
  addMutateAsyncSpy,
  userMutateSpy,
  mutationState,
} = vi.hoisted(() => {
  return {
    mockInvalidateQueries: vi.fn(),
    mockToast: vi.fn(),
    apiRequestMock: vi.fn(),
    addMutateAsyncSpy: vi.fn(),
    userMutateSpy: vi.fn(),
    mutationState: {
      callIndex: 0,
      addConfig: null as Record<string, unknown> | null,
      userConfig: null as Record<string, unknown> | null,
      addPending: false,
    },
  };
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
    useMutation: (config: Record<string, unknown>) => {
      const callIndex = mutationState.callIndex++;
      if (callIndex % 2 === 0) {
        mutationState.addConfig = config;
        return {
          mutateAsync: async (value: Game) => {
            addMutateAsyncSpy(value);
            const result = await (config.mutationFn as (value: Game) => Promise<Game>)(value);
            (config.onSuccess as ((value: Game) => void) | undefined)?.(result);
            return result;
          },
          isPending: mutationState.addPending,
        };
      }

      mutationState.userConfig = config;
      return {
        mutate: async (value: { gameId: string; userRating: number | null }) => {
          userMutateSpy(value);
          try {
            await (
              config.mutationFn as (value: {
                gameId: string;
                userRating: number | null;
              }) => Promise<void>
            )(value);
            (config.onSuccess as (() => void) | undefined)?.();
          } catch (error) {
            (config.onError as ((error: unknown) => void) | undefined)?.(error);
          }
        },
        isPending: false,
      };
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
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

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stub StatusPicker so it doesn't add a second Popover instance to the page.
// The rating-popover mock below assumes a single PopoverContent; two would break it.
vi.mock("../src/components/StatusPicker", () => ({
  __esModule: true,
  default: ({
    currentStatus,
    gameTitle,
  }: {
    currentStatus: string;
    gameTitle?: string;
    children?: React.ReactNode;
  }) => (
    <button type="button" aria-label={`Change status for ${gameTitle}`}>
      {currentStatus}
    </button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  // Single popover instance is enough for this test file.
  __esModule: true,
  Popover: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => {
    (
      globalThis as typeof globalThis & { __popoverOpenChange?: (open: boolean) => void }
    ).__popoverOpenChange = onOpenChange;
    return <div data-testid="popover-root">{children}</div>;
  },
  PopoverTrigger: ({ children }: { children: React.ReactElement }) =>
    React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        (
          globalThis as typeof globalThis & { __popoverOpenChange?: (open: boolean) => void }
        ).__popoverOpenChange?.(true);
      },
    }),
  PopoverContent: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: (event: React.MouseEvent) => void;
  }) => (
    <div
      data-testid="popover-content"
      role="button"
      onClick={onClick}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          onClick?.(event as unknown as React.MouseEvent);
        }
      }}
      tabIndex={0}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    onValueChange,
    onValueCommit,
  }: {
    onValueChange?: (value: number[]) => void;
    onValueCommit?: (value: number[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onValueChange?.([7.5])}>
        Change rating
      </button>
      <button type="button" onClick={() => onValueCommit?.([7.5])}>
        Commit rating
      </button>
    </div>
  ),
}));

vi.mock("../src/components/DownloadIndicator", () => ({
  default: () => <span>download-indicator</span>,
}));

vi.mock("../src/components/SearchResultsBadge", () => ({
  default: () => <span>search-results</span>,
}));

vi.mock("../src/components/StatusBadge", () => ({
  __esModule: true,
  default: ({ status }: { status: string }) => <span>{status}</span>,
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

describe("CompactGameCard remaining coverage", () => {
  const baseGame = {
    id: "1",
    title: "Questarr Game",
    coverUrl: "http://example.com/cover.jpg",
    status: "wanted",
    releaseDate: "2023-01-01",
    rating: 8.5,
    userRating: 6.5,
    genres: ["Action", "Adventure"],
    hidden: false,
    searchResultsAvailable: true,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  } as unknown as Game;

  beforeEach(() => {
    vi.clearAllMocks();
    mutationState.callIndex = 0;
    mutationState.addConfig = null;
    mutationState.userConfig = null;
    mutationState.addPending = false;
  });

  const renderCard = (ui: React.ReactElement) => render(ui);

  it("covers discovery add flow, mutation callbacks, duplicate handling, and mobile layout branches", async () => {
    const addedGame = { ...baseGame, id: "library-1", title: "Library Game" } as Game;
    apiRequestMock.mockResolvedValueOnce({
      json: async () => addedGame,
    });

    renderCard(<CompactGameCard game={{ ...baseGame, id: "igdb-1" }} isDiscovery mobileLayout />);

    fireEvent.click(screen.getByLabelText("Download Questarr Game"));

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/games"] });
    });
    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/games",
      expect.objectContaining({ status: "wanted" })
    );
    expect(await screen.findByText("Download dialog for Library Game")).toBeInTheDocument();

    const duplicateGame = { ...baseGame, id: "library-2", title: "Duplicate Game" } as Game;
    apiRequestMock.mockRejectedValueOnce(
      new (await import("@/lib/queryClient")).ApiError(409, "duplicate", { game: duplicateGame })
    );
    await expect(
      (mutationState.addConfig?.mutationFn as ((value: Game) => Promise<Game>) | undefined)?.({
        ...baseGame,
        id: "igdb-2",
      })
    ).resolves.toEqual(duplicateGame);

    apiRequestMock.mockRejectedValueOnce(
      new (await import("@/lib/queryClient")).ApiError(409, "duplicate")
    );
    await expect(
      (mutationState.addConfig?.mutationFn as ((value: Game) => Promise<Game>) | undefined)?.({
        ...baseGame,
        id: "igdb-3",
      })
    ).resolves.toEqual({ ...baseGame, id: "igdb-3" });
  });

  it("covers discovery add failure handling and mobile no-genres fallback", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiRequestMock.mockRejectedValueOnce(new Error("add failed"));

    renderCard(
      <CompactGameCard
        game={{ ...baseGame, id: "igdb-4", genres: [] } as Game}
        isDiscovery
        mobileLayout
      />
    );

    fireEvent.click(screen.getByLabelText("Download Questarr Game"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        description: "Failed to add game to library before downloading",
        variant: "destructive",
      });
    });
    expect(screen.getByText("No genres")).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("covers rating interactions, popover reset, mutation success/error, and clear rating", async () => {
    const onViewDetails = vi.fn();
    renderCard(<CompactGameCard game={baseGame} onViewDetails={onViewDetails} />);

    const ratingButton = screen.getByLabelText("My rating: 6.5/10. Click to change.");
    fireEvent.click(ratingButton);
    expect(screen.getByText((_, element) => element?.textContent === "6.5/10")).toBeInTheDocument();
    expect(onViewDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("popover-content"));
    expect(onViewDetails).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Change rating"));
    expect(screen.getByText((_, element) => element?.textContent === "7.5/10")).toBeInTheDocument();

    apiRequestMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByText("Commit rating"));
    await waitFor(() => {
      expect(userMutateSpy).toHaveBeenCalledWith({ gameId: "1", userRating: 7.5 });
    });
    expect(apiRequestMock).toHaveBeenCalledWith("PATCH", "/api/games/1/user-rating", {
      userRating: 7.5,
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/games"] });

    apiRequestMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByText("Clear rating"));
    await waitFor(() => {
      expect(userMutateSpy).toHaveBeenCalledWith({ gameId: "1", userRating: null });
    });

    apiRequestMock.mockRejectedValueOnce(new Error("rating failed"));
    fireEvent.click(screen.getByText("Commit rating"));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        description: "Failed to save your rating",
        variant: "destructive",
      });
    });
  });

  it("covers desktop action handlers without bubbling to details and pending discovery state", async () => {
    const onViewDetails = vi.fn();
    const onToggleHidden = vi.fn();
    mutationState.addPending = true;

    const { container, rerender } = renderCard(
      <CompactGameCard
        game={baseGame}
        onViewDetails={onViewDetails}
        onToggleHidden={onToggleHidden}
      />
    );

    const actionsWrapper = Array.from(container.querySelectorAll("div")).find(
      (element) =>
        typeof element.className === "string" && element.className.includes("justify-end gap-1")
    );
    expect(actionsWrapper).toBeTruthy();
    fireEvent.click(actionsWrapper!);
    expect(onViewDetails).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Hide Questarr Game"));
    expect(onToggleHidden).toHaveBeenCalledWith("1", true);
    expect(onViewDetails).not.toHaveBeenCalled();

    rerender(
      <CompactGameCard
        game={{ ...baseGame, id: "igdb-5", hidden: true } as Game}
        isDiscovery
        density="compact"
      />
    );

    expect(screen.getByTestId("icon-loader")).toBeInTheDocument();

    mutationState.addPending = false;
    rerender(<CompactGameCard game={baseGame} isDiscovery />);
    fireEvent.click(screen.getByLabelText("Download Questarr Game"));
    expect(await screen.findByText("Download dialog for Questarr Game")).toBeInTheDocument();
  });
});
