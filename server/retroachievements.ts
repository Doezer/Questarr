import { safeFetch } from "./ssrf.js";
import { matchByTitleAndPlatform, squash } from "./achievement-matching.js";

/**
 * RetroAchievements Web API client and the matching of its games to the library.
 *
 * One call (`API_GetUserCompletionProgress`) lists every game the user has progress in, with the
 * unlocked and total achievement counts, so a sync needs a few paged requests whatever the size
 * of the library. The API key travels in the URL, so errors never carry the request URL.
 */

const API_BASE = "https://retroachievements.org/API";
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

export class RetroAchievementsAuthError extends Error {
  constructor() {
    super("RetroAchievements rejected the username or Web API key.");
  }
}

export class RetroAchievementsRequestError extends Error {}

export interface RetroAchievementsGame {
  gameId: number;
  title: string;
  consoleName: string;
  total: number;
  unlocked: number;
  lastUnlockedAt: Date | null;
}

interface CompletionProgressResponse {
  Count?: number;
  Total?: number;
  Results?: {
    GameID?: number;
    Title?: string;
    ConsoleName?: string;
    MaxPossible?: number;
    NumAwarded?: number;
    MostRecentAwardedDate?: string | null;
  }[];
}

/**
 * RetroAchievements dates are UTC, either without a zone ("2024-05-01 12:00:00") or with an
 * offset ("2023-10-27T02:52:34+00:00"). A value that already has a zone is read as it is.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const date = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchPage(
  username: string,
  apiKey: string,
  offset: number,
  count: number
): Promise<CompletionProgressResponse> {
  const params = new URLSearchParams({
    z: username,
    y: apiKey,
    u: username,
    c: String(count),
    o: String(offset),
  });
  let response: Response;
  try {
    response = await safeFetch(`${API_BASE}/API_GetUserCompletionProgress.php?${params}`, {
      requireHttps: true,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new RetroAchievementsRequestError("Could not reach RetroAchievements.");
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new RetroAchievementsAuthError();
  }
  if (!response.ok) {
    throw new RetroAchievementsRequestError(`RetroAchievements answered ${response.status}.`);
  }
  try {
    return (await response.json()) as CompletionProgressResponse;
  } catch {
    throw new RetroAchievementsRequestError("RetroAchievements sent an unreadable answer.");
  }
}

/**
 * Check a username and Web API key. The completion endpoint answers 200 with an empty list for an
 * unknown username, the same as for an account without progress, so the profile endpoint confirms
 * the account exists.
 */
