/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../src/components/ui/tooltip";
import CalendarPage from "../src/pages/calendar";

vi.mock("@/components/GameDownloadDialog", () => ({
  default: ({ open, game }: { open: boolean; game: { title: string } | null }) =>
    open && game ? <div data-testid="calendar-download-dialog">Download {game.title}</div> : null,
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiRequest: vi.fn(async () => ({
      json: async () => ({ igdb: { configured: true } }),
    })),
  };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="Calendar view"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
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
    },
  });

const baseGame = {
  id: "game-1",
  title: "Space Quest",
  releaseDate: "2026-06-02",
  status: "wanted",
  releaseStatus: "released",
  coverUrl: null,
  genres: ["Adventure"],
  summary: "A space adventure",
};

function renderPage() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TooltipProvider>
        <CalendarPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("CalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/games")) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  it("shows the IGDB setup prompt when configuration is missing", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => ({ igdb: { configured: false } }),
    } as Awaited<ReturnType<typeof apiRequest>>);

    renderPage();

    expect(await screen.findByText("IGDB Configuration Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Settings" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no wanted games", async () => {
    renderPage();

    expect(
      await screen.findByText("No games in your wishlist. Add games to track their release dates.")
    ).toBeInTheDocument();
  });

  it("filters displayed games and renders the undated year section", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/games")) {
        return {
          ok: true,
          json: async () => [
            baseGame,
            { ...baseGame, id: "game-2", title: "Mystery Year", releaseDate: "2026-12-31" },
            { ...baseGame, id: "game-3", title: "Owned Game", status: "owned" },
          ],
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    renderPage();

    expect(
      await screen.findByText((content) => content.includes("No Release Date"))
    ).toBeInTheDocument();
    expect(screen.getByText("Mystery Year")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Filter games..." }), {
      target: { value: "space" },
    });

    await waitFor(() => {
      expect(screen.getByText("Space Quest")).toBeInTheDocument();
      expect(screen.queryByText("Mystery Year")).not.toBeInTheDocument();
    });
  });

  it("switches to week view and opens the download dialog from a visible game", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/games")) {
        return {
          ok: true,
          json: async () => [
            { ...baseGame, id: "game-4", title: "Week Hero", releaseDate: "2026-05-29" },
          ],
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    renderPage();

    fireEvent.change(await screen.findByRole("combobox", { name: "Calendar view" }), {
      target: { value: "week" },
    });

    const [gameButton] = await screen.findAllByRole("button", { name: /Week Hero/i });
    fireEvent.click(gameButton);

    expect(await screen.findByTestId("calendar-download-dialog")).toHaveTextContent(
      "Download Week Hero"
    );
  });

  it("shows month view mobile day details when a day with releases is tapped", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/games")) {
        return {
          ok: true,
          json: async () => [
            { ...baseGame, id: "game-5", title: "Month Hero", releaseDate: "2026-05-29" },
          ],
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    renderPage();

    fireEvent.change(await screen.findByRole("combobox", { name: "Calendar view" }), {
      target: { value: "month" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading calendar...")).not.toBeInTheDocument();
    });

    const dayCell = Array.from(document.querySelectorAll("div.cursor-pointer")).find((node) =>
      node.textContent?.includes("29")
    ) as HTMLDivElement | undefined;

    expect(dayCell).toBeDefined();
    fireEvent.click(dayCell);

    await waitFor(() => {
      expect(dayCell.className).toContain("border-primary/60");
      expect(dayCell.className).toContain("bg-primary/5");
    });

    fireEvent.click(dayCell);

    await waitFor(() => {
      expect(dayCell.className).not.toContain("border-primary/60");
      expect(dayCell.className).not.toContain("bg-primary/5");
    });
  });
});
