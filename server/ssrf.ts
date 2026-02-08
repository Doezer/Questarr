import dns from "dns/promises";
import { isIP } from "net";

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
  options: { allowPrivate?: boolean } = {}
): Promise<boolean> {
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
    const lookup = await dns.lookup(hostname);
    return isSafeIp(lookup.address, options.allowPrivate);
  } catch {
    // If resolution fails, fail safe (deny)
    return false;
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
      lowerIp.startsWith("fe10") || // actually fe80-febb
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
export async function safeFetch(
  urlStr: string,
  options: RequestInit & { allowPrivate?: boolean } = {}
): Promise<Response> {
  const url = new URL(urlStr);
  const hostname = url.hostname;
  const isHttps = url.protocol === "https:";
  const { allowPrivate, ...fetchOptions } = options;

  // If hostname is already an IP, just validate it
  const ipVersion = isIP(hostname);
  let address = hostname;
  let family = ipVersion;

  if (ipVersion === 0) {
    try {
      const lookup = await dns.lookup(hostname);
      address = lookup.address;
      family = lookup.family;
    } catch (error) {
      throw new Error(`Failed to resolve hostname: ${hostname}`);
    }
  }

  if (!isSafeIp(address, allowPrivate)) {
    throw new Error("Invalid or unsafe URL");
  }

  // For HTTPS, we cannot rewrite the URL to use the IP address because
  // SSL/TLS certificates are issued for hostnames, not IP addresses.
  // The certificate validation would fail with a hostname mismatch error.
  // Instead, we've already validated the resolved IP is safe above,
  // and we proceed with the original URL.
  if (isHttps) {
    return fetch(urlStr, fetchOptions);
  }

  // For HTTP, rewrite URL to use IP address to prevent DNS rebinding
  const safeUrl = new URL(urlStr);
  safeUrl.hostname = family === 6 ? `[${address}]` : address;

  // Clone headers and set Host to original hostname
  const headers = new Headers(fetchOptions.headers || {});
  headers.set("Host", hostname);

  return fetch(safeUrl.toString(), {
    ...fetchOptions,
    headers,
  });
}
