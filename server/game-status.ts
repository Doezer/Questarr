/**
 * IGDB hands back a release date but no "has it shipped yet" flag, and the
 * schema defaults new games to "upcoming". Stamp anything already released so
 * the calendar and library filters classify it correctly from the start.
 */
export const normalizeInitialReleaseStatus = <
  T extends { releaseDate?: string | null; releaseStatus?: string | null },
>(
  gameData: T
): T => {
  const releaseDate = gameData.releaseDate?.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) && releaseDate <= today) {
    return { ...gameData, releaseStatus: "released" };
  }
  return gameData;
};
