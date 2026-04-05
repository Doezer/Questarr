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

// Route apiRequest through global.fetch so test mocks capture mutation calls
vi.mock("@/lib/queryClient", () => ({
  apiRequest: async (method: string, url: string, data?: unknown) => {
    const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
    const res = await global.fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Request failed");
    return res;
  },
}));

// Mocking external dependencies
const mockToast = vi.fn();

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));
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
  MoreVertical: () => <div data-testid="icon-more-vertical" />,
  Copy: () => <div />,
  Ban: () => <div data-testid="icon-ban" />,
}));

const mockGame = {
  id: 1,
  title: "Test Game",
  igdbId: 123,
  gameDetails: {},
} as unknown as import("@shared/schema").Game;

type TorrentItemOverrides = {
  guid?: string;
  title?: string;
  link?: string;
  pubDate?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  indexerName?: string;
  group?: string;
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
};

type UsenetItemOverrides = {
  guid?: string;
  title?: string;
  link?: string;
  pubDate?: string;
  size?: number;
  grabs?: number;
  age?: number;
  indexerName?: string;
  files?: number;
  poster?: string;
};

const makeTorrentItem = (overrides: TorrentItemOverrides = {}) => ({
  guid: overrides.guid ?? "torrent-1",
  title: overrides.title ?? "Test Torrent",
  link: overrides.link ?? "http://test.com/torrent",
  pubDate: overrides.pubDate ?? new Date().toISOString(),
  size: overrides.size ?? 1024 * 1024 * 100,
  seeders: overrides.seeders ?? 10,
  leechers: overrides.leechers ?? 2,
  indexerName: overrides.indexerName ?? "Indexer A",
  ...(overrides.group !== undefined && { group: overrides.group }),
  ...(overrides.downloadVolumeFactor !== undefined && {
    downloadVolumeFactor: overrides.downloadVolumeFactor,
  }),
  ...(overrides.uploadVolumeFactor !== undefined && {
    uploadVolumeFactor: overrides.uploadVolumeFactor,
  }),
});

const makeUsenetItem = (overrides: UsenetItemOverrides = {}) => ({
  guid: overrides.guid ?? "usenet-1",
  title: overrides.title ?? "Test Usenet NZB",
  link: overrides.link ?? "http://test.com/nzb",
  pubDate: overrides.pubDate ?? new Date().toISOString(),
  size: overrides.size ?? 1024 * 1024 * 50,
  grabs: overrides.grabs ?? 50,
  age: overrides.age ?? 2,
  indexerName: overrides.indexerName ?? "Indexer C",
  ...(overrides.files !== undefined && { files: overrides.files }),
  ...(overrides.poster !== undefined && { poster: overrides.poster }),
});

const makeSearchResult = (items: object[], total?: number) => ({
  items,
  total: total ?? items.length,
  offset: 0,
});

