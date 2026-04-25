import { logger } from "./logger.js";
import { safeFetch } from "./ssrf.js";

const hltbLogger = logger.child({ module: "hltb" });

const HLTB_API_URL = "https://howlongtobeat.com/api/search";
const HLTB_BASE_URL = "https://howlongtobeat.com";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_SIMILARITY = 0.4;

export interface HLTBEntry {
  id: number;
  name: string;
  gameplayMain: number;
  gameplayMainExtra: number;
  gameplayCompletionist: number;
  url: string;
}

interface CacheEntry {
  data: HLTBEntry | null;
  expiry: number;
}

interface HLTBSearchResult {
  game_id: number;
  game_name: string;
  comp_main: number;
  comp_plus: number;
  comp_100: number;
}

interface HLTBSearchResponse {
  count: number;
  data: HLTBSearchResult[];
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O(m·n) Levenshtein distance without external dependencies. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    for (let k = 0; k <= n; k++) {
      prev[k] = curr[k];
    }
  }
  return prev[n];
}

function calcSimilarity(text: string, term: string): number {
  const longer = text.length >= term.length ? text : term;
  const shorter = text.length < term.length ? text : term;
  const len = longer.length;
  if (len === 0) return 1;
  const dist = levenshtein(longer, shorter);
  return Math.round(((len - dist) / len) * 100) / 100;
}

class HLTBClient {
  private cache = new Map<string, CacheEntry>();

  async lookup(title: string): Promise<HLTBEntry | null> {
    const key = normalizeTitle(title);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now < cached.expiry) {
      return cached.data;
    }

    const result = await this.fetchBestMatch(title);
    // Only cache definitive "no match" results, not transient network failures
    if (result !== undefined) {
      this.cache.set(key, { data: result, expiry: now + CACHE_TTL_MS });
    }
    return result ?? null;
  }

  /** Returns `null` when no match is found (cacheable), `undefined` on transient errors (not cached). */
  private async fetchBestMatch(title: string): Promise<HLTBEntry | null | undefined> {
    try {
      const searchTerms = title.split(" ").filter(Boolean);
      const body = {
        searchType: "games",
        searchTerms,
        searchPage: 1,
        size: 20,
        searchOptions: {
          games: {
            userId: 0,
            platform: "",
            sortCategory: "popular",
            rangeCategory: "main",
            rangeTime: { min: 0, max: 0 },
            gameplay: { perspective: "", flow: "", genre: "" },
            modifier: "",
          },
          users: { sortCategory: "postcount" },
          filter: "",
          sort: 0,
          randomizer: 0,
        },
      };

      const response = await safeFetch(HLTB_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Honest identifying User-Agent instead of random browser spoofing
          "User-Agent": "Questarr game-manager/1.0 (https://github.com/doezer/questarr)",
          Referer: `${HLTB_BASE_URL}/`,
          Origin: HLTB_BASE_URL,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        hltbLogger.debug({ status: response.status, title }, "HLTB search returned non-200");
        // Transient upstream error — do not cache
        return undefined;
      }

      const json = (await response.json()) as HLTBSearchResponse;
      if (!json.data || json.data.length === 0) return null;

      const normalizedQuery = normalizeTitle(title);
      let best: { entry: HLTBSearchResult; score: number } | null = null;
      for (const entry of json.data) {
        const score = calcSimilarity(normalizeTitle(entry.game_name), normalizedQuery);
        if (!best || score > best.score) {
          best = { entry, score };
        }
      }

      if (!best || best.score < MIN_SIMILARITY) {
        hltbLogger.debug(
          { title, bestScore: best?.score },
          "No sufficiently similar HLTB result found"
        );
        return null;
      }

      const { entry } = best;
      return {
        id: entry.game_id,
        name: entry.game_name,
        gameplayMain: entry.comp_main > 0 ? Math.round(entry.comp_main / 3600) : 0,
        gameplayMainExtra: entry.comp_plus > 0 ? Math.round(entry.comp_plus / 3600) : 0,
        gameplayCompletionist: entry.comp_100 > 0 ? Math.round(entry.comp_100 / 3600) : 0,
        url: `${HLTB_BASE_URL}/game/${entry.game_id}`,
      };
    } catch (error) {
      hltbLogger.debug({ error, title }, "HLTB lookup failed");
      // Network/parse error — do not cache so it can be retried
      return undefined;
    }
  }
}

export const hltbClient = new HLTBClient();
