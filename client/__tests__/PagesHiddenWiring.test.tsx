/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WishlistPage from "../src/pages/wishlist";
import Dashboard from "../src/components/Dashboard";
import { TooltipProvider } from "@/components/ui/tooltip";

const TEST_GAME_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const gameGridSpy = vi.fn();

vi.mock("@/components/GameGrid", () => ({
  default: (props: { onToggleHidden?: (id: string, hidden: boolean) => void }) => {
    gameGridSpy(props);
    return (
      <button
        data-testid="button-trigger-toggle-hidden"
        onClick={() => props.onToggleHidden?.(TEST_GAME_ID, true)}
      >
        Trigger hidden toggle
      </button>
    );
  },
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const response = await fetch(queryKey.join(""));
          if (!response.ok) throw new Error("Network response was not ok");
          return response.json();
        },
      },
      mutations: {
        retry: false,
      },
    },
  });

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
};

describe("Page hidden wiring", () => {
  beforeEach(() => {
    localStorage.clear();
    gameGridSpy.mockClear();

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "PATCH" && url.includes("/hidden")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ hidden: true }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: TEST_GAME_ID,
            title: "TBA Game",
            status: "wanted",
            hidden: false,
            releaseDate: null,
            addedAt: new Date().toISOString(),
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            title: "Released Game",
            status: "wanted",
            hidden: false,
            releaseDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            addedAt: new Date().toISOString(),
          },
          {
            id: "33333333-3333-3333-3333-333333333333",
            title: "Upcoming Game",
            status: "wanted",
            hidden: false,
            releaseDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            addedAt: new Date().toISOString(),
          },
        ],
      } as Response);
    });
  });

  it("wires onToggleHidden in WishlistPage", async () => {
    renderWithQueryClient(<WishlistPage />);

    await waitFor(() => {
      // Wishlist should render one GameGrid per section: upcoming, released, and TBA.
      expect(gameGridSpy).toHaveBeenCalledTimes(3);
    });

    const triggerButtons = await screen.findAllByTestId("button-trigger-toggle-hidden");
    fireEvent.click(triggerButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/games/${TEST_GAME_ID}/hidden`),
        expect.objectContaining({ method: "PATCH" })
      );
    });

    expect(
      gameGridSpy.mock.calls.some(([props]) => typeof props.onToggleHidden === "function")
    ).toBe(true);
  });

  it("wires onToggleHidden in Dashboard", async () => {
    renderWithQueryClient(<Dashboard />);

    const triggerButton = await screen.findByTestId("button-trigger-toggle-hidden");
    fireEvent.click(triggerButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/games/${TEST_GAME_ID}/hidden`),
        expect.objectContaining({ method: "PATCH" })
      );
    });

    expect(
      gameGridSpy.mock.calls.some(([props]) => typeof props.onToggleHidden === "function")
    ).toBe(true);
  });
});

describe("Dashboard filter buttons", () => {
  const gameWithDownload = {
    id: TEST_GAME_ID,
    title: "Downloaded Game",
    status: "owned",
    hidden: false,
    releaseDate: null,
    addedAt: new Date().toISOString(),
    searchResultsAvailable: false,
  };

  const gameWithSearchResult = {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Search Result Game",
    status: "owned",
    hidden: false,
    releaseDate: null,
    addedAt: new Date().toISOString(),
    searchResultsAvailable: true,
  };

  beforeEach(() => {
    localStorage.clear();
    gameGridSpy.mockClear();

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/downloads/summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            [TEST_GAME_ID]: { topStatus: "downloading", count: 1, downloadTypes: ["torrent"] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [gameWithDownload, gameWithSearchResult],
      } as Response);
    });
  });

  it("filters to games with downloads when hasDownloads button toggled", async () => {
    renderWithQueryClient(<Dashboard />);

    // Wait for both games to appear in initial render
    await waitFor(() => {
      const calls = gameGridSpy.mock.calls;
      const lastGames = calls[calls.length - 1]?.[0]?.games;
      expect(lastGames).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show games with downloads only" }));

    await waitFor(() => {
      const calls = gameGridSpy.mock.calls;
      const lastGames = calls[calls.length - 1]?.[0]?.games;
      expect(lastGames).toHaveLength(1);
      expect(lastGames[0].id).toBe(TEST_GAME_ID);
    });
  });

  it("filters to games with search results when search results button toggled", async () => {
    renderWithQueryClient(<Dashboard />);

    await waitFor(() => {
      const calls = gameGridSpy.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.games).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show games with search results only" }));

    await waitFor(() => {
      const calls = gameGridSpy.mock.calls;
      const lastGames = calls[calls.length - 1]?.[0]?.games;
      expect(lastGames).toHaveLength(1);
      expect(lastGames[0].id).toBe("22222222-2222-2222-2222-222222222222");
    });
  });
});
