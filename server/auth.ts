import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { type Request, Response, NextFunction } from "express";
import { storage } from "./storage.js";
import { config } from "./config.js";
import { type User } from "@shared/schema";
import crypto from "crypto";
import { logger } from "./logger.js";

const SALT_ROUNDS = 10;

// Cache the JWT secret in memory to avoid DB hits on every request
let cachedJwtSecret: string | null = null;

/**
 * Get the JWT secret.
 * Priority:
 * 1. In-memory cache
 * 2. Environment variable
 * 3. Database system config
 * 4. Generate new secret and store in DB
 */
async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) {
    return cachedJwtSecret;
  }

  // If env var is set, use it (override).
  if (config.auth.jwtSecret) {
    logger.info("Using JWT secret from environment variable");
    cachedJwtSecret = config.auth.jwtSecret;
    return cachedJwtSecret;
  }

  // Check DB
  try {
    const dbSecret = await storage.getSystemConfig("jwt_secret");
    if (dbSecret) {
      logger.info("Loaded JWT secret from database");
      cachedJwtSecret = dbSecret;
      return cachedJwtSecret;
    }
  } catch (error) {
    logger.warn("Failed to load JWT secret from database, generating new one: %s", error);
  }

  // Generate new secret
  const newSecret = crypto.randomBytes(64).toString("hex");

  try {
    await storage.setSystemConfig("jwt_secret", newSecret);
    logger.info("Generated and stored new JWT secret in database");
  } catch (error) {
    logger.error("Failed to store JWT secret in database: %s", error);
  }

  cachedJwtSecret = newSecret;

  if (!config.auth.jwtSecret) {
    logger.warn("⚠️  Using generated JWT secret.");
    logger.warn(
      "⚠️  Set JWT_SECRET in your .env file to use a persistent secret across database resets."
    );
  }

  return newSecret;
}

export async function hashPassword(password: string) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string) {
  return await bcrypt.compare(password, hash);
}

export async function generateToken(user: User) {
  const secret = await getJwtSecret();
  return jwt.sign({ id: user.id, username: user.username }, secret, {
    expiresIn: "7d",
  });
}

/**
 * Optional authentication middleware. Sets req.user when a valid JWT is present
 * but never blocks the request — unauthenticated callers simply get no req.user.
 */
export async function optionalAuthenticateToken(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token) {
    try {
      const secret = await getJwtSecret();
      const payload = jwt.verify(token, secret) as { id: string; username: string };
      const user = await storage.getUser(payload.id);
      if (user) req.user = user;
    } catch {
      // Invalid token — continue without user context
    }
  }
  next();
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const secret = await getJwtSecret();
    const payload = jwt.verify(token, secret) as { id: string; username: string };
    const user = await storage.getUser(payload.id);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

// ── Integration API keys ─────────────────────────────────────────────────────
// Machine clients (the Playnite extension, scripts) can't run the interactive
// login flow, so they authenticate with a long-lived key instead of a JWT.

/** Prefix that makes a Questarr key recognisable in logs and config files. */
export const API_KEY_PREFIX = "qsr_";

/** Number of leading characters stored in plaintext so the UI can label a key. */
const API_KEY_DISPLAY_PREFIX_LENGTH = 12;

/**
 * Mint a new API key. Returns the raw key (shown to the user exactly once), the
 * SHA-256 hash to persist, and the display prefix.
 *
 * The key carries 256 bits of entropy, so a plain SHA-256 is the right hash
 * here: there is no low-entropy secret to protect, and unlike bcrypt it keeps
 * lookup to a single indexed query instead of a scan over every stored key.
 */
export function generateApiKey(): { rawKey: string; keyHash: string; prefix: string } {
  const rawKey = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return {
    rawKey,
    keyHash: hashApiKey(rawKey),
    prefix: rawKey.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
  };
}

/** Hash a raw API key for storage/lookup. */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Read the presented API key from either the `X-Api-Key` header or an
 * `Authorization: Bearer` header, so clients can use whichever their HTTP stack
 * makes easy. Returns undefined when neither carries a Questarr-shaped key.
 */
function extractApiKey(req: Request): string | undefined {
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }

  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string") {
    const [scheme, value] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value?.startsWith(API_KEY_PREFIX)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Authenticate a request carrying an integration API key, populating req.user
 * with the key's owner. Falls through to JWT authentication when no API key is
 * presented, so the same routes stay usable from the browser UI.
 */
export async function authenticateApiKeyOrToken(req: Request, res: Response, next: NextFunction) {
  const rawKey = extractApiKey(req);

  if (!rawKey) {
    return authenticateToken(req, res, next);
  }

  try {
    const record = await storage.getApiKeyByHash(hashApiKey(rawKey));
    if (!record) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const user = await storage.getUser(record.userId);
    if (!user) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    req.user = user;
    req.apiKeyId = record.id;

    // Best-effort usage stamp: it powers the "last used" column in Settings and
    // must never fail the request it is describing.
    storage.touchApiKey(record.id).catch((error) => {
      logger.warn({ error }, "Failed to record API key usage");
    });

    next();
  } catch (error) {
    logger.error({ error }, "API key authentication failed");
    res.status(500).json({ error: "Authentication failed" });
  }
}
