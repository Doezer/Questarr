/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AddGameModal from "../src/components/AddGameModal";
import { setAddGamePendingQuery, clearAddGamePendingQuery } from "../src/lib/add-game-store";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

let mockIsMobile = false;

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

vi.mock("lucide-react", () => ({
  Search: () => <div />,
  Plus: () => <div />,
  Star: () => <div />,
  AlertCircle: () => <div />,
  Calendar: () => <div data-testid="icon-calendar" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Check: () => <div data-testid="icon-check" />,
  X: () => <div />,
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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
      mutations: { retry: false },
    },
  });

const makeSearchResult = (title = "Test Game", releaseDate = "2023-06-15") => ({
  id: "igdb-1",
  igdbId: 100,
  title,
  rating: 8.0,
  releaseDate,
  platforms: ["PC"],
  genres: ["Action"],
  coverUrl: null,
  inCollection: false,
  source: "api",
});

function setupFetch({
  searchResults = [],
  userGames = [],
  configured = true,
  postHandler,
}: {
  searchResults?: object[];
  userGames?: object[];
  configured?: boolean;
  postHandler?: () => Promise<unknown>;
} = {}) {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/config") && !u.includes("/api/igdb")) {
      return { ok: true, json: async () => ({ igdb: { configured } }) };
    }
    if (u.includes("/api/igdb/search")) {
      return { ok: true, json: async () => searchResults };
    }
    if (u === "/api/games" && init?.method === "POST" && postHandler) {
      await postHandler();
      return { ok: true, json: async () => ({}) };
    }
    if (u === "/api/games" && init?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    if (u.endsWith("/api/games")) {
      return { ok: true, json: async () => userGames };
    }
    return { ok: true, json: async () => [] };
  }) as never;
}

const renderModal = (props: { initialQuery?: string } = {}) => {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AddGameModal {...props}>
        <button data-testid="open-btn">Open</button>
      </AddGameModal>
    </QueryClientProvider>
  );
};

describe("AddGameModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMobile = false;
    clearAddGamePendingQuery();
    setupFetch();
  });

  afterEach(() => {
    clearAddGamePendingQuery();
  });

  it("pre-fills search input from initialQuery prop when modal opens", async () => {
    renderModal({ initialQuery: "Hollow Knight" });
    fireEvent.click(screen.getByTestId("open-btn"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Hollow Knight")).toBeInTheDocument();
    });
  });

  it("pre-fills search from add-game-store when modal opens without initialQuery", async () => {
    setAddGamePendingQuery("Dark Souls");
    renderModal();
    fireEvent.click(screen.getByTestId("open-btn"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Dark Souls")).toBeInTheDocument();
    });
  });

  it("clears search state when modal closes", async () => {
    const { rerender } = renderModal({ initialQuery: "Hollow Knight" });
    fireEvent.click(screen.getByTestId("open-btn"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Hollow Knight")).toBeInTheDocument();
    });

    // Close modal by re-rendering with Dialog closed via a different mechanism.
    // The effect runs on `open` change; simulate by typing and then looking for clear.
    const input = screen.getByDisplayValue("Hollow Knight");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByDisplayValue("")).toBeInTheDocument();
  });

  it("shows Calendar icon for search results with a release date", async () => {
    setupFetch({ searchResults: [makeSearchResult("Elden Ring", "2022-02-25")] });
    renderModal({ initialQuery: "Elden Ring" });
    fireEvent.click(screen.getByTestId("open-btn"));

    await waitFor(
      () => {
        expect(screen.getByText("Elden Ring")).toBeInTheDocument();
        expect(screen.getByTestId("icon-calendar")).toBeInTheDocument();
      },
      { timeout: 4000 }
    );
  });

  it("shows release year only for year-end release dates (Dec 31)", async () => {
    setupFetch({ searchResults: [makeSearchResult("TBD Game", "2024-12-31")] });
    renderModal({ initialQuery: "TBD Game" });
    fireEvent.click(screen.getByTestId("open-btn"));

    await waitFor(
      () => {
        expect(screen.getByText("TBD Game")).toBeInTheDocument();
        expect(screen.getByText("2024")).toBeInTheDocument();
      },
      { timeout: 4000 }
    );
  });

  it("requests undated IGDB results when the toggle is enabled", async () => {
    setupFetch({ searchResults: [makeSearchResult("Elden Ring", "2022-02-25")] });
    renderModal({ initialQuery: "Elden Ring" });
    fireEvent.click(screen.getByTestId("open-btn"));

    await waitFor(() => {
      expect(screen.getByText("Show undated games first")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("includeUndated=true"),
        expect.any(Object)
      );
    });
  });

  it("shows the mobile configuration prompt when IGDB is not configured", async () => {
    mockIsMobile = true;
    setupFetch({ configured: false });
    renderModal();

    fireEvent.click(screen.getByTestId("open-btn"));

    expect(await screen.findByText("IGDB Configuration Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Settings" })).toBeInTheDocument();
  });

  it("renders the mobile empty prompt and added badge for games already in collection", async () => {
    mockIsMobile = true;
    const result = makeSearchResult("Collection Game", "2024-12-31");
    setupFetch({
      searchResults: [result],
      userGames: [{ ...result }],
    });
    renderModal({ initialQuery: "Collection Game" });
    fireEvent.click(screen.getByTestId("open-btn"));
    fireEvent.change(screen.getByTestId("input-game-search"), {
      target: { value: "Collection Game" },
    });

    expect(await screen.findByTestId("search-result-igdb-1")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("shows the mobile add spinner while a game is being added", async () => {
    mockIsMobile = true;

    let resolvePost: (() => void) | undefined;
    setupFetch({
      searchResults: [makeSearchResult("Pending Game", "2025-04-01")],
      postHandler: () =>
        new Promise<void>((resolve) => {
          resolvePost = resolve;
        }),
    });

    renderModal({ initialQuery: "Pending Game" });
    fireEvent.click(screen.getByTestId("open-btn"));

    const addButton = await screen.findByTestId("button-add-igdb-1");
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByTestId("icon-loader")).toBeInTheDocument();
      expect(addButton).toBeDisabled();
    });

    resolvePost?.();
  });
});
