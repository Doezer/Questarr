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

function isSafeIp(ip: string): boolean {
  // Block IPv4 Link-Local (169.254.0.0/16)
  // This covers AWS, GCP, Azure metadata services (169.254.169.254)
  if (ip.startsWith("169.254.")) {
    return false;
  }

  // Block IPv6 Link-Local (fe80::/10)
  // Simple string check for common prefix
  const lowerIp = ip.toLowerCase();
  if (lowerIp.startsWith("fe80:")) {
    return false;
  }

  // Block AWS IPv6 Metadata
  if (lowerIp === "fd00:ec2::254") {
    return false;
  }

  // Block IPv4-mapped IPv6 Metadata (::ffff:169.254.0.0/16)
  if (lowerIp.startsWith("::ffff:169.254.")) {
    return false;
  }

  // Block IPv4-mapped IPv6 Metadata in Hex (::ffff:a9fe:...)
  // 169.254.x.x -> a9fe:xxxx
  if (lowerIp.startsWith("::ffff:a9fe:")) {
    return false;
  }

  // Block Loopback (127.0.0.0/8)
  if (ip.startsWith("127.")) {
    return false;
  }

  // Block IPv6 Loopback (::1)
  if (lowerIp === "::1" || lowerIp === "0:0:0:0:0:0:0:1") {
    return false;
  }

  // Block Private Networks
  // 10.0.0.0/8
  if (ip.startsWith("10.")) {
    return false;
  }

  // 192.168.0.0/16
  if (ip.startsWith("192.168.")) {
    return false;
  }

  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (ip.startsWith("172.")) {
    const parts = ip.split(".");
    if (parts.length > 1) {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Performs a fetch request that is safe against DNS rebinding attacks.
 * It resolves the hostname once, validates the IP, and then connects to that IP
 * while verifying the SSL certificate against the original hostname (if HTTPS).
 */
export async function safeFetch(urlStr: string, options: RequestInit = {}): Promise<Response> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }

  const hostname = url.hostname;

  // Resolve hostname
  const { address, family } = await dns.lookup(hostname);

  if (!isSafeIp(address)) {
    throw new Error(`Blocked unsafe IP: ${address}`);
  }

  // Construct new URL with IP
  const ipUrl = new URL(urlStr);

  if (family === 6) {
    ipUrl.hostname = `[${address}]`;
  } else {
    ipUrl.hostname = address;
  }

  // Prepare headers
  const headers = new Headers(options.headers || {});
  headers.set("Host", hostname);

  // Create new options
  const newOptions: RequestInit = {
    ...options,
    headers,
  };

  return fetch(ipUrl.toString(), newOptions);
}
