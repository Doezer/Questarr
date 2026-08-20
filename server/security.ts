// Small, dependency-free security helpers shared across the server. Keep
// additions here narrowly scoped -- this is not a place for a general
// utility grab-bag.

import type { NextFunction, Request, Response } from "express";

export const AUTH_COOKIE_NAME = "questarr_auth";
export const CSRF_COOKIE_NAME = "questarr_csrf";

// Matches generateToken()'s JWT expiry (server/auth.ts).
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parse a raw `Cookie` request header into a name -> value map. Deliberately
 * hand-rolled rather than pulling in the `cookie` package as a direct
 * dependency -- Express already ships it transitively for res.cookie(), and
 * reading is simple enough not to need a parser of its own.
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce<Record<string, string>>((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) return cookies;
    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
    } catch {
      cookies[rawName] = rawValue.join("=") || "";
    }
    return cookies;
  }, {});
}

export function getCookie(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

function cookieOptions(req: Request, httpOnly: boolean) {
  return {
    httpOnly,
    sameSite: "lax" as const,
    // req.secure reflects X-Forwarded-Proto once "trust proxy" is set (see
    // app.ts, enabled in production), so this is correct behind a reverse
    // proxy as well as when TLS terminates directly on this process.
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    path: "/",
  };
}

/**
 * Set the httpOnly JWT auth cookie plus a readable (non-httpOnly) CSRF token
 * cookie. The CSRF cookie's value doubles as the CSRF token itself (double-
 * submit pattern, see csrfProtection below) -- reusing the session token
 * keeps this dependency-free (no extra random-token bookkeeping) while still
 * being unguessable to a third-party site, since only same-origin JS can
 * read it.
 */
export function setAuthCookies(req: Request, res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...cookieOptions(req, true),
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...cookieOptions(req, false),
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

export function clearAuthCookies(req: Request, res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions(req, true));
  res.clearCookie(CSRF_COOKIE_NAME, cookieOptions(req, false));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit CSRF protection for cookie-authenticated requests.
 *
 * Only applies to requests authenticateToken tagged as cookie-authenticated
 * (req.authSource === "cookie") -- a request authenticated via
 * `Authorization: Bearer` is not exposed to CSRF the way a cookie is
 * (browsers don't auto-attach bearer tokens cross-site), so it's exempt.
 * Must be mounted AFTER the auth boundary so req.authSource is populated by
 * the time this runs.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  if (req.authSource !== "cookie") {
    return next();
  }

  const cookieToken = getCookie(req, CSRF_COOKIE_NAME);
  const headerToken = req.header("x-csrf-token");
  if (cookieToken && headerToken && cookieToken === headerToken) {
    return next();
  }

  // Fallback: an Origin/Referer that matches this host is also acceptable
  // (covers clients that can't easily read/attach the CSRF header, while
  // still blocking a cross-site form/fetch that carries the ambient cookie).
  const origin = req.header("origin") || req.header("referer");
  const host = req.header("host");
  if (origin && host) {
    try {
      if (new URL(origin).host === host) {
        return next();
      }
    } catch {
      // Fall through to rejection below.
    }
  }

  res.status(403).json({ error: "CSRF validation failed" });
}

const SECRET_KEY_PATTERN =
  /(api[_-]?key|apikey|authorization|bearer|client[_-]?secret|cookie|csrf|jwt|password|secret|token|webhook)/i;

/**
 * Redact common secret-shaped substrings (api_key=..., Bearer <token>, etc.)
 * out of a plain string before it reaches a log sink.
 */
export function redactSecretText(value: string): string {
  return value
    .replace(
      /\b(apikey|api[_-]?key|token|password|secret)["']?\s*[:=]\s*["']?([^"',\s&]+)["']?/gi,
      "$1=[redacted]"
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(
      /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'<>]+/gi,
      "[redacted-discord-webhook]"
    );
}

/**
 * Recursively redact values whose key looks secret-shaped (api_key, token,
 * password, secret, authorization, ...), and run redactSecretText over every
 * remaining string. Used as a pino `formatters.log` hook so structured log
 * fields never leak credentials, even if a caller accidentally logs a raw
 * config/downloader/indexer object.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Redacted: depth limit]";
  if (value == null) return value;
  if (typeof value === "string") return redactSecretText(value);
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactSecretText(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(entry, depth + 1);
  }
  return redacted;
}
