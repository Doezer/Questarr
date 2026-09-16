/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverPage from "../src/pages/discover";
import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-hidden-mutation", () => ({
  useHiddenMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-local-storage-state", () => ({
  useLocalStorageState: <T,>(_key: string, initial: T) => {
    const [value, setValue] = React.useState(initial);
    return [value, setValue] as const;
  },
}));

vi.mock("@/components/DiscoverSettingsModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="discover-settings-modal" /> : null,
}));

vi.mock("@/components/GameCarouselSection", () => ({
  default: ({ title }: { title: string }) => <div data-testid="carousel-section">{title}</div>,
}));
vi.mock("@/components/RssFeedList", () => ({
  default: () => <div data-testid="rss-feed-list" />,
}));

vi.mock("@/components/RssSettings", () => ({
  default: () => <div data-testid="rss-settings" />,
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn().mockResolvedValue({ json: async () => ({ configured: false }) }),
  queryClient: { cancelQueries: vi.fn(), invalidateQueries: vi.fn() },
}));

vi.mock("@/lib/discover-hidden-mutation", () => ({
  hideDiscoveryGame: vi.fn(),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <button role="tab" data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
}));

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

describe("DiscoverPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ igdb: { configured: true } }),
    })) as typeof fetch;
  });

  it("renders the Discover heading and handles games with varying status and nullable igdbId", async () => {
    const games = [
      { id: "1", igdbId: 1, hidden: true, status: "wanted" },
      { id: "2", igdbId: 2, hidden: false, status: "owned" },
      { id: "3", igdbId: 3, hidden: false, status: "completed" },
      { id: "4", igdbId: 4, hidden: false, status: "downloading" },
      { id: "5", igdbId: 5, hidden: false, status: "wanted" },
      { id: "6", igdbId: null, hidden: false, status: "wanted" }, // covers the !g.igdbId branch
    ];
    // Override the mock temporarily for this test to hit all logic branches
    vi.mocked(apiRequest).mockImplementation((method: string, url: string) => {
      // Specifically mock the includeHidden=true route again
      if (url.includes("/api/games?includeHidden=true")) {
        return Promise.resolve({ json: async () => games } as Response);
      }
      return Promise.resolve({ json: async () => ({ configured: true }) } as Response);
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DiscoverPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Discover")).toBeInTheDocument();

    // Give some time for queries to settle to hit coverage on our new hook
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("snaps the platform select to a listed platform when the setting excludes PC", async () => {
    const platforms = [
      { id: 130, name: "Nintendo Switch" },
      { id: 167, name: "PlayStation 5" },
    ];
    // `/api/config`, `/api/settings` and `/api/games` use the query client's
    // default fetch-based queryFn, while `/api/igdb/platforms` calls apiRequest.
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = getRequestUrl(url);
      if (u.includes("/api/settings")) {
        // Only Switch is selected, so the default "PC" is not on offer.
        return { ok: true, json: async () => ({ importPlatformIds: [130] }) } as Response;
      }
      if (u.includes("/api/games")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({ igdb: { configured: true } }) } as Response;
    }) as typeof fetch;
    vi.mocked(apiRequest).mockImplementation((_method: string, url: string) => {
      if (url.includes("/api/igdb/platforms")) {
        return Promise.resolve({ json: async () => platforms } as Response);
      }
      return Promise.resolve({ json: async () => [] } as Response);
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DiscoverPage />
      </QueryClientProvider>
    );

    await screen.findByText("Discover");

    // The dropdown offers only the selected platform. Asserting on the carousel
    // title (not just the <select>) is what catches the selection staying on
    // "PC": a DOM only coerces the displayed value, but the carousel is driven
    // by React state and keeps browsing the excluded platform.
    expect(await screen.findByRole("option", { name: "Nintendo Switch" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "PC" })).not.toBeInTheDocument();
    // Several carousels render; assert the By Platform one, which is driven by
    // React state and is what keeps browsing the excluded platform.
    await waitFor(() =>
      expect(screen.getAllByTestId("carousel-section").map((el) => el.textContent)).toContain(
        "Nintendo Switch Games"
      )
    );
    expect(screen.getAllByTestId("carousel-section").map((el) => el.textContent)).not.toContain(
      "PC Games"
    );
  });

  it("renders when fetching fails", async () => {
    vi.mocked(apiRequest).mockImplementation((method: string, url: string) => {
      return Promise.reject(new Error("Network Error"));
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DiscoverPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Discover")).toBeInTheDocument();
  });
});
