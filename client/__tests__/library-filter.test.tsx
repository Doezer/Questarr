/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "./helpers/page-filter-test-setup";
import LibraryPage from "../src/pages/library";
import { type Game } from "@shared/schema";
import "@testing-library/jest-dom";

const { mockInvalidateQueries, mockMutate, mockToast, mockGames } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockMutate: vi.fn(),
  mockToast: vi.fn(),
  mockGames: { current: [] as Game[] },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
    useMutation: () => ({ mutate: mockMutate, isPending: false }),
    useQuery: () => ({ data: mockGames.current, isLoading: false }),
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

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
