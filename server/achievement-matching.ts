/** Lowercase letters and digits only, so "Sega Mega Drive/Genesis" and "sega-mega-drive genesis" meet. */
export const squash = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");

/** Region and disc markers of a release name; any other parenthetical (an edition) stays in the key. */
const RELEASE_TAGS = new Set([
  "usa",
  "europe",
  "japan",
  "world",
  "korea",
  "asia",
  "australia",
  "brazil",
  "canada",
  "china",
  "france",
  "germany",
  "italy",
  "netherlands",
  "russia",
  "spain",
  "sweden",
  "taiwan",
  "uk",
  "en",
  "fr",
  "de",
  "es",
  "it",
  "ja",
  "nl",
  "pt",
  "sv",
]);
const isReleaseTag = (tag: string) => {
  const t = tag.trim().toLowerCase();
  return RELEASE_TAGS.has(t) || /^(?:disc|cd) ?\d+$/.test(t);
};

/** Titles with region tags and alternative names reduced to comparable keys. */
export function titleKeys(title: string): string[] {
  return title
    .split(/\s+\|\s+/)
    .map((part) =>
      part
        .normalize("NFD")
        .replaceAll(/[̀-ͯ]/g, "") // Pokémon and Pokemon are the same title
        .replaceAll(/[™®©]/g, " ")
        .replaceAll(/\(([^()]*)\)/g, (_m, inner: string) =>
          inner.split(",").every(isReleaseTag) ? " " : ` ${inner} `
        )
        .toLowerCase()
        // Letters and digits of every script: 大神 is a title, not punctuation.
        .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
        .replaceAll(/\s+/g, " ")
        .trim()
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
