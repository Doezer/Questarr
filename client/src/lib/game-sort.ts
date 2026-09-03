import { type Game } from "@shared/schema";

export type LibrarySortOption =
  | "added-desc"
  | "released-desc"
  | "released-asc"
  | "downloadable-desc"
  | "title-asc"
  | "rating-desc";

export const LIBRARY_SORT_OPTIONS: { value: LibrarySortOption; label: string }[] = [
  { value: "added-desc", label: "Recently Added" },
  { value: "released-desc", label: "Recently Released" },
  { value: "downloadable-desc", label: "Recently Downloadable" },
  { value: "released-asc", label: "Release (Oldest)" },
  { value: "rating-desc", label: "Rating (Highest)" },
  { value: "title-asc", label: "Title (A-Z)" },
];

// Missing values always sort to the end, regardless of direction, so games without
// a release date/rating/etc. don't jump to the top of an ascending sort.
export const missingRank = (a: unknown, b: unknown): number | null => {
  const missingA = a === null || a === undefined;
  const missingB = b === null || b === undefined;
  if (missingA && missingB) return 0;
  if (missingA) return 1;
  if (missingB) return -1;
  return null;
};

// `Date` fields are typed as `Date` by the Drizzle schema, but `useQuery` reads them
// straight from a JSON response, so at runtime they are always ISO strings.
const toComparableDateString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

export const compareDates = (
  dateA: Date | string | null | undefined,
  dateB: Date | string | null | undefined,
  asc: boolean
): number => {
  const rank = missingRank(dateA, dateB);
  if (rank !== null) return rank;

  const strA = toComparableDateString(dateA!);
  const strB = toComparableDateString(dateB!);
  if (strA < strB) return asc ? -1 : 1;
  if (strA > strB) return asc ? 1 : -1;
  return 0;
};

const compareNumbers = (
  a: number | null | undefined,
  b: number | null | undefined,
  asc: boolean
): number => {
  const rank = missingRank(a, b);
  if (rank !== null) return rank;
  if (a! < b!) return asc ? -1 : 1;
  if (a! > b!) return asc ? 1 : -1;
  return 0;
};

export function sortLibraryGames(gameList: Game[], sortBy: LibrarySortOption): Game[] {
  const sorted = [...gameList];

  return sorted.sort((a, b) => {
    switch (sortBy) {
      case "added-desc":
        return compareDates(a.addedAt, b.addedAt, false);
      case "released-desc":
        return compareDates(a.releaseDate, b.releaseDate, false);
      case "released-asc":
        return compareDates(a.releaseDate, b.releaseDate, true);
      case "downloadable-desc":
        return compareDates(a.searchResultsAvailableAt, b.searchResultsAvailableAt, false);
      case "rating-desc":
        return compareNumbers(a.userRating, b.userRating, false);
      case "title-asc":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}
