import { isIP } from "node:net";

/**
 * Express "trust proxy" setting derived from the TRUST_PROXY environment
 * variable: `false` (the default, trust nothing), a hop count, or a
 * comma-separated list of trusted proxy addresses/subnets.
 */
export type TrustProxySetting = false | number | string;

// Named subnets understood by Express (via proxy-addr).
const NAMED_SUBNETS = new Set(["loopback", "linklocal", "uniquelocal"]);
const MAX_HOPS = 10;
const DISABLED_VALUES = new Set(["", "false", "0", "no", "off"]);

function isValidProxyEntry(entry: string): boolean {
  if (NAMED_SUBNETS.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split("/");
  // Zone IDs (fe80::1%eth0) are not supported: list the subnet instead
  // (e.g. fe80::/10, or "linklocal").
  if (!address || rest.length > 0 || address.includes("%")) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  // Express (proxy-addr) rejects a /0 range when compiling, and trusting
  // every address would defeat the point anyway.
  const bits = Number(prefix);
  if (version === 4) return bits > 0 && bits <= 32;
  // proxy-addr matches an IPv4-mapped range (::ffff:a.b.c.d/n) against plain
  // IPv4 peers as /(n - 96), so /96 would trust every IPv4 address.
  const minBits = isIPv4Mapped(address) ? 96 : 0;
  return bits > minBits && bits <= 128;
}

function isIPv4Mapped(address: string): boolean {
  // URL parsing canonicalizes every spelling (::ffff:10.0.0.1,
  // 0:0:0:0:0:ffff:a00:1, ...) to the ::ffff:xxxx:xxxx form.
  const canonical = new URL(`http://[${address}]`).hostname;
  return /^\[::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}\]$/.test(canonical);
}

/**
 * Parses TRUST_PROXY. Returns `null` when the value is invalid.
 *
 * Trusting a proxy makes Express read the client IP (used by every rate
 * limiter, including the login one) and the protocol from X-Forwarded-For /
 * X-Forwarded-Proto. Without a proxy in front, any client could set those
 * headers itself, so it stays off unless explicitly enabled.
 *
 * "true" maps to 1 hop rather than Express's own `true`, which trusts the
 * whole chain and would take the left-most, client-controlled
 * X-Forwarded-For entry as the client IP.
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (DISABLED_VALUES.has(normalized)) return false;
  if (normalized === "true" || normalized === "yes" || normalized === "on") return 1;
  if (/^\d+$/.test(normalized)) {
    // A huge hop count trusts the whole chain, the same spoofable setup as
    // Express's `true`; real deployments sit behind a handful of proxies.
    const hops = Number(normalized);
    return hops <= MAX_HOPS ? hops : null;
  }

  const entries = normalized.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !isValidProxyEntry(entry))) return null;
  return entries.join(",");
}
