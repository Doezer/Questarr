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
    // Default: downloads endpoint returns empty array
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });
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
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]) }) // downloads
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ hidden: true }) }); // hide
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
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]) }) // downloads
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ hidden: false }) }); // unhide

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
    expect(summaryText).toHaveTextContent("Read more");

    const readMoreButton = screen.getByText("Read more");
    fireEvent.click(readMoreButton);

    expect(summaryText).toHaveTextContent("Show less");
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
    // First call: downloads query (on render); second call: user-rating mutation (on click)
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockGame, userRating: 8 }),
      });

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
});
