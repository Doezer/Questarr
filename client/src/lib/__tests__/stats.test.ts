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
  ];

  it("calculates stats correctly for a mixed library", () => {
    const stats = calculateLibraryStats(mockGames as Game[]);

    expect(stats.totalGames).toBe(3);
    expect(stats.avgRating).toBe("85.0"); // (80 + 90) / 2
    expect(stats.topGenre?.name).toBe("RPG");

    expect(stats.topPlatform?.name).toBe("PC");
    expect(stats.topPublisher?.name).toBe("Pub 1");
    expect(stats.uniqueDevelopers).toBe(2);
    expect(stats.avgReleaseYear).toBe(2021);
    expect(stats.metadataHealth).toBe(67); // 2 out of 3 (Game 3 has no rating)
    expect(stats.statusBreakdown.wanted).toBe(1);
    expect(stats.statusBreakdown.owned).toBe(1);
    expect(stats.statusBreakdown.completed).toBe(1);
    expect(stats.completionRate).toBe(50); // 1 completed / 2 owned (owned + completed)
  });

  it("handles empty library", () => {
    const stats = calculateLibraryStats([]);
    expect(stats.totalGames).toBe(0);
    expect(stats.avgRating).toBe("N/A");
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
    const stats = calculateLibraryStats(incompleteGames as Game[]);
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
