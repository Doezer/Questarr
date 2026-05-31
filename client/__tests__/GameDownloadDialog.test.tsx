/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GameDownloadDialog from "../src/components/GameDownloadDialog";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

// Route apiRequest through globalThis.fetch so test mocks capture mutation calls
vi.mock("@/lib/queryClient", () => ({
  apiRequest: async (method: string, url: string, data?: unknown) => {
    const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
    const res = await globalThis.fetch(url, {
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
let mockIsMobile = false;

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

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
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
  Info: () => <div data-testid="icon-info" />,
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
  pubDate: overrides.pubDate ?? "2023-01-01T12:00:00.000Z",
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
  pubDate: overrides.pubDate ?? "2023-01-01T12:00:00.000Z",
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
      pubDate: "2022-12-31T12:00:00.000Z",
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
globalThis.fetch = vi.fn();

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
    const urlString = getRequestUrl(url);
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
  }) as typeof fetch;

describe("GameDownloadDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIsMobile = false;
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });
    globalThis.fetch = createFetchMock();
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
      expect(globalThis.fetch).toHaveBeenCalledWith(
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

  it("keeps dialog open and shows toast after successful download", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByTestId("icon-download").length).toBeGreaterThan(0);
    });

    const downloadButton = screen.getAllByTestId("icon-download")[0].closest("button");
    if (!downloadButton) throw new Error("Download button not found");
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("download(s) sent") })
      );
    });

    // Dialog should remain open (onOpenChange should NOT be called with false)
    expect(mockOnOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows destructive toast when download API returns success:false", async () => {
    globalThis.fetch = createFetchMock({
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
    globalThis.fetch = createFetchMock({
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

    globalThis.fetch = createFetchMock({
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
    globalThis.fetch = createFetchMock({
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
    globalThis.fetch = createFetchMock({
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
    globalThis.fetch = createFetchMock({ search: platformSearchResults });

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
    globalThis.fetch = createFetchMock({ search: platformSearchResults });

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
    globalThis.fetch = createFetchMock({ search: platformSearchResults });

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
    globalThis.fetch = createFetchMock({ search: pcOnlyResults });

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
    globalThis.fetch = createFetchMock({
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
    globalThis.fetch = createFetchMock({
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
    globalThis.fetch = createFetchMock({
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

  it.skip("displays file count for usenet results", async () => {
    globalThis.fetch = createFetchMock({
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

  describe("Preferred Platform preselection", () => {
    /** Render with a specific preferred platform and search result titles. */
    async function renderWithPlatform(
      platform: string | null,
      items: ReturnType<typeof makeTorrentItem>[]
    ) {
      globalThis.fetch = createFetchMock({
        settings: { preferredPlatform: platform },
        search: makeSearchResult(items),
      });
      renderComponent();
    }

    it("preselects the preferred platform and shows only matching items", async () => {
      await renderWithPlatform("PS5", [
        makeTorrentItem({ guid: "ps5-1", title: "Test Game PS5-GROUP", seeders: 50 }),
        makeTorrentItem({ guid: "pc-1", title: "Test Game PC-SKIDROW", seeders: 40 }),
      ]);
      await waitFor(
        () => expect(screen.getAllByText("Test Game PS5-GROUP").length).toBeGreaterThan(0),
        { timeout: 3000 }
      );
      expect(screen.queryByText("Test Game PC-SKIDROW")).toBeNull();
    });

    it("PC preselection includes releases with no detected platform", async () => {
      await renderWithPlatform("PC", [
        makeTorrentItem({ guid: "noplatform-1", title: "Test Game-CODEX", seeders: 80 }),
        makeTorrentItem({ guid: "ps5-1", title: "Test Game PS5-GROUP", seeders: 60 }),
      ]);
      await waitFor(
        () => expect(screen.getAllByText("Test Game-CODEX").length).toBeGreaterThan(0),
        { timeout: 3000 }
      );
      expect(screen.queryByText("Test Game PS5-GROUP")).toBeNull();
    });

    it("PC preselection includes explicit PC releases", async () => {
      await renderWithPlatform("PC", [
        makeTorrentItem({ guid: "pc-1", title: "Test Game PC-SKIDROW", seeders: 50 }),
        makeTorrentItem({ guid: "ps5-1", title: "Test Game PS5-GROUP", seeders: 60 }),
      ]);
      await waitFor(
        () => expect(screen.getAllByText("Test Game PC-SKIDROW").length).toBeGreaterThan(0),
        { timeout: 3000 }
      );
      expect(screen.queryByText("Test Game PS5-GROUP")).toBeNull();
    });

    it("does not preselect platform when none is configured", async () => {
      await renderWithPlatform(null, [
        makeTorrentItem({ guid: "ps5-1", title: "Test Game PS5-GROUP", seeders: 60 }),
        makeTorrentItem({ guid: "pc-1", title: "Test Game PC-SKIDROW", seeders: 50 }),
      ]);
      await waitFor(
        () => {
          expect(screen.getAllByText("Test Game PS5-GROUP").length).toBeGreaterThan(0);
          expect(screen.getAllByText("Test Game PC-SKIDROW").length).toBeGreaterThan(0);
        },
        { timeout: 3000 }
      );
    });
  });

  it("displays poster name for usenet results", async () => {
    globalThis.fetch = createFetchMock({
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

  it("shows the preferred-platform warning and clears it with the inline action", async () => {
    globalThis.fetch = createFetchMock({
      settings: { preferredPlatform: "PS5" },
      search: platformSearchResults,
    });

    renderComponent();

    expect(
      (
        await screen.findAllByText(
          (_, element) =>
            element?.textContent?.includes("No results match your preferred platform") ?? false
        )
      ).length
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));

    await waitFor(() => {
      expect(screen.queryByText(/No results match your preferred platform/i)).toBeNull();
      expect(screen.getAllByText("Test Game PC v1.0-SKIDROW").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Test Game Mac Edition-CODEX").length).toBeGreaterThan(0);
    });
  });

  it("supports copying links and sending a release to a specific downloader", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = getRequestUrl(url);
      if (target.includes("/api/search")) {
        return { ok: true, json: async () => mockTorrents } as Response;
      }
      if (target.includes("/api/indexers/enabled")) {
        return { ok: true, json: async () => mockEnabledIndexers } as Response;
      }
      if (target.includes("/api/downloaders/enabled")) {
        return {
          ok: true,
          json: async () => [
            { id: "1", name: "qBittorrent", enabled: true, type: "qbittorrent" },
            { id: "2", name: "Transmission", enabled: true, type: "transmission" },
            { id: "3", name: "SABnzbd", enabled: true, type: "sabnzbd" },
          ],
        } as Response;
      }
      if (target.includes("/api/settings")) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (target.includes("/api/downloaders/2/downloads") && init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (target.includes("/api/downloaders/")) {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }) as typeof fetch;

    renderComponent();

    expect(await screen.findAllByText("Copy Torrent Link")).not.toHaveLength(0);
    expect(await screen.findAllByText("Transmission")).not.toHaveLength(0);

    fireEvent.click(screen.getAllByText("Copy Torrent Link")[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://test.com/torrent1");

    fireEvent.click(screen.getAllByText("Transmission")[0]);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/downloaders/2/downloads",
        expect.objectContaining({ method: "POST" })
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Download sent to Transmission" })
      );
    });
  });

  it("lets mobile users select bundle updates and download only the main game", async () => {
    mockIsMobile = true;
    globalThis.fetch = createFetchMock({
      search: makeSearchResult([
        makeTorrentItem({
          guid: "mobile-main",
          title: "Test Game ElAmigos",
          link: "http://test.com/mobile-main",
          pubDate: new Date().toISOString(),
          downloadVolumeFactor: 0,
        }),
        makeTorrentItem({
          guid: "mobile-update",
          title: "Test Game Update v1.1",
          link: "http://test.com/mobile-update",
          seeders: 8,
        }),
      ]),
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("Test Game ElAmigos").length).toBeGreaterThan(0);
      expect(screen.getByText("Freeleech")).toBeInTheDocument();
      expect(screen.getByText("NEW")).toBeInTheDocument();
    });

    const downloadButtons = screen.getAllByTestId("icon-download");
    const firstDownloadButton = downloadButtons[0]?.closest("button");
    expect(firstDownloadButton).not.toBeNull();
    if (!firstDownloadButton) {
      throw new Error("Expected a download button");
    }
    fireEvent.click(firstDownloadButton);

    await waitFor(() => {
      expect(screen.getByText("Download with Updates?")).toBeInTheDocument();
      expect(screen.getByText("1 of 1 updates selected")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Deselect All"));
    expect(screen.getByText("0 of 1 updates selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Select All"));
    expect(screen.getByText("1 of 1 updates selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Only the main game"));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/downloads",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("mobile-main"),
        })
      );
    });
  });

  it("renders parsed metadata badges for mobile torrent results", async () => {
    mockIsMobile = true;
    globalThis.fetch = createFetchMock({
      search: makeSearchResult([
        makeTorrentItem({
          guid: "metadata-1",
          title: "Shadow.of.the.Tomb.Raider.v1.2.MULTI5.DRM-Free.PC-SKIDROW",
          link: "http://test.com/metadata",
          seeders: 42,
          downloadVolumeFactor: 0,
        }),
      ]),
    });

    renderComponent();

    expect(
      await screen.findByText("Shadow.of.the.Tomb.Raider.v1.2.MULTI5.DRM-Free.PC-SKIDROW")
    ).toBeInTheDocument();
    expect(screen.getByText("v1.2")).toBeInTheDocument();
    expect(screen.getByText("Multi")).toBeInTheDocument();
    expect(screen.getByText("DRM-Free")).toBeInTheDocument();
    expect(screen.getByText("PC")).toBeInTheDocument();
    expect(screen.getByText("Scene")).toBeInTheDocument();
    expect(screen.getByText("Freeleech")).toBeInTheDocument();
  });
});