export async function verifyRetroAchievementsCredentials(
  username: string,
  apiKey: string
): Promise<void> {
  await fetchPage(username, apiKey, 0, 1);
  const params = new URLSearchParams({ z: username, y: apiKey, u: username });
  let response: Response;
  try {
    response = await safeFetch(`${API_BASE}/API_GetUserProfile.php?${params}`, {
      requireHttps: true,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new RetroAchievementsRequestError("Could not reach RetroAchievements.");
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new RetroAchievementsAuthError();
  }
  if (!response.ok) {
    throw new RetroAchievementsRequestError(`RetroAchievements answered ${response.status}.`);
  }
  let profile: { User?: unknown; ID?: unknown } | null;
  try {
    profile = (await response.json()) as { User?: unknown; ID?: unknown } | null;
  } catch {
    throw new RetroAchievementsRequestError("RetroAchievements sent an unreadable answer.");
  }
  if (typeof profile?.User !== "string" || profile.User.length === 0) {
    throw new RetroAchievementsAuthError();
  }
}

/** Every game the user has progress in (games without any unlocked achievement included). */
export async function fetchRetroAchievementsProgress(
  username: string,
  apiKey: string
): Promise<RetroAchievementsGame[]> {
  const games: RetroAchievementsGame[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(username, apiKey, page * PAGE_SIZE, PAGE_SIZE);
    const results = data.Results ?? [];
    for (const r of results) {
      if (!r.GameID || !r.Title || !r.ConsoleName || !r.MaxPossible) continue;
      games.push({
        gameId: r.GameID,
        title: r.Title,
        consoleName: r.ConsoleName,
        total: r.MaxPossible,
        unlocked: Math.min(r.NumAwarded ?? 0, r.MaxPossible),
        lastUnlockedAt: parseDate(r.MostRecentAwardedDate),
      });
    }
    if (results.length < PAGE_SIZE || games.length >= (data.Total ?? Infinity)) break;
  }
  return games;
}

/**
 * RetroAchievements console name -> IGDB platform names. A console that is not listed is matched
 * on its own name.
 */
const CONSOLE_ALIASES: Record<string, string[]> = {
  "NES/Famicom": ["Nintendo Entertainment System", "Famicom", "Family Computer"],
  "SNES/Super Famicom": ["Super Nintendo Entertainment System", "Super Famicom", "Super NES"],
  "Game Boy": ["Game Boy"],
  "Game Boy Color": ["Game Boy Color"],
  "Game Boy Advance": ["Game Boy Advance"],
  "Nintendo 64": ["Nintendo 64"],
  "Nintendo DS": ["Nintendo DS"],
  "Virtual Boy": ["Virtual Boy"],
  "Pokemon Mini": ["Pokémon mini", "Pokemon mini"],
  "Mega Drive": ["Sega Mega Drive/Genesis", "Sega Genesis", "Sega Mega Drive", "Genesis"],
  "Mega Drive / Genesis": ["Sega Mega Drive/Genesis", "Sega Genesis", "Sega Mega Drive", "Genesis"],
  "Master System": ["Sega Master System/Mark III", "Sega Master System"],
  "Game Gear": ["Sega Game Gear"],
  "Sega CD": ["Sega CD", "Mega-CD"],
  "Sega Saturn": ["Sega Saturn"],
  "32X": ["Sega 32X"],
  Dreamcast: ["Dreamcast"],
  PlayStation: ["PlayStation"],
  "PlayStation 2": ["PlayStation 2"],
  "PlayStation Portable": ["PlayStation Portable"],
  "PC Engine/TurboGrafx-16": ["TurboGrafx-16/PC Engine", "PC Engine", "TurboGrafx-16"],
  "PC Engine CD/TurboGrafx-CD": ["TurboGrafx-CD/PC Engine CD", "PC Engine CD"],
  "Neo Geo CD": ["Neo Geo CD"],
  "Neo Geo Pocket": ["Neo Geo Pocket", "Neo Geo Pocket Color"],
  "Atari 2600": ["Atari 2600"],
  "Atari 7800": ["Atari 7800"],
  "Atari Lynx": ["Atari Lynx"],
  "Atari Jaguar": ["Atari Jaguar"],
  WonderSwan: ["WonderSwan", "WonderSwan Color"],
  "3DO Interactive Multiplayer": ["3DO Interactive Multiplayer"],
  Arcade: ["Arcade"],
};

const ALIASES_BY_CONSOLE = new Map(
  Object.entries(CONSOLE_ALIASES).map(([name, aliases]) => [
    squash(name),
    new Set(aliases.map(squash)),
  ])
);

/** The library game is on the console RetroAchievements lists the game for. */
export function consoleMatchesPlatforms(consoleName: string, platforms: string[]): boolean {
  const key = squash(consoleName);
  const accepted = ALIASES_BY_CONSOLE.get(key) ?? new Set([key]);
  return platforms.some((p) => accepted.has(squash(p)));
}

/** Hacks, homebrew and subsets are not the game itself. */
const isOfficialSet = (title: string) => !/(?:^~)|(?:\[Subset)/i.test(title);

/**
 * The RetroAchievements game of a library game: same title and the same console as its target
 * platform (or one of its platforms when no target platform is set).
 * When several sets match (regional releases), the one with the most progress wins.
 */
export function matchRetroAchievementsGame(
  game: { title: string; platforms: string[] | null; targetPlatformName?: string | null },
  candidates: RetroAchievementsGame[]
): RetroAchievementsGame | null {
  return matchByTitleAndPlatform(
    game,
    candidates,
    (c, platforms) => consoleMatchesPlatforms(c.consoleName, platforms),
    (c) => isOfficialSet(c.title)
  );
}
