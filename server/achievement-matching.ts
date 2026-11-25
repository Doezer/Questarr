import { normalizeTitle } from "../shared/title-utils.js";

/** Lowercase letters and digits only, so "Sega Mega Drive/Genesis" and "sega-mega-drive genesis" meet. */
export const squash = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");

/** Titles with region tags and alternative names reduced to comparable keys. */
export function titleKeys(title: string): string[] {
  return title
    .split(/\s+\|\s+/)
    .map((part) =>
      normalizeTitle(
        part
          .normalize("NFD")
          .replaceAll(/[̀-ͯ]/g, "") // Pokémon and Pokemon are the same title
          .replaceAll(/[™®©]/g, " ")
          .replaceAll(/\([^)]*\)/g, " ")
      )
    )
    .filter(Boolean);
}

/**
 * The platforms a library game counts for: its target platform alone when one is set (the copy the
 * user owns), otherwise the platforms IGDB lists for it.
 */
export function libraryPlatforms(game: {
  platforms: string[] | null;
  targetPlatformName?: string | null;
}): string[] {
  return game.targetPlatformName ? [game.targetPlatformName] : (game.platforms ?? []);
}

/**
 * The candidate that is the same game as the library game: same title and a platform of the
 * library copy. When several candidates match (regional releases, a PS4 and a PS5 set), the one
 * with the most unlocked achievements wins.
 */
export function matchByTitleAndPlatform<T extends { title: string; unlocked: number }>(
  game: { title: string; platforms: string[] | null; targetPlatformName?: string | null },
  candidates: T[],
  onPlatform: (candidate: T, platforms: string[]) => boolean,
  accept: (candidate: T) => boolean = () => true
): T | null {
  const platforms = libraryPlatforms(game);
  if (platforms.length === 0) return null;
  const wanted = new Set(titleKeys(game.title));
  let best: T | null = null;
  for (const c of candidates) {
    if (!accept(c) || !onPlatform(c, platforms)) continue;
    if (!titleKeys(c.title).some((key) => wanted.has(key))) continue;
    if (!best || c.unlocked > best.unlocked) best = c;
  }
  return best;
}