const mockTorrents = makeSearchResult(
  [
    makeTorrentItem({ guid: "123", title: "Test Torrent 1", link: "http://test.com/torrent1" }),
    makeTorrentItem({
      guid: "456",
      title: "Test Torrent 2",
      link: "http://test.com/torrent2",
      pubDate: new Date(Date.now() - 86400000).toISOString(),
      size: 1024 * 1024 * 200,
      seeders: 5,
      leechers: 1,
      indexerName: "Indexer B",
    }),
    makeUsenetItem({ guid: "789", title: "Test Usenet NZB", link: "http://test.com/nzb1" }),
  ],
  3
);

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
  blacklist?: object;
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
    if (urlString.includes("/blacklist")) {
      return {
        ok: true,
        json: async () =>
          overrides.blacklist ?? {
            id: "bl-1",
            gameId: mockGame.id,
            releaseTitle: "Test Torrent 1",
          },
      };
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

  it("blacklists a release when clicking 'Blacklist release'", async () => {
    renderComponent();

    // Wait for results to load (dropdown is always rendered via mock)
    await waitFor(
      () => {
        expect(screen.getAllByText("Blacklist release").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    fireEvent.click(screen.getAllByText("Blacklist release")[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/blacklist"),
        expect.objectContaining({
          method: "POST",
          // Results are sorted desc by health. "Test Usenet NZB" has 50 grabs,
          // "Test Torrent 1" has 10 seeders, so NZB is first.
          body: expect.stringContaining("Test Usenet NZB"),
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
    const mainItem = makeTorrentItem({
      guid: "main-1",
      title: "Test Game SKIDROW",
      link: "http://test.com/main",
      seeders: 50,
    });
    const updateItem = makeTorrentItem({
      guid: "update-1",
      title: "Test Game Update",
      link: "http://test.com/update",
      size: 1024 * 1024 * 5,
      seeders: 20,
      leechers: 1,
    });

    global.fetch = createFetchMock({
      search: makeSearchResult([mainItem, updateItem]),
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

  const skidrowItem = makeTorrentItem({
    guid: "skidrow-1",
    title: "Test Game SKIDROW",
    link: "http://test.com/skidrow",
    seeders: 50,
    leechers: 2,
    group: "SKIDROW",
  });
  const codexItem = makeTorrentItem({
    guid: "codex-1",
    title: "Test Game CODEX",
    link: "http://test.com/codex",
    seeders: 80,
    leechers: 5,
    group: "CODEX",
  });
  const groupSearchResults = makeSearchResult([skidrowItem, codexItem]);

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

  const pcItem = makeTorrentItem({
    guid: "pc-1",
    title: "Test Game PC v1.0-SKIDROW",
    link: "http://test.com/pc",
    seeders: 50,
    leechers: 2,
    group: "SKIDROW",
  });
  const macItem = makeTorrentItem({
    guid: "mac-1",
    title: "Test Game Mac Edition-CODEX",
    link: "http://test.com/mac",
    size: 1024 * 1024 * 80,
    seeders: 30,
    leechers: 1,
    group: "CODEX",
  });
  const platformSearchResults = makeSearchResult([pcItem, macItem]);

  it("shows platform filter section when results contain platform metadata", async () => {
    global.fetch = createFetchMock({ search: platformSearchResults });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Game PC v1.0-SKIDROW").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    // Open filters
    fireEvent.click(screen.getByText("Show Filters"));

    await waitFor(() => {
      expect(screen.getByText("Platform")).toBeInTheDocument();
    });
  });

  it("filters results by selected platform", async () => {
    global.fetch = createFetchMock({ search: platformSearchResults });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Game PC v1.0-SKIDROW").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Test Game Mac Edition-CODEX").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    // Open filters
    fireEvent.click(screen.getByText("Show Filters"));

    // Open the platform MultiSelect
    const platformTrigger = screen.getByText("All platforms").closest("button")!;
    fireEvent.click(platformTrigger);

    // Select "PC" via the role="option" element in the dropdown
    await waitFor(() => {
      const pcOption = screen.getByRole("option", { name: /\bPC\b/ });
      expect(pcOption).toBeInTheDocument();
    });

    const pcOption = screen.getByRole("option", { name: /\bPC\b/ });
    fireEvent.click(pcOption);

    // After selecting PC, Mac item should be filtered out
    await waitFor(() => {
      expect(screen.queryByText("Test Game Mac Edition-CODEX")).toBeNull();
      expect(screen.getAllByText("Test Game PC v1.0-SKIDROW").length).toBeGreaterThan(0);
    });
  });

  it("clears stale platform selections when search results no longer include that platform", async () => {
    // Start with PC + Mac results
    global.fetch = createFetchMock({ search: platformSearchResults });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Test Game PC v1.0-SKIDROW").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    // Open filters and select Mac
    fireEvent.click(screen.getByText("Show Filters"));
    const platformTrigger = screen.getByText("All platforms").closest("button")!;
    fireEvent.click(platformTrigger);

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /\bMac\b/ })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("option", { name: /\bMac\b/ }));

    // Mac chip should now appear in the MultiSelect trigger (as a removable badge)
    await waitFor(() => {
      // The trigger now shows at least 2 "Mac" elements: badge chip + platform badge in row
      expect(screen.getAllByText("Mac").length).toBeGreaterThan(0);
    });

    // Close the popover before changing search
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    // Now simulate search returning only PC results (no Mac platform)
    const pcOnlyResults = makeSearchResult([pcItem]);
    global.fetch = createFetchMock({ search: pcOnlyResults });

    // Change search query to trigger re-fetch
    const searchInput = screen.getByDisplayValue("Test Game");
    fireEvent.change(searchInput, { target: { value: "Test Game PC" } });

    // Both the Mac item row and the Mac chip in the MultiSelect trigger should be gone
    await waitFor(
      () => {
        expect(screen.queryAllByText("Mac").length).toBe(0);
      },
      { timeout: 3000 }
    );
  });

  it("displays Freeleech badge for torrents with downloadVolumeFactor of 0", async () => {
    global.fetch = createFetchMock({
      search: makeSearchResult([
        makeTorrentItem({
          guid: "fl-1",
          title: "Freeleech Game",
          link: "http://test.com/freeleech",
          seeders: 20,
          leechers: 3,
          downloadVolumeFactor: 0,
          uploadVolumeFactor: 1,
        }),
      ]),
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByText("Freeleech")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("does not display Freeleech badge when downloadVolumeFactor is absent", async () => {
    global.fetch = createFetchMock({
      search: makeSearchResult([
        makeTorrentItem({
          guid: "no-fl-1",
          title: "Normal Torrent Game",
          link: "http://test.com/normal",
        }),
      ]),
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getAllByText("Normal Torrent Game").length).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );

    expect(screen.queryByText("Freeleech")).toBeNull();
  });

  it("displays leechers count for torrent results", async () => {
    global.fetch = createFetchMock({
      search: makeSearchResult([
        makeTorrentItem({
          guid: "leecher-1",
          title: "Torrent With Leechers",
          link: "http://test.com/leechers",
          seeders: 15,
          leechers: 7,
        }),
      ]),
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByText("7L")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("displays file count for usenet results", async () => {
    global.fetch = createFetchMock({
      search: makeSearchResult([
        makeUsenetItem({
          guid: "nzb-files-1",
          title: "Usenet Game With Files",
          link: "http://test.com/nzb",
          grabs: 30,
          age: 1,
          files: 12,
          indexerName: "Indexer C",
        }),
      ]),
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByText("12 files")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("displays poster name for usenet results", async () => {
    global.fetch = createFetchMock({
      search: makeSearchResult([
        makeUsenetItem({
          guid: "nzb-poster-1",
          title: "Usenet Game With Poster",
          link: "http://test.com/nzb2",
          grabs: 10,
          age: 2,
          poster: "uploader@example.com",
          indexerName: "Indexer C",
        }),
      ]),
    });

    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByText("uploader@example.com")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
