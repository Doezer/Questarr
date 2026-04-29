import dns from "dns/promises";
import { isIP } from "net";

const DEFAULT_SAFE_FETCH_TIMEOUT_MS = 30000;
const DEFAULT_SAFE_FETCH_MAX_REDIRECTS = 5;

type SafeFetchOptions = RequestInit & {
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxRedirects?: number;
};

interface SafeFetchTarget {
  address: string;
  family: number;
  hostname: string;
  isHttps: boolean;
}

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function buildFetchSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined
): AbortSignal | undefined {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return signal ?? undefined;
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }

  return signal;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function getRedirectOptions(fetchOptions: RequestInit, status: number): RequestInit {
  const method = (fetchOptions.method || "GET").toUpperCase();
  const shouldSwitchToGet =
    status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");

  if (!shouldSwitchToGet) {
    return fetchOptions;
  }

  const headers = new Headers(fetchOptions.headers ?? {});
  headers.delete("content-length");
  headers.delete("content-type");

  return {
    ...fetchOptions,
    method: "GET",
    body: undefined,
    headers,
  };
}

async function resolveSafeFetchTarget(url: URL, allowPrivate = true): Promise<SafeFetchTarget> {
  const hostname = normalizeHostname(url.hostname);
  const isHttps = url.protocol === "https:";
  const ipVersion = isIP(hostname);

  if (ipVersion !== 0) {
    if (!isSafeIp(hostname, allowPrivate)) {
      throw new Error("Invalid or unsafe URL");
    }

    return {
      address: hostname,
      family: ipVersion,
      hostname,
      isHttps,
    };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });

    if (!addresses || addresses.length === 0) {
      throw new Error("Invalid or unsafe URL");
    }

    for (const { address } of addresses) {
      if (!isSafeIp(address, allowPrivate)) {
        throw new Error("Invalid or unsafe URL");
      }
    }

    return {
      address: addresses[0].address,
      family: addresses[0].family,
      hostname,
      isHttps,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid or unsafe URL") {
      throw error;
    }
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }
}

async function fetchValidatedOnce(
  url: URL,
  fetchOptions: RequestInit,
  allowPrivate = true
): Promise<Response> {
  const target = await resolveSafeFetchTarget(url, allowPrivate);

  if (target.isHttps) {
    return fetch(url.toString(), fetchOptions);
  }

  const safeUrl = new URL(url.toString());
  safeUrl.hostname = target.family === 6 ? `[${target.address}]` : target.address;

  const headers = new Headers(fetchOptions.headers ?? {});
  headers.set("Host", target.hostname);

  return fetch(safeUrl.toString(), {
    ...fetchOptions,
    headers,
  });
}

/**
 * Validates if a URL is safe to connect to, preventing SSRF attacks against
 * cloud metadata services and other sensitive internal endpoints.
 *
 * Always blocks (regardless of allowPrivate):
 * - 169.254.0.0/16 (IPv4 Link-Local / Cloud Metadata)
 * - fe80::/10 (IPv6 Link-Local)
 * - fd00:ec2::254 (AWS IPv6 Metadata)
 * - ::ffff:169.254.0.0/16 (IPv4-mapped IPv6 Metadata)
 * - 0.0.0.0/8 (Broadcast)
 *
 * Allowed by default (for self-hosted projects):
 * - Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Loopback (127.0.0.0/8, ::1)
 */
export async function isSafeUrl(
  urlStr: string,
  options: { allowPrivate?: boolean } = { allowPrivate: true }
): Promise<boolean> {
  // Magnet links are not HTTP(S) URLs and do not cause any server-side network connection.
  // They are passed directly to the download client, so they pose no SSRF risk.
  if (urlStr.startsWith("magnet:")) {
    return true;
  }

  let url: URL;
  try {
    // Ensure protocol is http or https
    if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
      // If no protocol, it might be added later by the client, but for validation we assume http to parse
      urlStr = "http://" + urlStr;
    }

    url = new URL(urlStr);
  } catch {
    return false;
  }

  let hostname = url.hostname;

  // Handle IPv6 brackets in hostname (e.g. [::1]) which URL.hostname might preserve
  // but isIP and dns.lookup don't always handle correctly.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  // Check if hostname is an IP
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    return isSafeIp(hostname, options.allowPrivate);
  }

  // Resolve hostname
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return false;
    }
    // Check all resolved addresses to prevent DNS rebinding attacks
    for (const { address } of addresses) {
      if (!isSafeIp(address, options.allowPrivate)) {
        return false;
      }
    }
    return true;
  } catch {
    // DNS resolution failed — hostname is unresolvable from this context (e.g. a
    // Docker service name only visible inside the container network). There is no
    // SSRF risk because we cannot reach a host we cannot resolve; allow it so
    // Docker / LAN aliases work in self-hosted deployments.
    return true;
  }
}

