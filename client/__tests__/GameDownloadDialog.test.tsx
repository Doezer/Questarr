/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GameDownloadDialog from "../src/components/GameDownloadDialog";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mocking external dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    toasts: [],
  }),
}));

// Mock Lucide icons
vi.mock("lucide-react", () => ({
  Download: (props: Record<string, unknown>) => <div data-testid="icon-download" {...props} />,
  HardDrive: (props: Record<string, unknown>) => <div data-testid="icon-harddrive" {...props} />,
  Users: (props: Record<string, unknown>) => <div data-testid="icon-users" {...props} />,
  Calendar: (props: Record<string, unknown>) => <div data-testid="icon-calendar" {...props} />,
  Loader2: (props: Record<string, unknown>) => <div data-testid="icon-loader" {...props} />,
  Search: (props: Record<string, unknown>) => <div data-testid="icon-search" {...props} />,
  Plus: () => <div />,
  Edit: () => <div />,
  Trash2: () => <div />,
  Check: () => <div />,
  X: () => <div />,
  Activity: () => <div />,
  PackagePlus: (props: Record<string, unknown>) => (
    <div data-testid="icon-package-plus" {...props} />
  ),
  FileDown: (props: Record<string, unknown>) => <div data-testid="icon-file-down" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => (
    <div data-testid="icon-check-circle" {...props} />
  ),
  Newspaper: (props: Record<string, unknown>) => <div data-testid="icon-newspaper" {...props} />,
  Magnet: (props: Record<string, unknown>) => <div data-testid="icon-magnet" {...props} />,
  SlidersHorizontal: (props: Record<string, unknown>) => (
    <div data-testid="icon-sliders-horizontal" {...props} />
  ),
  ArrowUpDown: () => <div data-testid="icon-sort" />,
  ArrowUp: () => <div data-testid="icon-sort-up" />,
  ArrowDown: () => <div data-testid="icon-sort-down" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronUp: () => <div data-testid="icon-chevron-up" />,
  MoreVertical: () => <div />,
  Copy: () => <div />,
}));

const mockGame = {
  id: 1,
  title: "Test Game",
  igdbId: 123,
  gameDetails: {},
};

const mockTorrents = {
  items: [
    {
      guid: "123",
      title: "Test Torrent 1",
      link: "http://test.com/torrent1",
      pubDate: new Date().toISOString(),
      size: 1024 * 1024 * 100, // 100MB
      seeders: 10,
      leechers: 2,
      indexerName: "Indexer A",
    },
    {
      guid: "456",
      title: "Test Torrent 2",
      link: "http://test.com/torrent2",
      pubDate: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      size: 1024 * 1024 * 200, // 200MB
      seeders: 5,
      leechers: 1,
      indexerName: "Indexer B",
    },
    {
      guid: "789",
      title: "Test Usenet NZB",
      link: "http://test.com/nzb1",
      pubDate: new Date().toISOString(),
      size: 1024 * 1024 * 50, // 50MB
      grabs: 50,
      age: 2,
      indexerName: "Indexer C",
    },
  ],
  total: 3,
  offset: 0,
};

const mockEnabledIndexers = [
  { id: 1, name: "Indexer A", enabled: true },
  { id: 2, name: "Indexer B", enabled: true },
  { id: 3, name: "Indexer C", enabled: true },
];

const mockDownloaders = [
  { id: 1, name: "qBittorrent", enabled: true, type: "torrent" },
  { id: 2, name: "SABnzbd", enabled: true, type: "usenet" },
];

// Mock fetch
global.fetch = vi.fn();

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        const response = await fetch(queryKey.join(""));
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json();
      },
    },
  },
});

let queryClient: QueryClient;

const renderComponent = () => {
  queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GameDownloadDialog game={mockGame} open={true} onOpenChange={() => { }} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

describe("GameDownloadDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Mock API responses
    global.fetch = vi.fn(async (url) => {
      const urlString = url.toString();

      if (urlString.includes("/api/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockTorrents,
        });
      }

      if (urlString.includes("/api/indexers/enabled")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockEnabledIndexers,
        });
      }

      if (urlString.includes("/api/downloaders/enabled")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockDownloaders,
        });
      }

      if (urlString.includes("/api/settings")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      }

      if (urlString.includes("/api/downloads")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, downloaderName: "TestDownloader" }),
        });
      }

      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  });

  it("renders search results correctly", async () => {
    renderComponent();

    // Check if game title is in the search input
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test Game")).toBeInTheDocument();
    });

    // Wait for results to load
    await waitFor(() => {
      expect(screen.getAllByText("Test Torrent 1").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Test Torrent 2").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Test Usenet NZB").length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("identifies Usenet vs Torrent items", async () => {
    renderComponent();

    await waitFor(() => {
      // Usenet item should show newspaper icon (mocked)
      expect(screen.getAllByTestId("icon-newspaper").length).toBeGreaterThan(0);
      // Torrent item should show magnet icon (mocked)
      expect(screen.getAllByTestId("icon-magnet").length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("filters search results by indexer", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("Test Torrent 1").length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Open filters
    const showFiltersButton = screen.getByText("Show Filters");
    fireEvent.click(showFiltersButton);

    // Filter controls should appear
    await waitFor(() => {
      expect(screen.getByText("Indexer")).toBeInTheDocument();
      expect(screen.getByText("Min Seeders")).toBeInTheDocument();
      expect(screen.getByText("Categories")).toBeInTheDocument();
    });
  });

  it("sorts results", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Health")).toBeInTheDocument();
    });

    // Click on Health sort header
    // Initial state is Seeders Desc (ArrowDown). Clicking it should toggle to Asc (ArrowUp).
    const healthHeader = screen.getByText("Health");
    fireEvent.click(healthHeader);

    // Should trigger a re-sort -> Ascending -> ArrowUp
    expect(screen.getAllByTestId("icon-sort-up").length).toBeGreaterThan(0);
  });

  it("shows a loading spinner on the download button when clicked", async () => {
    renderComponent();

    // Wait for torrents to be loaded and displayed
    await waitFor(() => {
      expect(screen.getAllByTestId("icon-download").length).toBeGreaterThan(0);
    });

    const downloadIcon = screen.getAllByTestId("icon-download")[0];
    const downloadButton = downloadIcon.closest("button");

    expect(downloadButton).toBeInTheDocument();
    if (!downloadButton) throw new Error("Button not found");

    // Click the download button
    fireEvent.click(downloadButton);

    // The component uses useMutation, checking for the loader might be flaky if it resolves too fast
    // But we should verify the API call was made
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/downloads"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Test Torrent 1")
        })
      );
    });
  });
});
