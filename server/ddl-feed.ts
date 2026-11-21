import { extractHosterLinks } from "../shared/ddl-links.js";
import { safeFetch } from "./ssrf.js";
import { logger } from "./logger.js";

const ddlFeedLogger = logger.child({ module: "ddl-feed" });

const HOSTS_URL = "https://api.real-debrid.com/rest/1.0/hosts/domains";
const HOSTS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const HOSTS_TIMEOUT_MS = 5000;

let supportedHosts: { at: number; domains: string[] } | null = null;
let failedAt = 0;
let inflight: Promise<string[] | null> | null = null;

/**
 * Domains Real-Debrid unrestricts (public endpoint, cached). Null when it cannot be read: a
 * failure is remembered for a few minutes and concurrent callers share one request, so an outage
 * costs one short wait per refresh instead of one per feed item.
 */
async function loadSupportedDomains(): Promise<string[] | null> {
  if (supportedHosts && Date.now() - supportedHosts.at < HOSTS_TTL_MS) {
    return supportedHosts.domains;
  }
  if (Date.now() - failedAt < FAILURE_TTL_MS) return supportedHosts?.domains ?? null;
  inflight ??= (async () => {
    try {
      const response = await safeFetch(HOSTS_URL, { timeoutMs: HOSTS_TIMEOUT_MS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const domains = ((await response.json()) as unknown[])
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.toLowerCase());
      supportedHosts = { at: Date.now(), domains };
      return domains;
    } catch (error) {
      failedAt = Date.now();
      ddlFeedLogger.warn({ error }, "Could not load the Real-Debrid host list");
      return supportedHosts?.domains ?? null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const hostMatches = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** The text fields of a parsed feed item that may carry hoster links. */
function itemText(item: Record<string, unknown>): string {
  return ["content:encoded", "content", "summary", "description", "contentSnippet"]
    .map((key) => item[key])
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

/**
 * Hoster links found in a feed item: the blog's own pages (the feed host and the item link) are
 * left out and so is everything Real-Debrid cannot unrestrict. Returns null when its host list is
 * unreachable: the caller then stores nothing, so the item is tried again on the next refresh
 * instead of keeping unfiltered links.
 */
export async function extractItemLinks(
  item: Record<string, unknown>,
  feedUrl: string,
  itemLink: string
): Promise<string[] | null> {
  const own = new Set<string>();
  for (const url of [feedUrl, itemLink]) {
    try {
      own.add(new URL(url).hostname.toLowerCase());
    } catch {
      // not a URL: nothing to exclude
    }
  }
  const candidates = extractHosterLinks(itemText(item)).filter((link) => {
    try {
      return !own.has(new URL(link).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) return [];
  const domains = await loadSupportedDomains();
  if (!domains) return null;
  return candidates.filter((link) => {
    const hostname = new URL(link).hostname.toLowerCase();
    return domains.some((domain) => hostMatches(hostname, domain));
  });
}
