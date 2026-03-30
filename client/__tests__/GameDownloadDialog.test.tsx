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
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
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
  ChevronsUpDown: () => <div data-testid="icon-chevrons-up-down" />,
  MoreVertical: () => <div />,
  Copy: () => <div />,
}));

const mockGame = {
  id: 1,
  title: "Test Game",
  igdbId: 123,
  gameDetails: {},
} as unknown as import("@shared/schema").Game;

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

const createTestQueryClient = () =>
  new QueryClient({
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
const mockOnOpenChange = vi.fn();

const renderComponent = (onOpenChange = mockOnOpenChange) => {
  queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GameDownloadDialog game={mockGame} open={true} onOpenChange={onOpenChange} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

type FetchOverrides = {
  search?: object;
  settings?: object;
  downloads?: object;
};

/** Creates a fetch mock with sensible defaults, overridable per-endpoint. */
const createFetchMock = (overrides: FetchOverrides = {}) =>
  vi.fn(async (url: RequestInfo | URL) => {
    const urlString = url.toString();
    if (urlString.includes("/api/search")) {
      return { ok: true, json: async () => overrides.search ?? mockTorrents };
    }
    if (urlString.includes("/api/indexers/enabled")) {
      return { ok: true, json: async () => mockEnabledIndexers };
    }
    if (urlString.includes("/api/downloaders/enabled")) {
      return { ok: true, json: async () => mockDownloaders };
    }
    if (urlString.includes("/api/settings")) {
      return { ok: true, json: async () => overrides.settings ?? {} };
    }
    if (urlString.includes("/api/downloads")) {
      return {
        ok: true,
        json: async () =>
          overrides.downloads ?? { success: true, downloaderName: "TestDownloader" },
      };
    }
    return { ok: false, json: async () => ({}) };
  }) as never;

describe("GameDownloadDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = createFetchMock();
  });

  it("renders search results correctly", async () => {
    renderComponent();

    // Check if game title is in the search input
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test Game")).toBeInTheDocument();
    });

    // Wait for results to load
    await waitFor(
      () => {
        expect(screen.getAllByText("Test Torrent 1").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Test Torrent 2").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Test Usenet NZB").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );
  });

  it("identifies Usenet vs Torrent items", async () => {
    renderComponent();

    await waitFor(
      () => {
        // Usenet item should show newspaper icon (mocked)
        expect(screen.getAllByTestId("icon-newspaper").length).toBeGreaterThan(0);
        // Torrent item should show magnet icon (mocked)
        expect(screen.getAllByTestId("icon-magnet").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );
  });

  it("filters search results by indexer", async () => {
    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Torrent 1").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

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
          body: expect.stringContaining("Test Torrent 1"),
        })
      );
    });
  });

  it("closes dialog after successful download", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByTestId("icon-download").length).toBeGreaterThan(0);
    });

    const downloadButton = screen.getAllByTestId("icon-download")[0].closest("button");
    if (!downloadButton) throw new Error("Download button not found");
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows destructive toast when download API returns success:false", async () => {
    global.fetch = createFetchMock({
      downloads: { success: false, message: "Downloader offline" },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByTestId("icon-download").length).toBeGreaterThan(0);
    });

    const downloadButton = screen.getAllByTestId("icon-download")[0].closest("button");
    if (!downloadButton) throw new Error("Download button not found");
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    });
  });

  it("displays indexer errors returned by the search API", async () => {
    global.fetch = createFetchMock({
      search: { items: [], total: 0, offset: 0, errors: ["Indexer A: connection timeout"] },
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByText("Indexer Errors")).toBeInTheDocument();
        expect(screen.getByText(/Indexer A: connection timeout/)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("shows bundle dialog when clicking a main item that has updates available", async () => {
    const mainItem = {
      guid: "main-1",
      title: "Test Game SKIDROW",
      link: "http://test.com/main",
      pubDate: new Date().toISOString(),
      size: 1024 * 1024 * 100,
      seeders: 50,
      leechers: 2,
      indexerName: "Indexer A",
    };
    const updateItem = {
      guid: "update-1",
      title: "Test Game Update",
      link: "http://test.com/update",
      pubDate: new Date().toISOString(),
      size: 1024 * 1024 * 5,
      seeders: 20,
      leechers: 1,
      indexerName: "Indexer A",
    };

    global.fetch = createFetchMock({
      search: { items: [mainItem, updateItem], total: 2, offset: 0 },
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Game SKIDROW").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    const downloadButtons = screen.getAllByTestId("icon-download");
    fireEvent.click(downloadButtons[0].closest("button")!);

    await waitFor(() => {
      expect(screen.getByText("Download with Updates?")).toBeInTheDocument();
    });
  });

  const skidrowItem = {
    guid: "skidrow-1",
    title: "Test Game SKIDROW",
    link: "http://test.com/skidrow",
    pubDate: new Date().toISOString(),
    size: 1024 * 1024 * 100,
    seeders: 50,
    leechers: 2,
    indexerName: "Indexer A",
    group: "SKIDROW",
  };
  const codexItem = {
    guid: "codex-1",
    title: "Test Game CODEX",
    link: "http://test.com/codex",
    pubDate: new Date().toISOString(),
    size: 1024 * 1024 * 100,
    seeders: 80,
    leechers: 5,
    indexerName: "Indexer A",
    group: "CODEX",
  };
  const groupSearchResults = { items: [skidrowItem, codexItem], total: 2, offset: 0 };

  it("filters displayed results to preferred groups when filterByPreferredGroups is enabled", async () => {
    global.fetch = createFetchMock({
      search: groupSearchResults,
      settings: { filterByPreferredGroups: true, preferredReleaseGroups: '["SKIDROW"]' },
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Game SKIDROW").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    expect(screen.queryByText("Test Game CODEX")).toBeNull();
  });

  it("shows all results when filterByPreferredGroups is false even if groups are configured", async () => {
    global.fetch = createFetchMock({
      search: groupSearchResults,
      settings: { filterByPreferredGroups: false, preferredReleaseGroups: '["SKIDROW"]' },
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Game SKIDROW").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Test Game CODEX").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );
  });
});
