import { isIP } from "node:net";

/**
 * Express "trust proxy" setting derived from the TRUST_PROXY environment
 * variable: `false` (the default, trust nothing), a hop count, or a
 * comma-separated list of trusted proxy addresses/subnets.
 */
export type TrustProxySetting = false | number | string;

// Named subnets understood by Express (via proxy-addr).
const NAMED_SUBNETS = new Set(["loopback", "linklocal", "uniquelocal"]);
const DISABLED_VALUES = new Set(["", "false", "0", "no", "off"]);

function isValidProxyEntry(entry: string): boolean {
  if (NAMED_SUBNETS.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split("/");
  if (!address || rest.length > 0) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
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
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const entries = normalized.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !isValidProxyEntry(entry))) return null;
  return entries.join(",");
}
