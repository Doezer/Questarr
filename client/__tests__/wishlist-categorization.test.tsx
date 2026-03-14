/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./helpers/page-filter-test-setup";
import WishlistPage from "../src/pages/wishlist";
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
const makeWanted = (id: string, title: string, releaseDate: string | null): Game => ({
  id,
  title,
  status: "wanted",
  coverUrl: null,
  releaseDate,
  rating: null,
  genres: [],
  summary: null,
  releaseStatus: releaseDate ? "released" : "tba",
  hidden: false,
  folderName: title,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("WishlistPage — release date categorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Pin time to 2026-06-15 noon UTC
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    mockGames.current = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts past-release games in Released and future games in Upcoming", () => {
    mockGames.current = [
      makeWanted("1", "Old Game", "2026-01-01"), // past → released
      makeWanted("2", "New Game", "2027-01-01"), // future → upcoming
    ];

    render(<WishlistPage />);

    const releasedHeading = screen.getByRole("heading", { name: "Released" });
    const upcomingHeading = screen.getByRole("heading", { name: "Upcoming" });

    // Both sections visible
    expect(releasedHeading).toBeInTheDocument();
    expect(upcomingHeading).toBeInTheDocument();

    // Each game appears in exactly the right section
    expect(screen.getByText("Old Game")).toBeInTheDocument();
    expect(screen.getByText("New Game")).toBeInTheDocument();
  });

  it("puts games without a release date in To Be Announced", () => {
    mockGames.current = [makeWanted("3", "Mystery Game", null)];

    render(<WishlistPage />);

    expect(screen.getByRole("heading", { name: "To Be Announced" })).toBeInTheDocument();
    expect(screen.getByText("Mystery Game")).toBeInTheDocument();
  });

  it("categorizes a game as Released when rendered on a date after the release", () => {
    // Set time to well after the release date to avoid boundary/timezone issues
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    mockGames.current = [makeWanted("4", "Already Released Game", "2026-06-16")];

    render(<WishlistPage />);

    expect(screen.getByRole("heading", { name: "Released" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Upcoming" })).not.toBeInTheDocument();
    expect(screen.getByText("Already Released Game")).toBeInTheDocument();
  });

  it("shows empty state when no wanted games exist", () => {
    mockGames.current = [{ ...makeWanted("5", "Owned Game", null), status: "owned" }];

    render(<WishlistPage />);

    expect(screen.getByText("Your wishlist is empty")).toBeInTheDocument();
  });
});
