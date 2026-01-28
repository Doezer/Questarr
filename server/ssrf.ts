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

  return true;
}
