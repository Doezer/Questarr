import { type Game } from "@shared/schema";

export interface LibraryStats {
  totalGames: number;
  avgRating: string;
  avgUserRating: string;
  topGenre: { name: string; count: number } | null;
  topPlatform: { name: string; count: number } | null;
  topPublisher: { name: string; count: number } | null;
  uniqueDevelopers: number;
  avgReleaseYear: string | number;
  metadataHealth: number;
  statusBreakdown: {
    wanted: number;
    owned: number;
    shelved: number;
    completed: number;
    downloading: number;
  };
  completionRate: number;
}

export function calculateLibraryStats(games: Game[]): LibraryStats {
  const totalGames = games.length;

  if (totalGames === 0) {
    return {
      totalGames: 0,
      avgRating: "N/A",
      avgUserRating: "N/A",
      topGenre: null,
      topPlatform: null,
      topPublisher: null,
      uniqueDevelopers: 0,
      avgReleaseYear: "N/A",
      metadataHealth: 0,
      statusBreakdown: {
        wanted: 0,
        owned: 0,
        shelved: 0,
        completed: 0,
        downloading: 0,
      },
      completionRate: 0,
    };
  }

  // ⚡ Bolt: Consolidate multiple O(N) array traversals (filter, map, reduce, flatMap)
  // into a single manual loop to prevent redundant iteration and allocations during React renders.
  let ratingSum = 0;
  let ratedCount = 0;
  let userRatingSum = 0;
  let userRatedCount = 0;

  const genreCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  const publisherCounts: Record<string, number> = {};
  const uniqueDevelopers = new Set<string>();

  let yearSum = 0;
  let yearCount = 0;
  let completeGamesCount = 0;

  const statusBreakdown = {
    wanted: 0,
    owned: 0,
    shelved: 0,
    completed: 0,
    downloading: 0,
  };

  for (let i = 0; i < games.length; i++) {
    const g = games[i];

    if (g.rating !== null && g.rating !== undefined) {
      ratingSum += g.rating;
      ratedCount++;
    }
    if (g.userRating !== null && g.userRating !== undefined) {
      userRatingSum += g.userRating;
      userRatedCount++;
    }

    if (g.genres) {
      for (let j = 0; j < g.genres.length; j++) {
        const genre = g.genres[j];
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      }
    }
    if (g.platforms) {
      for (let j = 0; j < g.platforms.length; j++) {
        const platform = g.platforms[j];
        platformCounts[platform] = (platformCounts[platform] || 0) + 1;
      }
    }
    if (g.publishers) {
      for (let j = 0; j < g.publishers.length; j++) {
        const publisher = g.publishers[j];
        publisherCounts[publisher] = (publisherCounts[publisher] || 0) + 1;
      }
    }
    if (g.developers) {
      for (let j = 0; j < g.developers.length; j++) {
        uniqueDevelopers.add(g.developers[j]);
      }
    }

    if (g.releaseDate) {
      // ⚡ Bolt: Use fast string prefix parsing instead of slow new Date() allocation
      const year = parseInt(g.releaseDate.substring(0, 4), 10);
      if (!Number.isNaN(year)) {
        yearSum += year;
        yearCount++;
      }
    }

    if (g.title && g.summary && g.coverUrl && g.releaseDate && g.rating !== null) {
      completeGamesCount++;
    }

    if (g.status === "wanted") statusBreakdown.wanted++;
    else if (g.status === "owned") statusBreakdown.owned++;
    else if (g.status === "shelved") statusBreakdown.shelved++;
    else if (g.status === "completed") statusBreakdown.completed++;
    else if (g.status === "downloading") statusBreakdown.downloading++;
  }

  const avgRating = ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : "N/A";
  const avgUserRating = userRatedCount > 0 ? (userRatingSum / userRatedCount).toFixed(1) : "N/A";

  const getTopItemFromCounts = (counts: Record<string, number>) => {
    const entries = Object.entries(counts);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { name: entries[0][0], count: entries[0][1] };
  };

  const topGenre = getTopItemFromCounts(genreCounts);
  const topPlatform = getTopItemFromCounts(platformCounts);
  const topPublisher = getTopItemFromCounts(publisherCounts);

  const avgReleaseYear = yearCount > 0 ? Math.round(yearSum / yearCount) : "N/A";
  const metadataHealth = Math.round((completeGamesCount / totalGames) * 100);

  // Completion Rate: % of acquired games (owned + shelved + completed) that are completed
  const acquiredCount = statusBreakdown.owned + statusBreakdown.shelved + statusBreakdown.completed;
  const completionRate =
    acquiredCount > 0 ? Math.round((statusBreakdown.completed / acquiredCount) * 100) : 0;

  return {
    totalGames,
    avgRating,
    avgUserRating,
    topGenre,
    topPlatform,
    topPublisher,
    uniqueDevelopers: uniqueDevelopers.size,
    avgReleaseYear,
    metadataHealth,
    statusBreakdown,
    completionRate,
  };
}
