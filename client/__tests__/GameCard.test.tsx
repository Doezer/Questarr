/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import GameCard from "../src/components/GameCard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("lucide-react", () => ({
  Download: () => <div data-testid="icon-download" />,
  Info: () => <div data-testid="icon-info" />,
  Star: () => <div data-testid="icon-star" />,
  Calendar: () => <div data-testid="icon-calendar" />,
  Eye: () => <div data-testid="icon-eye" />,
  EyeOff: () => <div data-testid="icon-eye-off" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Gamepad2: () => <div data-testid="icon-gamepad" />,
  Clock: () => <div data-testid="icon-clock" />,
  Trophy: () => <div data-testid="icon-trophy" />,
  Settings: () => <div data-testid="icon-settings" />,
  ExternalLink: () => <div data-testid="icon-external" />,
  AlertCircle: () => <div data-testid="icon-alert" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Link2: () => <div data-testid="icon-link2" />,
  X: () => <div data-testid="icon-x" />,
  Tag: () => <div data-testid="icon-tag" />,
  Monitor: () => <div data-testid="icon-monitor" />,
  SlidersHorizontal: () => <div data-testid="icon-sliders-horizontal" />,
  RefreshCw: () => <div data-testid="icon-refresh-cw" />,
  HardDrive: () => <div data-testid="icon-hard-drive" />,
  Check: () => <div data-testid="icon-check" />,
  Database: () => <div data-testid="icon-database" />,
  Search: () => <div data-testid="icon-search" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  Play: () => <div data-testid="icon-play" />,
  PackagePlus: () => <div data-testid="icon-package-plus" />,
  CalendarClock: () => <div data-testid="icon-calendar-clock" />,
  Plus: () => <div data-testid="icon-plus" />,
  CalendarDays: () => <div data-testid="icon-calendar-days" />,
  AlertTriangle: () => <div data-testid="icon-alert-triangle" />,
  FileWarning: () => <div data-testid="icon-file-warning" />,
  HelpCircle: () => <div data-testid="icon-help-circle" />,
  ChevronUp: () => <div data-testid="icon-chevron-up" />,
  ChevronLeft: () => <div data-testid="icon-chevron-left" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
}));

const mockGame = {
  id: "1",
  igdbId: 1001,
  title: "Test Game",
  coverUrl: "/test-cover.jpg",
  summary: "A test game",
  rating: 8.5,
  releaseDate: "2024-01-01",
  releaseStatus: "released",
  status: "owned" as const,
  hidden: false,
  platforms: ["PC"],
  genres: ["Action"],
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("GameCard", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <GameCard game={mockGame} {...props} />
      </QueryClientProvider>
    );
  };

  it("renders game details correctly", () => {
    renderComponent();
    expect(screen.getByTestId("text-title-1")).toHaveTextContent("Test Game");
    expect(screen.getByTestId("text-rating-1")).toHaveTextContent("8.5/10");
    expect(screen.getByTestId("text-release-1")).toHaveTextContent("2024-01-01");
  });

  it("calls onViewDetails when clicking the card", () => {
    const onViewDetails = vi.fn();
    renderComponent({ onViewDetails });
    fireEvent.click(screen.getByTestId("card-game-1"));
    expect(onViewDetails).toHaveBeenCalledWith("1");
  });
});
