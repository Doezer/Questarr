/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import LibraryPage from "../src/pages/library";
import { type Game } from "@shared/schema";
import "@testing-library/jest-dom";

// --- Hoisted mocks ---
const { mockInvalidateQueries, mockMutateAsync, mockToast, mockGames } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockMutateAsync: vi.fn(),
  mockToast: vi.fn(),
  mockGames: { current: [] as Game[] },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
    useMutation: () => ({ mutate: mockMutateAsync, isPending: false }),
    useQuery: () => ({ data: mockGames.current, isLoading: false }),
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Gamepad2: () => <div />,
    LayoutGrid: () => <div />,
    List: () => <div />,
    Settings2: () => <div />,
  };
});

// Render games as simple list of titles for easy assertion
vi.mock("../src/components/GameGrid", () => ({
  default: ({ games }: { games: Game[] }) => (
    <ul>
      {games.map((g) => (
        <li key={g.id}>{g.title}</li>
      ))}
    </ul>
  ),
}));

vi.mock("../src/components/EmptyState", () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

// UI stubs
vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

// Stub localStorage
Object.defineProperty(window, "localStorage", {
  value: { getItem: vi.fn(() => null), setItem: vi.fn() },
});

// --- Helpers ---
const makeGame = (id: string, title: string, status: Game["status"]): Game => ({
  id,
  title,
  status,
  coverUrl: null,
  releaseDate: null,
  rating: null,
  genres: [],
  summary: null,
  releaseStatus: "released",
  hidden: false,
  folderName: title,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("LibraryPage — LIBRARY_STATUSES filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGames.current = [];
  });

  it("shows only owned, completed, and downloading games", () => {
    mockGames.current = [
      makeGame("1", "Owned Game", "owned"),
      makeGame("2", "Completed Game", "completed"),
      makeGame("3", "Downloading Game", "downloading"),
      makeGame("4", "Wanted Game", "wanted"),
      makeGame("5", "Backlog Game", "backlog"),
    ];

    render(<LibraryPage />);

    expect(screen.getByText("Owned Game")).toBeInTheDocument();
    expect(screen.getByText("Completed Game")).toBeInTheDocument();
    expect(screen.getByText("Downloading Game")).toBeInTheDocument();
    expect(screen.queryByText("Wanted Game")).not.toBeInTheDocument();
    expect(screen.queryByText("Backlog Game")).not.toBeInTheDocument();
  });

  it("shows the empty state when no library games exist", () => {
    mockGames.current = [makeGame("1", "Only Wanted", "wanted")];

    render(<LibraryPage />);

    expect(screen.getByText("No games in library")).toBeInTheDocument();
  });
});
