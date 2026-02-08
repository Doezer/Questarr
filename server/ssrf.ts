import dns from "dns/promises";
import { isIP } from "net";

/**
 * Validates if a URL is safe to connect to, preventing SSRF attacks against
 * cloud metadata services and other sensitive internal endpoints.
 *
 * Explicitly blocks:
 * - 169.254.0.0/16 (IPv4 Link-Local / Cloud Metadata)
 * - fe80::/10 (IPv6 Link-Local)
 * - fd00:ec2::254 (AWS IPv6 Metadata)
 * - ::ffff:169.254.0.0/16 (IPv4-mapped IPv6 Metadata)
 *
 * Allows:
 * - Localhost (127.0.0.1, ::1)
 * - Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 */
export async function isSafeUrl(urlStr: string): Promise<boolean> {
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
    return isSafeIp(hostname);
  }

  // Resolve hostname
  // We only check the first resolved address.
  // A sophisticated attack might use DNS rebinding, but this catches basic attempts.
  try {
    const { address } = await dns.lookup(hostname);
    return isSafeIp(address);
  } catch {
    // If resolution fails, fail safe (deny)
    return false;
  }
}

/**
 * Checks if an IP address is safe to connect to.
 * Blocks:
 * - Link-Local (169.254.0.0/16, fe80::/10, etc.)
 * - Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
 * - Loopback (127.0.0.0/8, ::1)
 * - Broadcast/Unspecified (0.0.0.0, ::)
 */
export function isSafeIp(ip: string): boolean {
  // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
  if (ip.startsWith("::ffff:")) {
    const ipv4 = ip.substring(7);
    if (isIP(ipv4) === 4) {
      return isSafeIp(ipv4);
    }
  }

  const lowerIp = ip.toLowerCase();

  // IPv4 Checks
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);

    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return false;

    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) return false;

    // 172.16.0.0/12 (Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;

    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) return false;

    // 169.254.0.0/16 (Link-Local)
    if (parts[0] === 169 && parts[1] === 254) return false;

    // 0.0.0.0/8 (Broadcast)
    if (parts[0] === 0) return false;

    return true;
  }

  // IPv6 Checks
  if (isIP(ip) === 6) {
    // ::1 (Loopback)
    if (lowerIp === "::1" || lowerIp === "0:0:0:0:0:0:0:1") return false;

    // :: (Unspecified)
    if (lowerIp === "::" || lowerIp === "0:0:0:0:0:0:0:0") return false;

    // fe80::/10 (Link-Local)
    if (
      lowerIp.startsWith("fe8") ||
      lowerIp.startsWith("fe9") ||
      lowerIp.startsWith("fea") ||
      lowerIp.startsWith("feb")
    )
      return false;

    // fc00::/7 (Unique Local)
    if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) return false;

    // AWS IPv6 Metadata
    if (lowerIp === "fd00:ec2::254") return false;

    return true;
  }

  return false;
}

/**
 * Perform a safe fetch that avoids SSRF and DNS rebinding.
 * It resolves the hostname once, validates the IP, and then performs the request
 * using the validated IP address while setting the Host header.
 */
export async function safeFetch(urlStr: string, options: RequestInit = {}): Promise<Response> {
  const url = new URL(urlStr);
  const hostname = url.hostname;

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

  if (!isSafeIp(address)) {
    throw new Error("Invalid or unsafe URL");
  }

  // Rewrite URL to use IP address to prevent DNS rebinding
  const safeUrl = new URL(urlStr);
  safeUrl.hostname = family === 6 ? `[${address}]` : address;

  // Clone headers and set Host to original hostname
  const headers = new Headers(options.headers || {});
  headers.set("Host", hostname);

  return fetch(safeUrl.toString(), {
    ...options,
    headers,
  });
}
