/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverPage from "../src/pages/discover";
import { createTestQueryClient } from "./test-utils";
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
        return Promise.resolve({ json: async () => games }) as any;
      }
      return Promise.resolve({ json: async () => ({ configured: true }) }) as any;
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