/**
 * Checks if an IP address is safe to connect to.
 *
 * Always blocks (regardless of allowPrivate):
 * - Link-Local (169.254.0.0/16, fe80::/10, etc.)
 * - Broadcast/Unspecified (0.0.0.0, ::)
 *
 * Allowed by default (allowPrivate=true for self-hosted projects):
 * - Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
 * - Loopback (127.0.0.0/8, ::1)
 */
export function isSafeIp(ip: string, allowPrivate = true): boolean {
  const normalizedIp = ip.toLowerCase();

  // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1 or ::ffff:a9fe:a9fe)
  if (normalizedIp.startsWith("::ffff:")) {
    const suffix = normalizedIp.substring(7);
    if (isIP(suffix) === 4) {
      return isSafeIp(suffix, allowPrivate);
    }
    // Handle hex version (e.g. ::ffff:a9fe:a9fe)
    if (suffix.includes(":")) {
      const parts = suffix.split(":");
      if (parts.length === 2) {
        const v4parts = [
          parseInt(parts[0].substring(0, 2), 16),
          parseInt(parts[0].substring(2, 4), 16),
          parseInt(parts[1].substring(0, 2), 16),
          parseInt(parts[1].substring(2, 4), 16),
        ];
        if (!v4parts.some(isNaN)) {
          return isSafeIp(v4parts.join("."), allowPrivate);
        }
      }
    }
  }

  const lowerIp = ip.toLowerCase();

  // IPv4 Checks
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);

    // 169.254.0.0/16 (Link-Local / Metadata)
    if (parts[0] === 169 && parts[1] === 254) return false;

    // 0.0.0.0/8 (Broadcast)
    if (parts[0] === 0) return false;

    if (!allowPrivate) {
      // 127.0.0.0/8 (Loopback)
      if (parts[0] === 127) return false;

      // 10.0.0.0/8 (Private)
      if (parts[0] === 10) return false;

      // 172.16.0.0/12 (Private)
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;

      // 192.168.0.0/16 (Private)
      if (parts[0] === 192 && parts[1] === 168) return false;
    }

    return true;
  }

  // IPv6 Checks
  if (isIP(ip) === 6) {
    // fe80::/10 (Link-Local)
    if (
      lowerIp.startsWith("fe8") ||
      lowerIp.startsWith("fe9") ||
      lowerIp.startsWith("fea") ||
      lowerIp.startsWith("feb")
    )
      return false;

    // AWS IPv6 Metadata
    if (lowerIp === "fd00:ec2::254") return false;

    if (!allowPrivate) {
      // ::1 (Loopback)
      if (lowerIp === "::1" || lowerIp === "0:0:0:0:0:0:0:1") return false;

      // :: (Unspecified)
      if (lowerIp === "::" || lowerIp === "0:0:0:0:0:0:0:0") return false;

      // fc00::/7 (Unique Local)
      if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) return false;
    }

    return true;
  }

  return false;
}

/**
 * Perform a safe fetch that avoids SSRF and DNS rebinding.
 * It resolves the hostname once, validates the IP, and then performs the request.
 *
 * For HTTP: rewrites URL to use IP address to prevent DNS rebinding.
 * For HTTPS: uses original hostname because SSL certificates are issued for
 * hostnames, not IP addresses. The DNS resolution still validates the target IP
 * is safe before making the request.
 */
export async function safeFetch(urlStr: string, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    allowPrivate,
    maxRedirects = DEFAULT_SAFE_FETCH_MAX_REDIRECTS,
    redirect = "follow",
    signal,
    timeoutMs = DEFAULT_SAFE_FETCH_TIMEOUT_MS,
    ...fetchOptions
  } = options;

  let currentUrl = new URL(urlStr);
  let currentOptions: RequestInit = {
    ...fetchOptions,
    signal: buildFetchSignal(signal, timeoutMs),
  };
  let redirectCount = 0;

  while (true) {
    const response = await fetchValidatedOnce(
      currentUrl,
      {
        ...currentOptions,
        redirect: redirect === "follow" ? "manual" : redirect,
      },
      allowPrivate
    );

    if (redirect !== "follow" || !isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    if (redirectCount >= maxRedirects) {
      throw new Error(`Too many redirects (max ${maxRedirects})`);
    }

    currentUrl = new URL(location, currentUrl);
    currentOptions = getRedirectOptions(currentOptions, response.status);
    redirectCount++;
  }
}
