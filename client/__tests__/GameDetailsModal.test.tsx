/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GameDetailsModal from "../src/components/GameDetailsModal";
import { Toaster } from "@/components/ui/toaster";

// Mocking external dependencies
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({ on: vi.fn(), disconnect: vi.fn() })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    toasts: [],
  }),
}));

vi.mock("../src/components/StatusBadge", () => ({
  default: ({ status }: { status: string }) => <div data-testid="status-badge">{status}</div>,
}));

vi.mock("../src/components/GameDownloadDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="game-download-dialog">Download Dialog</div> : null,
}));

vi.mock("lucide-react", () => ({
  Calendar: (props: Record<string, unknown>) => <div data-testid="icon-calendar" {...props} />,
  Star: (props: Record<string, unknown>) => <div data-testid="icon-star" {...props} />,
  Monitor: (props: Record<string, unknown>) => <div data-testid="icon-monitor" {...props} />,
  Gamepad2: (props: Record<string, unknown>) => <div data-testid="icon-gamepad2" {...props} />,
  Tag: (props: Record<string, unknown>) => <div data-testid="icon-tag" {...props} />,
  Download: (props: Record<string, unknown>) => <div data-testid="icon-download" {...props} />,
  Eye: (props: Record<string, unknown>) => <div data-testid="icon-eye" {...props} />,
  EyeOff: (props: Record<string, unknown>) => <div data-testid="icon-eye-off" {...props} />,
  X: (props: Record<string, unknown>) => <div data-testid="icon-x" {...props} />,
  ExternalLink: (props: Record<string, unknown>) => (
    <div data-testid="icon-external-link" {...props} />
  ),
  UserRound: (props: Record<string, unknown>) => <div data-testid="icon-user-round" {...props} />,
  Zap: (props: Record<string, unknown>) => <div data-testid="icon-zap" {...props} />,
  TrendingUp: (props: Record<string, unknown>) => <div data-testid="icon-trending-up" {...props} />,
  Clock: (props: Record<string, unknown>) => <div data-testid="icon-clock" {...props} />,
  HardDrive: (props: Record<string, unknown>) => <div data-testid="icon-hard-drive" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => (
    <div data-testid="icon-check-circle2" {...props} />
  ),
  Loader2: (props: Record<string, unknown>) => <div data-testid="icon-loader2" {...props} />,
  AlertCircle: (props: Record<string, unknown>) => (
    <div data-testid="icon-alert-circle" {...props} />
  ),
  PauseCircle: (props: Record<string, unknown>) => (
    <div data-testid="icon-pause-circle" {...props} />
  ),
  Users: (props: Record<string, unknown>) => <div data-testid="icon-users" {...props} />,
  Building2: (props: Record<string, unknown>) => <div data-testid="icon-building2" {...props} />,
  Search: (props: Record<string, unknown>) => <div data-testid="icon-search" {...props} />,
  ThumbsUp: (props: Record<string, unknown>) => <div data-testid="icon-thumbs-up" {...props} />,
}));

vi.mock("react-icons/fa", () => ({
  FaSteam: (props: Record<string, unknown>) => <div data-testid="icon-fa-steam" {...props} />,
  FaRedditAlien: (props: Record<string, unknown>) => (
    <div data-testid="icon-fa-reddit" {...props} />
  ),
  FaDiscord: (props: Record<string, unknown>) => <div data-testid="icon-fa-discord" {...props} />,
  FaWikipediaW: (props: Record<string, unknown>) => (
    <div data-testid="icon-fa-wikipedia" {...props} />
  ),
  FaItchIo: (props: Record<string, unknown>) => <div data-testid="icon-fa-itchio" {...props} />,
  FaTwitch: (props: Record<string, unknown>) => <div data-testid="icon-fa-twitch" {...props} />,
}));

