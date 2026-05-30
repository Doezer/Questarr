import { describe, it, expect } from "vitest";
import { calculateLibraryStats } from "../stats";
import { type Game } from "@shared/schema";

describe("calculateLibraryStats", () => {
  const mockGames: Partial<Game>[] = [
    {
      id: "1",
      title: "Game 1",
      status: "owned",
      rating: 80,
      userRating: 8,
      genres: ["Action", "RPG"],
      platforms: ["PC"],
      publishers: ["Pub 1"],
      developers: ["Dev 1"],
      releaseDate: "2020-01-01",
      summary: "Summary 1",
      coverUrl: "url1",
    },
    {
      id: "2",
      title: "Game 2",
      status: "completed",
      rating: 90,
      userRating: 7.5,
      genres: ["RPG"],
      platforms: ["PC", "PS5"],
      publishers: ["Pub 1"],
      developers: ["Dev 2"],
      releaseDate: "2021-01-01",
      summary: "Summary 2",
      coverUrl: "url2",
    },
    {
      id: "3",
      title: "Game 3",
      status: "wanted",
      rating: null,
      genres: ["RPG"],
      platforms: ["Switch"],
      publishers: ["Pub 2"],
      developers: ["Dev 1"],
      releaseDate: "2022-01-01",
      summary: "Summary 3",
      coverUrl: "url3",
    },
    {
      id: "4",
      title: "Game 4",
      status: "shelved",
      rating: null,
      genres: ["Action"],
      platforms: ["PC"],
      publishers: ["Pub 2"],
      developers: ["Dev 2"],
      releaseDate: "2023-01-01",
      summary: "Summary 4",
      coverUrl: "url4",
    },
  ];

  it("calculates stats correctly for a mixed library", () => {
    const stats = calculateLibraryStats(mockGames);

    expect(stats.totalGames).toBe(4);
    expect(stats.avgRating).toBe("85.0"); // (80 + 90) / 2 — Games 3 & 4 have no rating
    expect(stats.avgUserRating).toBe("7.8"); // (8 + 7.5) / 2
    expect(stats.topGenre?.name).toBe("RPG"); // RPG appears 3×, Action 2×
    expect(stats.topPlatform?.name).toBe("PC"); // PC appears 3×
    expect(stats.topPublisher?.name).toBe("Pub 1");
    expect(stats.uniqueDevelopers).toBe(2);
    expect(stats.avgReleaseYear).toBe(2022); // (2020+2021+2022+2023) / 4 = 2021.5 → 2022
    expect(stats.metadataHealth).toBe(50); // 2 complete out of 4 (Games 3 & 4 have no rating)
    expect(stats.statusBreakdown.wanted).toBe(1);
    expect(stats.statusBreakdown.owned).toBe(1);
    expect(stats.statusBreakdown.shelved).toBe(1);
    expect(stats.statusBreakdown.completed).toBe(1);
    // 1 completed / (1 owned + 1 shelved + 1 completed) ≈ 33%
    expect(stats.completionRate).toBe(33);
  });

  it("statusBreakdown includes shelved: 0 when no shelved games", () => {
    const games: Partial<Game>[] = [
      { id: "1", title: "G1", status: "owned" } as Game,
      { id: "2", title: "G2", status: "completed" } as Game,
    ];
    const stats = calculateLibraryStats(games);
    expect(stats.statusBreakdown.shelved).toBe(0);
  });

  it("handles empty library", () => {
    const stats = calculateLibraryStats([]);
    expect(stats.totalGames).toBe(0);
    expect(stats.avgRating).toBe("N/A");
    expect(stats.avgUserRating).toBe("N/A");
    expect(stats.completionRate).toBe(0);
  });

  it("handles games with missing optional fields", () => {
    const incompleteGames: Partial<Game>[] = [
      {
        id: "1",
        title: "Incomplete",
        status: "wanted",
        genres: undefined,
        platforms: null as unknown as string[],
      } as Game,
    ];
    const stats = calculateLibraryStats(incompleteGames);
    expect(stats.topGenre).toBeNull();
    expect(stats.metadataHealth).toBe(0);
  });

  it("calculates metadata health correctly", () => {
    const games: Partial<Game>[] = [
      {
        title: "Full",
        summary: "S",
        coverUrl: "C",
        releaseDate: "D",
        rating: 10,
        status: "owned",
      } as Game,
      {
        title: "Missing Rating",
        summary: "S",
        coverUrl: "C",
        releaseDate: "D",
        rating: null,
        status: "owned",
      } as Game,
    ];
    const stats = calculateLibraryStats(games as Game[]);
    expect(stats.metadataHealth).toBe(50);
  });

  it("returns N/A for avgUserRating when the library has no user ratings", () => {
    const games: Partial<Game>[] = [
      { id: "1", title: "No Rating 1", status: "owned", userRating: null } as Game,
      { id: "2", title: "No Rating 2", status: "wanted" } as Game,
    ];

    const stats = calculateLibraryStats(games as Game[]);

    expect(stats.avgUserRating).toBe("N/A");
  });

  it("handles invalid release dates in avgReleaseYear", () => {
    const games: Partial<Game>[] = [
      { id: "1", releaseDate: "2020-01-01" },
      { id: "2", releaseDate: "invalid-date" },
      { id: "3", releaseDate: "2022-01-01" },
    ];
    const stats = calculateLibraryStats(games as Game[]);
    expect(stats.avgReleaseYear).toBe(2021); // (2020 + 2022) / 2
  });
});
