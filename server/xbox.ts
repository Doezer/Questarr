import { safeFetch } from "./ssrf.js";
import { matchByTitleAndPlatform, squash } from "./achievement-matching.js";

/**
 * Xbox achievements through OpenXBL (https://xbl.io), a third-party Xbox Live API with a free
 * key. The user signs in to OpenXBL with their Microsoft account and pastes the key; the key is
 * stored encrypted, travels in a request header only, and never appears in an error message.
 * One call lists every title with its unlocked and total achievement counts.
 *
 * OpenXBL is a service of its own: its free tier is rate limited (150 requests an hour), and an
 * answer shaped differently than expected is reported as an unreadable answer instead of being
 * guessed at.
 */

const API_BASE = "https://xbl.io/api/v2";
const MAX_PAGES = 10;

export class XboxAuthError extends Error {
  constructor() {
    super("OpenXBL refused the API key. Check the key in your OpenXBL account.");
  }
}

export class XboxRequestError extends Error {}

export interface XboxTitle {
  titleId: string;
  title: string;
  /** "Xbox360", "XboxOne", "XboxSeries", "PC"... */
  devices: string[];
  total: number;
  unlocked: number;
  lastPlayedAt: Date | null;
}

interface AccountResponse {
  profileUsers?: { id?: string; settings?: { id?: string; value?: string }[] }[];
}

interface AchievementsResponse {
  titles?: {
    titleId?: string | number;
    name?: string;
    devices?: string[];
    achievement?: { currentAchievements?: number; totalAchievements?: number };
    titleHistory?: { lastTimePlayed?: string | null };
  }[];
  pagingInfo?: { continuationToken?: string | null };
}

async function getJson<T>(apiKey: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await safeFetch(`${API_BASE}${path}`, {
      requireHttps: true,
      redirect: "error",
      headers: { "X-Authorization": apiKey, Accept: "application/json" },
    });
  } catch {
    // The error text can carry the request: say only that OpenXBL could not be reached.
    throw new XboxRequestError("Could not reach OpenXBL.");
  }
  if (response.status === 401 || response.status === 403) throw new XboxAuthError();
  if (response.status === 429) {
    throw new XboxRequestError("OpenXBL rate limit reached. Try again later.");
  }
  if (!response.ok) throw new XboxRequestError(`OpenXBL answered ${response.status}.`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new XboxRequestError("OpenXBL sent an unreadable answer.");
  }
}

/**
 * Check an OpenXBL key and return the account it belongs to: the gamertag, or the account id when
 * the answer has no gamertag. A key whose account cannot be told apart from another is refused,
 * because a switch of account would go unnoticed and keep the old progress.
 */
export async function verifyXboxKey(apiKey: string): Promise<{
  username: string;
  accountId?: string;
}> {
  const account = await getJson<AccountResponse>(apiKey, "/account");
  const user = account.profileUsers?.[0];
  const gamertag = user?.settings?.find((s) => s.id?.toLowerCase() === "gamertag")?.value?.trim();
  // The XUID is what stays when the gamertag is renamed.
  if (gamertag) return { username: gamertag, ...(user?.id ? { accountId: String(user.id) } : {}) };
  if (user?.id) return { username: `Xbox ${user.id}`, accountId: String(user.id) };
  throw new XboxRequestError("OpenXBL did not say which account the key belongs to.");
}

/** Every title the account has played, with its achievement counts (titles without any are left out). */
export async function fetchXboxTitles(apiKey: string): Promise<XboxTitle[]> {
  const titles: XboxTitle[] = [];
  let token: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = token ? `?continuationToken=${encodeURIComponent(token)}` : "";
    const data = await getJson<AchievementsResponse>(apiKey, `/achievements${query}`);
    const rawTitles = data.titles ?? [];
    // Titles that come without achievement counts mean the answer is not shaped as expected: report
    // it instead of reading it as "no progress", which would erase the stored progress.
    if (
      rawTitles.some(
        (t) =>
          typeof t.achievement?.totalAchievements !== "number" ||
          typeof t.achievement.currentAchievements !== "number"
      )
    ) {
      throw new XboxRequestError("OpenXBL sent an unreadable answer.");
    }
    for (const t of rawTitles) {
      const total = t.achievement?.totalAchievements ?? 0;
      if (t.titleId === undefined || !t.name || total <= 0) continue;
      const played = t.titleHistory?.lastTimePlayed
        ? new Date(t.titleHistory.lastTimePlayed)
        : null;
      titles.push({
        titleId: String(t.titleId),
        title: t.name,
        devices: t.devices ?? [],
        total,
        unlocked: Math.min(t.achievement?.currentAchievements ?? 0, total),
        lastPlayedAt: played && !Number.isNaN(played.getTime()) ? played : null,
      });
    }
    token = data.pagingInfo?.continuationToken;
    if (!token) break;
  }
  return titles;
}

/** Xbox device name -> the IGDB platform names of the library. */
const DEVICE_ALIASES: Record<string, string[]> = {
  xbox360: ["Xbox 360"],
  xboxone: ["Xbox One"],
  xboxseries: ["Xbox Series X|S"],
  pc: ["PC (Microsoft Windows)"],
  win32: ["PC (Microsoft Windows)"],
};

/** The library copy is on one of the devices of the title. */
export function xboxPlatformMatches(title: XboxTitle, platforms: string[]): boolean {
  const accepted = new Set(
    title.devices.flatMap((d) => DEVICE_ALIASES[squash(d)] ?? []).map(squash)
  );
  return platforms.some((p) => accepted.has(squash(p)));
}

/**
 * The Xbox title of a library game: same title and a device of the library copy (its target
 * platform, or its platform list when none is chosen).
 */
export function matchXboxGame(
  game: { title: string; platforms: string[] | null; targetPlatformName?: string | null },
  candidates: XboxTitle[]
): XboxTitle | null {
  return matchByTitleAndPlatform(game, candidates, xboxPlatformMatches);
}
