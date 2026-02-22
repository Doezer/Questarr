import { type Game } from "@shared/schema";

export interface LibraryStats {
  totalGames: number;
  avgRating: string;
  topGenre: { name: string; count: number } | null;
  topPlatform: { name: string; count: number } | null;
  topPublisher: { name: string; count: number } | null;
  uniqueDevelopers: number;
  avgReleaseYear: string | number;
  metadataHealth: number;
  statusBreakdown: {
    wanted: number;
    owned: number;
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
      topGenre: null,
      topPlatform: null,
      topPublisher: null,
      uniqueDevelopers: 0,
      avgReleaseYear: "N/A",
      metadataHealth: 0,
      statusBreakdown: {
        wanted: 0,
        owned: 0,
        completed: 0,
        downloading: 0,
      },
      completionRate: 0,
    };
  }

  // Avg Rating
  const ratedGames = games.filter((g) => g.rating !== null && g.rating !== undefined);
  const avgRating =
    ratedGames.length > 0
      ? (ratedGames.reduce((acc, g) => acc + (g.rating || 0), 0) / ratedGames.length).toFixed(1)
      : "N/A";

  // Counts Helper
  const getTopItem = (items: string[]) => {
    if (items.length === 0) return null;
    const counts: Record<string, number> = {};
    items.forEach((item) => (counts[item] = (counts[item] || 0) + 1));
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { name: sorted[0][0], count: sorted[0][1] };
  };

  const topGenre = getTopItem(games.flatMap((g) => g.genres || []));
  const topPlatform = getTopItem(games.flatMap((g) => g.platforms || []));
  const topPublisher = getTopItem(games.flatMap((g) => g.publishers || []));

  // Unique Developers
  const uniqueDevelopers = new Set(games.flatMap((g) => g.developers || [])).size;

  // Avg Release Year
  const years = games
    .map((g) => (g.releaseDate ? new Date(g.releaseDate).getFullYear() : NaN))
    .filter((year) => !isNaN(year));
  const avgReleaseYear =
    years.length > 0
      ? Math.round(years.reduce((acc, year) => acc + year, 0) / years.length)
      : "N/A";

  // Metadata Completeness (title, summary, cover, releaseDate, rating)
  const completeGamesCount = games.filter(
    (g) => g.title && g.summary && g.coverUrl && g.releaseDate && g.rating !== null
  ).length;
  const metadataHealth = Math.round((completeGamesCount / totalGames) * 100);

  // Status Breakdown
  const statusBreakdown = {
    wanted: 0,
    owned: 0,
    completed: 0,
    downloading: 0,
  };

  games.forEach((g) => {
    if (g.status === "wanted") statusBreakdown.wanted++;
    else if (g.status === "owned") statusBreakdown.owned++;
    else if (g.status === "completed") statusBreakdown.completed++;
    else if (g.status === "downloading") statusBreakdown.downloading++;
  });

  // Completion Rate: % of owned games that are completed
  const ownedCount = statusBreakdown.owned + statusBreakdown.completed;
  const completionRate =
    ownedCount > 0 ? Math.round((statusBreakdown.completed / ownedCount) * 100) : 0;

  return {
    totalGames,
    avgRating,
    topGenre,
    topPlatform,
    topPublisher,
    uniqueDevelopers,
    avgReleaseYear,
    metadataHealth,
    statusBreakdown,
    completionRate,
  };
}
