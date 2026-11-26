import { safeFetch } from "./ssrf.js";
import { matchByTitleAndPlatform, squash } from "./achievement-matching.js";

/**
 * PlayStation Network trophy client and the matching of its trophy lists to the library.
 *
 * PlayStation has no public API for trophies. This follows the sign-in the PlayStation mobile app
 * uses (the same one the `psn-api` library implements): the user's NPSSO cookie value is exchanged
 * for an access code, then for a short-lived access token, and the token reads the trophy titles
 * of the account. The NPSSO token is a session secret: it is stored encrypted, travels in a
 * request header only, and never appears in an error message. Sony can change this sign-in
 * without notice, which shows up as a refused token.
 */

const AUTH_BASE = "https://ca.account.sony.com/api/authz/v3/oauth";
const TROPHY_BASE = "https://m.np.playstation.com/api/trophy/v1";
// Public identifiers of the PlayStation mobile app, not secrets of this project.
const CLIENT_ID = "09515159-7237-4370-9b40-3806e67c0891";
const CLIENT_BASIC_AUTH =
  "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const REDIRECT_URI = "com.scee.psxandroid.scecompcall://redirect";
const SCOPE = "psn:mobile.v2.core psn:clientapp";
const PAGE_SIZE = 800;
const MAX_PAGES = 10;

export class PsnAuthError extends Error {
  constructor() {
    super("PlayStation refused the NPSSO token. Sign in to PlayStation again and copy a new one.");
  }
}

export class PsnRequestError extends Error {}

export interface PsnTrophyTitle {
  /** `npCommunicationId`: one trophy set. */
  id: string;
  title: string;
  /** "PS5", "PS4", "PS3", "PSVITA" or "PSPC". A set can list several, separated by commas. */
  platforms: string[];
  total: number;
  unlocked: number;
  lastUpdatedAt: Date | null;
}

interface TrophyCounts {
  bronze?: number;
  silver?: number;
  gold?: number;
  platinum?: number;
}

interface TrophyTitlesResponse {
  trophyTitles?: {
    npCommunicationId?: string;
    trophyTitleName?: string;
    trophyTitlePlatform?: string;
    definedTrophies?: TrophyCounts;
    earnedTrophies?: TrophyCounts;
    lastUpdatedDateTime?: string;
  }[];
  nextOffset?: number;
  totalItemCount?: number;
}

const sumTrophies = (counts: TrophyCounts | undefined) =>
  (counts?.bronze ?? 0) + (counts?.silver ?? 0) + (counts?.gold ?? 0) + (counts?.platinum ?? 0);

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await safeFetch(url, { requireHttps: true, redirect: "error", ...init });
  } catch {
    // The error text can carry the request: say only that PlayStation could not be reached.
    throw new PsnRequestError("Could not reach PlayStation.");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new PsnRequestError("PlayStation sent an unreadable answer.");
  }
}

function checkStatus(response: Response): void {
  if (response.status === 401 || response.status === 403) throw new PsnAuthError();
  if (!response.ok) throw new PsnRequestError(`PlayStation answered ${response.status}.`);
}

/** Exchange the NPSSO token for an access token. */
async function getAccessToken(npsso: string): Promise<string> {
  const authorize = new URLSearchParams({
    access_type: "offline",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
  });
  // The answer is a redirect to the app's own scheme with the code in its query string.
  let response: Response;
  try {
    response = await safeFetch(`${AUTH_BASE}/authorize?${authorize}`, {
      requireHttps: true,
      redirect: "manual",
      headers: { Cookie: `npsso=${npsso}` },
    });
  } catch {
    throw new PsnRequestError("Could not reach PlayStation.");
  }
  const location = response.headers.get("location") ?? "";
  const code = /[?&]code=([^&]+)/.exec(location)?.[1];
  if (!code) {
    if (response.status >= 500)
      throw new PsnRequestError(`PlayStation answered ${response.status}.`);
    throw new PsnAuthError();
  }

  const tokenResponse = await call(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: CLIENT_BASIC_AUTH,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code: decodeURIComponent(code),
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      token_format: "jwt",
    }).toString(),
  });
  if (tokenResponse.status === 400 || tokenResponse.status === 401) throw new PsnAuthError();
  checkStatus(tokenResponse);
  const token = await readJson<{ access_token?: unknown }>(tokenResponse);
  if (typeof token.access_token !== "string" || !token.access_token) throw new PsnAuthError();
  return token.access_token;
}

