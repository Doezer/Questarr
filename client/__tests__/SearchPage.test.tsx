/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "../src/pages/search";
import { createTestQueryClient } from "./test-utils";

// Bypass debounce so search queries fire immediately
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const toastSpy = vi.fn();

const mockApiRequest = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: {
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
  },
}));

// Stub Radix Dialog (avoids portal / focus-trap issues in jsdom)
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (v: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="dialog" data-open={open} onClick={() => onOpenChange?.(false)}>
      {open ? children : null}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

// Stub Radix Select
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange?: (v: string) => void;
    value?: string;
  }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// Stub Radix Tooltip
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Stub react-hook-form Form components
vi.mock("@/components/ui/form", () => ({
  Form: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormControl: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormField: ({
    render,
  }: {
    render: (props: { field: Record<string, unknown> }) => React.ReactNode;
  }) => <>{render({ field: { value: "", onChange: vi.fn(), onBlur: vi.fn(), ref: vi.fn() } })}</>,
  FormItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  FormMessage: () => null,
}));

function makeSearchResult(items: object[], total = items.length, errors?: string[]) {
  return {
    json: async () => ({ items, total, offset: 0, ...(errors ? { errors } : {}) }),
  };
}

const TORRENT_ITEM = {
  title: "Game.Name.v1.0-GROUP",
  link: "https://example.com/release/1",
  guid: "guid-1",
  pubDate: "2026-01-15T12:00:00Z",
  size: 1073741824,
  seeders: 5,
  leechers: 1,
};

const OLD_ITEM = {
  title: "Old.Game.2024-GROUP",
  link: "https://example.com/release/2",
  guid: "guid-2",
  pubDate: "2024-03-10T12:00:00Z",
  size: 524288000,
  seeders: 2,
  leechers: 0,
};

function setupApiRequest({
  items = [TORRENT_ITEM],
  total,
  errors,
  libraryGames = [],
  downloaders = [],
}: {
  items?: object[];
  total?: number;
  errors?: string[];
  libraryGames?: object[];
  downloaders?: object[];
} = {}) {
  mockApiRequest.mockImplementation((_method: string, url: string) => {
    if (url.startsWith("/api/search"))
      return Promise.resolve(makeSearchResult(items, total, errors));
    if (url.startsWith("/api/games")) return Promise.resolve({ json: async () => libraryGames });
    if (url.startsWith("/api/downloaders/") && url.includes("/downloads"))
      return Promise.resolve({ json: async () => ({ success: true }) });
    if (url.startsWith("/api/games/")) return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ json: async () => [] });
  });
  // Downloaders uses the QueryClient default queryFn which calls fetch
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => downloaders,
  })) as typeof fetch;
}

function renderSearch() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SearchPage />
    </QueryClientProvider>
  );
}