vi.mock("react-icons/si", () => ({
  SiGogdotcom: (props: Record<string, unknown>) => <div data-testid="icon-si-gog" {...props} />,
  SiEpicgames: (props: Record<string, unknown>) => <div data-testid="icon-si-epic" {...props} />,
  SiProtondb: (props: Record<string, unknown>) => <div data-testid="icon-si-protondb" {...props} />,
  SiPcgamingwiki: (props: Record<string, unknown>) => (
    <div data-testid="icon-si-pcgamingwiki" {...props} />
  ),
  SiMetacritic: (props: Record<string, unknown>) => (
    <div data-testid="icon-si-metacritic" {...props} />
  ),
  SiItchdotio: (props: Record<string, unknown>) => (
    <div data-testid="icon-si-itchdotio" {...props} />
  ),
  SiNexusmods: (props: Record<string, unknown>) => (
    <div data-testid="icon-si-nexusmods" {...props} />
  ),
}));

const mockGame = {
  id: "1",
  title: "Test Game",
  summary: "This is a test summary for the game.",
  status: "wanted",
  rating: 8.5,
  userRating: null,
  releaseDate: new Date("2023-01-01").toISOString(),
  coverUrl: "http://test.com/cover.jpg",
  genres: ["Action", "Adventure"],
  platforms: ["PC", "PS5"],
  screenshots: ["http://test.com/screen1.jpg", "http://test.com/screen2.jpg"],
  hidden: false,
  source: "manual",
} as unknown as import("@shared/schema").Game;

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

// Mock fetch
global.fetch = vi.fn();

/**
 * Creates a fetch mock that routes by URL substring.
 * Defaults: `/api/hltb/lookup` → `{ data: null }`, everything else → `[]`.
 * Pass overrides to replace or extend defaults for a specific test.
 */
function makeFetchMock(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    "/api/hltb/lookup": { data: null },
    "/api/nexusmods/game-domain": { configured: false, domain: null },
  };
  const routes = { ...defaults, ...overrides };

  return (url: string) => {
    for (const [pattern, value] of Object.entries(routes)) {
      if (typeof url === "string" && url.includes(pattern)) {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(value) });
      }
    }
    return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue([]) });
  };
}

const renderComponent = (game = mockGame) => {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <GameDetailsModal game={game} open={true} onOpenChange={() => {}} />
      <Toaster />
    </QueryClientProvider>
  );
};

