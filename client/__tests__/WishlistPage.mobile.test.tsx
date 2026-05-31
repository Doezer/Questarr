/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

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
  useDownloadSummary: () => ({}),
}));

vi.mock("@/components/PageToolbar", () => ({
  default: ({
    filterPills,
    actions,
  }: {
    filterPills?: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div>
      {filterPills}
      {actions}
    </div>
  ),
}));

vi.mock("@/components/GameFilterPills", () => ({
  default: () => <div data-testid="wishlist-filter-pills" />,
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
});
