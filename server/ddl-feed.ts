import { extractHosterLinks } from "../shared/ddl-links.js";
import { safeFetch } from "./ssrf.js";
import { logger } from "./logger.js";

const ddlFeedLogger = logger.child({ module: "ddl-feed" });

const HOSTS_URL = "https://api.real-debrid.com/rest/1.0/hosts/domains";
const HOSTS_TTL_MS = 24 * 60 * 60 * 1000;

let supportedHosts: { at: number; domains: string[] } | null = null;

/** Domains Real-Debrid unrestricts (public endpoint, cached); null when it cannot be read. */
async function loadSupportedDomains(): Promise<string[] | null> {
  if (supportedHosts && Date.now() - supportedHosts.at < HOSTS_TTL_MS) {
    return supportedHosts.domains;
  }
  try {
    const response = await safeFetch(HOSTS_URL);
    if (!response.ok) return supportedHosts?.domains ?? null;
    const domains = ((await response.json()) as unknown[])
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.toLowerCase());
    supportedHosts = { at: Date.now(), domains };
    return domains;
  } catch (error) {
    ddlFeedLogger.warn({ error }, "Could not load the Real-Debrid host list");
    return supportedHosts?.domains ?? null;
  }
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
 * left out and, when Real-Debrid's host list is reachable, so is everything it cannot unrestrict.
 */
export async function extractItemLinks(
  item: Record<string, unknown>,
  feedUrl: string,
  itemLink: string
): Promise<string[]> {
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
  if (!domains) return candidates;
  return candidates.filter((link) => {
    const hostname = new URL(link).hostname.toLowerCase();
    return domains.some((domain) => hostMatches(hostname, domain));
  });
}