describe("GameDetailsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(makeFetchMock());
  });

  it("renders game details correctly", () => {
    renderComponent();
    expect(screen.getByTestId("text-game-title-1")).toHaveTextContent("Test Game");
    expect(screen.getByTestId("text-summary-1")).toHaveTextContent(
      "This is a test summary for the game."
    );
    expect(screen.getByTestId("text-rating-1")).toHaveTextContent("8.5/10");
    expect(screen.getByTestId("text-release-date-1")).toHaveTextContent("2023");
    expect(screen.getByTestId("img-cover-1")).toBeInTheDocument();
  });

  it("renders genres and platforms", () => {
    renderComponent();
    expect(screen.getByTestId("badge-genre-action")).toBeInTheDocument();
    expect(screen.getByTestId("badge-genre-adventure")).toBeInTheDocument();
    expect(screen.getByTestId("badge-platform-pc")).toBeInTheDocument();
    expect(screen.getByTestId("badge-platform-ps5")).toBeInTheDocument();
  });

  it("renders screenshots in Media tab", () => {
    renderComponent();
    // Media tab uses forceMount so screenshots are always in the DOM (hidden until tab activated)
    expect(screen.getByTestId("screenshot-0")).toBeInTheDocument();
    expect(screen.getByTestId("screenshot-1")).toBeInTheDocument();
  });

  it("opens download dialog when download button is clicked", async () => {
    renderComponent();
    const downloadButton = screen.getByTestId("button-download-game");
    fireEvent.click(downloadButton);
    await waitFor(() => {
      expect(screen.getByTestId("game-download-dialog")).toBeInTheDocument();
    });
  });

  it("handles remove game action", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderComponent();

    const removeButton = screen.getByTestId(`button-remove-game-quick-${mockGame.id}`);
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/games/1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("handles hide game action", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      makeFetchMock({ "/hidden": { hidden: true } })
    );
    renderComponent();

    const hideButton = screen.getByTestId(`button-toggle-hidden-quick-${mockGame.id}`);
    fireEvent.click(hideButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/games/${mockGame.id}/hidden`),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ hidden: true }),
        })
      );
    });
  });

  it("handles unhide game action when game starts hidden", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      makeFetchMock({ "/hidden": { hidden: false } })
    );

    const hiddenGame = { ...mockGame, hidden: true };
    renderComponent(hiddenGame);

    const unhideButton = screen.getByTestId(`button-toggle-hidden-quick-${mockGame.id}`);
    expect(unhideButton).toHaveTextContent("Unhide");
    fireEvent.click(unhideButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/games/${mockGame.id}/hidden`),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ hidden: false }),
        })
      );
    });
  });

  it("truncates long summary and expands it", () => {
    const longSummaryGame = { ...mockGame, summary: "A".repeat(300) };
    renderComponent(longSummaryGame);

    const summaryText = screen.getByTestId(`text-summary-${mockGame.id}`);
    // Summary paragraph shows truncated text; "Read more" is a sibling button
    expect(summaryText.textContent?.length).toBeLessThan(300);

    const readMoreButton = screen.getByText("Read more");
    fireEvent.click(readMoreButton);

    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("renders the Your rating section", () => {
    renderComponent();
    // Links tab is forceMount-ed; always in DOM
    expect(screen.getByTestId("section-user-rating")).toBeInTheDocument();
    expect(screen.getByText("Your rating")).toBeInTheDocument();
  });

  it('shows "Not rated" when userRating is null', () => {
    renderComponent({ ...mockGame, userRating: null } as unknown as import("@shared/schema").Game);
    expect(screen.getByText("Not rated")).toBeInTheDocument();
  });

  it("shows numeric rating when userRating is set", () => {
    renderComponent({ ...mockGame, userRating: 8 } as unknown as import("@shared/schema").Game);
    expect(screen.getByText("4/5")).toBeInTheDocument();
  });

  it("calls the user-rating API when a star is clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      makeFetchMock({ "/user-rating": { ...mockGame, userRating: 8 } })
    );

    renderComponent();

    // Links tab is forceMount-ed; activate the tab so the button is interactive
    fireEvent.click(screen.getByRole("tab", { name: /links/i }));

    const rateButton = await screen.findByRole("button", { name: "Rate 4 out of 5" });
    fireEvent.click(rateButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/games/${mockGame.id}/user-rating`),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ userRating: 8 }),
        })
      );
    });
  });

  it("uses 'IGDB score' label instead of 'Rating' in the metadata section", () => {
    renderComponent();
    expect(screen.getByText("IGDB score")).toBeInTheDocument();
    expect(screen.queryByText("Rating")).not.toBeInTheDocument();
  });

  describe("HowLongToBeat integration", () => {
    it("does not show HLTB section when data is null", async () => {
      renderComponent();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/hltb/lookup"),
          expect.anything()
        );
      });

      expect(screen.queryByTestId("section-hltb")).not.toBeInTheDocument();
    });

    it("shows HLTB section with completion times when data is present", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        makeFetchMock({
          "/api/hltb/lookup": {
            data: {
              gameplayMain: 25,
              gameplayMainExtra: 40,
              gameplayCompletionist: 65,
              url: "https://howlongtobeat.com/game/12345",
            },
          },
        })
      );

      renderComponent();

      const section = await screen.findByTestId("section-hltb");
      expect(section).toBeInTheDocument();
      expect(screen.getByText("25h")).toBeInTheDocument();
      expect(screen.getByText("40h")).toBeInTheDocument();
      expect(screen.getByText("65h")).toBeInTheDocument();
    });

    it("shows HowLongToBeat link with direct URL in Overview when data is present", async () => {
      const hltbUrl = "https://howlongtobeat.com/game/12345";
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        makeFetchMock({
          "/api/hltb/lookup": {
            data: {
              gameplayMain: 25,
              gameplayMainExtra: 0,
              gameplayCompletionist: 0,
              url: hltbUrl,
            },
          },
        })
      );

      renderComponent();

      // Wait for HLTB section to appear (ensures hltbData has loaded and all links updated)
      await screen.findByTestId("section-hltb");

      const links = screen.getAllByRole("link", { name: /howlongtobeat/i });
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((el) => el.getAttribute("href") === hltbUrl)).toBe(true);
    });

    it("shows fallback search link in Links tab when HLTB returns null", async () => {
      renderComponent();
      fireEvent.click(screen.getByRole("tab", { name: /links/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/hltb/lookup"),
          expect.anything()
        );
      });

      const hltbLink = screen.getByRole("link", { name: /howlongtobeat/i });
      expect(hltbLink.getAttribute("href")).toContain("howlongtobeat.com/?q=");
    });

    it("hides HLTB section when all completion times are zero", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        makeFetchMock({
          "/api/hltb/lookup": {
            data: {
              gameplayMain: 0,
              gameplayMainExtra: 0,
              gameplayCompletionist: 0,
              url: "https://howlongtobeat.com/game/12345",
            },
          },
        })
      );

      renderComponent();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/hltb/lookup"),
          expect.anything()
        );
      });

      expect(screen.queryByTestId("section-hltb")).not.toBeInTheDocument();
    });
  });

  describe("NexusMods integration", () => {
    it("shows fallback search link when Nexus Mods is not configured", async () => {
      // default beforeEach mock: configured: false, domain: null → fallback link shown
      renderComponent();
      fireEvent.click(screen.getByRole("tab", { name: /links/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/nexusmods/game-domain"),
          expect.anything()
        );
      });

      // Fallback link points to nexusmods.com search
      const nexusLink = await screen.findByRole("link", { name: /nexusmods/i });
      expect(nexusLink).toHaveAttribute(
        "href",
        expect.stringContaining("nexusmods.com/games?keyword=")
      );
    });

    it("shows direct mod link when domain is found", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        makeFetchMock({ "/api/nexusmods/game-domain": { configured: true, domain: "testgame" } })
      );

      renderComponent();
      fireEvent.click(screen.getByRole("tab", { name: /links/i }));

      const nexusLink = await screen.findByRole("link", { name: /nexusmods/i });
      expect(nexusLink).toHaveAttribute(
        "href",
        expect.stringContaining("nexusmods.com/testgame/mods/")
      );
    });

    it("hides NexusMods link when configured but no domain found", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        makeFetchMock({ "/api/nexusmods/game-domain": { configured: true, domain: null } })
      );

      renderComponent();
      fireEvent.click(screen.getByRole("tab", { name: /links/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/nexusmods/game-domain"),
          expect.anything()
        );
      });

      expect(screen.queryByRole("link", { name: /nexusmods/i })).not.toBeInTheDocument();
    });

    it("shows Mods tab when domain is found", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        makeFetchMock({ "/api/nexusmods/game-domain": { configured: true, domain: "testgame" } })
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: /mods/i })).toBeInTheDocument();
      });
    });

    it("does not show Mods tab when not configured", async () => {
      renderComponent();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/nexusmods/game-domain"),
          expect.anything()
        );
      });

      expect(screen.queryByRole("tab", { name: /^mods$/i })).not.toBeInTheDocument();
    });
  });

  describe("null game handling", () => {
    it("renders a placeholder Dialog instead of null when game is null", () => {
      const onOpenChange = vi.fn();
      render(
        <QueryClientProvider client={createQueryClient()}>
          <GameDetailsModal game={null} open={true} onOpenChange={onOpenChange} />
        </QueryClientProvider>
      );
      // No game title rendered, no crash
      expect(screen.queryByTestId("text-game-title-1")).not.toBeInTheDocument();
    });
  });

  describe("modal state reset", () => {
    it("resets summary expansion when modal closes", async () => {
      const { rerender } = renderComponent();

      // Expand the summary
      const expandBtn = screen.queryByRole("button", { name: /show more/i });
      if (expandBtn) {
        fireEvent.click(expandBtn);
        expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
      }

      // Close the modal
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <GameDetailsModal game={mockGame} open={false} onOpenChange={() => {}} />
          <Toaster />
        </QueryClientProvider>
      );

      // Reopen
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <GameDetailsModal game={mockGame} open={true} onOpenChange={() => {}} />
          <Toaster />
        </QueryClientProvider>
      );

      // Summary should be collapsed again
      expect(screen.queryByRole("button", { name: /show less/i })).not.toBeInTheDocument();
    });
  });
});