async function getJson<T>(accessToken: string, path: string): Promise<T> {
  const response = await call(`${TROPHY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  checkStatus(response);
  return readJson<T>(response);
}

/**
 * Check an NPSSO token and return the PlayStation account id it belongs to. The trophy summary
 * answers for the signed-in account, so an account without any trophy still verifies.
 */
export async function verifyPsnToken(npsso: string): Promise<string> {
  const accessToken = await getAccessToken(npsso);
  const summary = await getJson<{ accountId?: unknown }>(accessToken, "/users/me/trophySummary");
  if (typeof summary.accountId !== "string" || !summary.accountId) throw new PsnAuthError();
  return summary.accountId;
}

/** Every trophy set the account has earned at least one trophy in (sets with no trophy are listed too). */
export async function fetchPsnTrophyTitles(npsso: string): Promise<PsnTrophyTitle[]> {
  const accessToken = await getAccessToken(npsso);
  const titles: PsnTrophyTitle[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await getJson<TrophyTitlesResponse>(
      accessToken,
      `/users/me/trophyTitles?limit=${PAGE_SIZE}&offset=${offset}`
    );
    const results = data.trophyTitles ?? [];
    // Sets that come without trophy counts mean the answer is not shaped as expected: report it
    // instead of reading it as "no progress", which would erase the stored progress.
    if (results.some((t) => !t.definedTrophies || !t.earnedTrophies)) {
      throw new PsnRequestError("PlayStation sent an unreadable answer.");
    }
    for (const t of results) {
      const total = sumTrophies(t.definedTrophies);
      if (!t.npCommunicationId || !t.trophyTitleName || total === 0) continue;
      const updated = t.lastUpdatedDateTime ? new Date(t.lastUpdatedDateTime) : null;
      titles.push({
        id: t.npCommunicationId,
        // Some older sets are named "<game> Trophies".
        title: t.trophyTitleName.replace(/\s+(?:trophies|trophy set)$/i, ""),
        platforms: (t.trophyTitlePlatform ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        total,
        unlocked: Math.min(sumTrophies(t.earnedTrophies), total),
        lastUpdatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
      });
    }
    if (data.nextOffset === undefined || results.length === 0) break;
    offset = data.nextOffset;
  }
  return titles;
}

/** PlayStation platform code -> the IGDB platform names of the library. */
const PLATFORM_ALIASES: Record<string, string[]> = {
  PS5: ["PlayStation 5"],
  PS4: ["PlayStation 4"],
  PS3: ["PlayStation 3"],
  PSVITA: ["PlayStation Vita"],
  PSPC: ["PC (Microsoft Windows)"],
};

/** The library copy is on one of the platforms of the trophy set. */
export function psnPlatformMatches(set: PsnTrophyTitle, platforms: string[]): boolean {
  const accepted = new Set(
    set.platforms.flatMap((p) => PLATFORM_ALIASES[p.toUpperCase()] ?? []).map(squash)
  );
  return platforms.some((p) => accepted.has(squash(p)));
}

/**
 * The trophy set of a library game: same title and a platform of the library copy (its target
 * platform, or its platform list when none is chosen). A game with a PS4 and a PS5 set takes the
 * one with the most trophies earned.
 */
export function matchPsnGame(
  game: { title: string; platforms: string[] | null; targetPlatformName?: string | null },
  candidates: PsnTrophyTitle[]
): PsnTrophyTitle | null {
  return matchByTitleAndPlatform(game, candidates, psnPlatformMatches);
}