function typeSearch(query: string) {
  fireEvent.change(screen.getByPlaceholderText("Enter game title..."), {
    target: { value: query },
  });
}

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiRequest();
  });

  it("renders heading and search input", () => {
    renderSearch();
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter game title...")).toBeInTheDocument();
  });

  it("shows start-searching card when no query is entered", () => {
    renderSearch();
    expect(screen.getByTestId("card-start-searching")).toBeInTheDocument();
  });

  it("shows search results after typing a query", async () => {
    setupApiRequest({ items: [TORRENT_ITEM], total: 1 });
    renderSearch();
    typeSearch("game name");

    await waitFor(() => {
      expect(screen.getByTestId("card-torrent-0")).toBeInTheDocument();
    });
    expect(screen.getByText("Game.Name.v1.0-GROUP")).toBeInTheDocument();
  });

  it("shows results count header", async () => {
    setupApiRequest({ items: [TORRENT_ITEM], total: 1 });
    renderSearch();
    typeSearch("game");

    await waitFor(() => {
      expect(screen.getByTestId("text-search-results-count")).toBeInTheDocument();
    });
  });

  it("shows no-results message when search returns empty items", async () => {
    setupApiRequest({ items: [], total: 0 });
    renderSearch();
    typeSearch("nothing");

    await waitFor(() => {
      expect(screen.getByTestId("card-no-results")).toBeInTheDocument();
    });
    expect(screen.getByText("No Results Found")).toBeInTheDocument();
  });

  it("shows indexer errors when search returns errors", async () => {
    setupApiRequest({ items: [], total: 0, errors: ["Indexer A timed out"] });
    renderSearch();
    typeSearch("game");

    await waitFor(() => {
      expect(screen.getByTestId("card-indexer-errors")).toBeInTheDocument();
    });
    expect(screen.getByTestId("error-message-0")).toHaveTextContent("Indexer A timed out");
  });

  describe("date filter", () => {
    it("toggles filter row visibility", async () => {
      renderSearch();
      expect(screen.queryByTestId("input-date-from")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("button-toggle-filters"));
      expect(screen.getByTestId("input-date-from")).toBeInTheDocument();
      expect(screen.getByTestId("input-date-to")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("button-toggle-filters"));
      expect(screen.queryByTestId("input-date-from")).not.toBeInTheDocument();
    });

    it("shows clear button when a date is set, hides when cleared", async () => {
      renderSearch();
      fireEvent.click(screen.getByTestId("button-toggle-filters"));

      expect(screen.queryByTestId("button-clear-dates")).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId("input-date-from"), { target: { value: "2026-01-01" } });
      expect(screen.getByTestId("button-clear-dates")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("button-clear-dates"));
      expect(screen.queryByTestId("button-clear-dates")).not.toBeInTheDocument();
    });

    it("filters results by date range, hiding items outside the range", async () => {
      setupApiRequest({ items: [TORRENT_ITEM, OLD_ITEM], total: 2 });
      renderSearch();
      typeSearch("game");
      await waitFor(() => expect(screen.getByTestId("card-torrent-0")).toBeInTheDocument());

      // Both items visible initially
      expect(screen.getByText("Game.Name.v1.0-GROUP")).toBeInTheDocument();
      expect(screen.getByText("Old.Game.2024-GROUP")).toBeInTheDocument();

      // Enable filter and set a From date after OLD_ITEM's pubDate
      fireEvent.click(screen.getByTestId("button-toggle-filters"));
      fireEvent.change(screen.getByTestId("input-date-from"), { target: { value: "2025-01-01" } });

      await waitFor(() => {
        expect(screen.getByText("Game.Name.v1.0-GROUP")).toBeInTheDocument();
        expect(screen.queryByText("Old.Game.2024-GROUP")).not.toBeInTheDocument();
      });
    });

    it("shows date-range no-results message when filter excludes all items", async () => {
      setupApiRequest({ items: [TORRENT_ITEM], total: 1 });
      renderSearch();
      typeSearch("game");
      await waitFor(() => expect(screen.getByTestId("card-torrent-0")).toBeInTheDocument());

      // Set a date range that excludes the item (TORRENT_ITEM is Jan 2026)
      fireEvent.click(screen.getByTestId("button-toggle-filters"));
      fireEvent.change(screen.getByTestId("input-date-to"), { target: { value: "2025-01-01" } });

      await waitFor(() => {
        expect(screen.getByTestId("card-no-results")).toBeInTheDocument();
      });
      expect(screen.getByText(/No releases match the selected date range/)).toBeInTheDocument();
    });

    it("shows filter count label when date filter reduces visible items", async () => {
      setupApiRequest({ items: [TORRENT_ITEM, OLD_ITEM], total: 2 });
      renderSearch();
      typeSearch("game");
      await waitFor(() => expect(screen.getAllByTestId(/card-torrent-/).length).toBe(2));

      fireEvent.click(screen.getByTestId("button-toggle-filters"));
      fireEvent.change(screen.getByTestId("input-date-from"), { target: { value: "2025-01-01" } });

      await waitFor(() => {
        expect(screen.getByText(/shown with filter/)).toBeInTheDocument();
      });
    });
  });

  describe("library matches banner", () => {
    it("shows library match banner when library games are found", async () => {
      const game = { id: "game-1", title: "Game Name" };
      setupApiRequest({ items: [TORRENT_ITEM], total: 1, libraryGames: [game] });
      renderSearch();
      typeSearch("game name");

      await waitFor(() => {
        expect(screen.getByTestId("banner-library-matches")).toBeInTheDocument();
      });
      expect(screen.getByTestId("library-game-game-1")).toBeInTheDocument();
    });

    it("calls remove mutation when trash button is clicked", async () => {
      const game = { id: "game-1", title: "My Game" };
      setupApiRequest({ items: [TORRENT_ITEM], total: 1, libraryGames: [game] });
      renderSearch();
      typeSearch("game");

      await waitFor(() => {
        expect(screen.getByTestId("button-remove-game-game-1")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("button-remove-game-game-1"));

      await waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledWith("DELETE", "/api/games/game-1");
      });
    });
  });

  describe("download button", () => {
    it("opens download dialog when a download button is clicked with a compatible downloader", async () => {
      const dl = { id: "dl-1", name: "qBit", type: "qbittorrent", enabled: true };
      setupApiRequest({ items: [TORRENT_ITEM], total: 1, downloaders: [dl] });
      renderSearch();
      typeSearch("game");

      // Wait for results to appear, then interact with the download button
      await waitFor(() => expect(screen.getByTestId("card-torrent-0")).toBeInTheDocument());
      const btn = screen.getByTestId("button-download-0");
      expect(btn).not.toBeDisabled();

      fireEvent.click(btn);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Start Download" })).toBeInTheDocument();
      });
    });

    it("shows toast when no compatible downloader for the item type", async () => {
      // A usenet-only downloader is incompatible with torrent items.
      // downloaders.length > 0 → button is NOT disabled; but clicking it
      // shows "No compatible downloaders" because no torrent client is configured.
      const usenetDl = { id: "dl-2", name: "SABnzbd", type: "sabnzbd", enabled: true };
      setupApiRequest({ items: [TORRENT_ITEM], total: 1, downloaders: [usenetDl] });
      renderSearch();
      typeSearch("game");

      await waitFor(() => expect(screen.getByTestId("card-torrent-0")).toBeInTheDocument());
      const btn = screen.getByTestId("button-download-0");
      expect(btn).not.toBeDisabled();

      fireEvent.click(btn);

      await waitFor(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({ title: "No compatible downloaders" })
        );
      });
    });
  });
});
