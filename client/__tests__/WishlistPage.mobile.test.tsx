/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WishlistPage from "../src/pages/wishlist";
import { createTestQueryClient } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-hidden-mutation", () => ({
  useHiddenMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

vi.mock("@/hooks/use-view-controls", () => ({
  useViewControls: () => ({
    viewMode: "grid",
    setViewMode: vi.fn(),
    listDensity: "comfortable",
    setListDensity: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-local-storage-state", () => ({
  useLocalStorageState: <T,>(_key: string, initial: T) => {
    const [value, setValue] = React.useState(initial);
    return [value, setValue] as const;
  },
}));

vi.mock("@/hooks/use-download-summary", () => ({
  useDownloadSummary: () => mockDownloadSummaries,
}));

vi.mock("@/components/PageToolbar", () => ({
  default: ({
    search,
    onSearchChange,
    searchPlaceholder,
    filterPills,
    actions,
  }: {
    search?: string;
    onSearchChange?: (value: string) => void;
    searchPlaceholder?: string;
    filterPills?: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div>
      <input
        aria-label={searchPlaceholder ?? "Search"}
        value={search ?? ""}
        onChange={(event) => onSearchChange?.(event.target.value)}
      />
      {filterPills}
      {actions}
    </div>
  ),
}));

vi.mock("@/components/GameFilterPills", () => ({
  default: ({
    showSearchResultsOnly,
    setShowSearchResultsOnly,
    showDownloadsOnly,
    setShowDownloadsOnly,
  }: {
    showSearchResultsOnly: boolean;
    setShowSearchResultsOnly: (value: boolean) => void;
    showDownloadsOnly: boolean;
    setShowDownloadsOnly: (value: boolean) => void;
  }) => (
    <div data-testid="wishlist-filter-pills">
      <button type="button" onClick={() => setShowSearchResultsOnly(!showSearchResultsOnly)}>
        Search results only
      </button>
      <button type="button" onClick={() => setShowDownloadsOnly(!showDownloadsOnly)}>
        Downloads only
      </button>
    </div>
  ),
}));

vi.mock("@/components/EmptyState", () => ({
  default: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("@/components/GameGrid", () => ({
  default: ({ games }: { games: Array<{ title: string }> }) => (
    <div data-testid="wishlist-grid">{games.map((g) => g.title).join(", ")}</div>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-value={value}>{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({
    value,
    children,
    ...props
  }: {
    value: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <button type="button" {...props} data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-testid={`wishlist-tab-${value}`}>{children}</div>
  ),
}));

let mockDownloadSummaries: Record<string, unknown>;

beforeEach(() => {
  mockDownloadSummaries = {};
});

describe("WishlistPage mobile sections", () => {
  it("renders mobile tabs for released, upcoming, and TBA games", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: "released", title: "Released Game", status: "wanted", releaseDate: "2024-01-01" },
        { id: "upcoming", title: "Upcoming Game", status: "wanted", releaseDate: "2099-01-01" },
        { id: "tba", title: "TBA Game", status: "wanted", releaseDate: null },
      ],
    })) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <WishlistPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Released")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText("TBA")).toBeInTheDocument();
    expect(screen.getAllByTestId("wishlist-grid")[0]).toHaveTextContent("Released Game");
  });

  it("falls back to stacked sections when only one mobile section remains", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: "released", title: "Released Game", status: "wanted", releaseDate: "2024-01-01" },
        { id: "upcoming", title: "Upcoming Game", status: "wanted", releaseDate: "2099-01-01" },
      ],
    })) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <WishlistPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Released")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unreleased" }));

    expect(await screen.findByText("Wishlist")).toBeInTheDocument();
    expect(screen.getByText("Released Game")).toBeInTheDocument();
    expect(screen.queryByTestId("wishlist-tab-upcoming")).not.toBeInTheDocument();
  });

  it("shows the combined-filter empty state when both mobile filters remove all games", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: "released",
          title: "Released Game",
          status: "wanted",
          releaseDate: "2024-01-01",
          searchResultsAvailable: false,
        },
      ],
    })) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <WishlistPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Released Game")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search results only" }));
    fireEvent.click(screen.getByRole("button", { name: "Downloads only" }));

    expect(await screen.findByText("No games match your filters")).toBeInTheDocument();
    expect(
      screen.getByText("Try disabling one or more filters to see more games.")
    ).toBeInTheDocument();
    expect(screen.getByText("Multiple filters active")).toBeInTheDocument();
  });

  it("shows the search empty state on mobile", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: "released", title: "Released Game", status: "wanted", releaseDate: "2024-01-01" },
      ],
    })) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <WishlistPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Released Game")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Filter wishlist..." }), {
      target: { value: "Metroid" },
    });

    expect(await screen.findByText("No games match your search")).toBeInTheDocument();
    expect(screen.getByText('No wishlist games found for "Metroid".')).toBeInTheDocument();
  });
});
