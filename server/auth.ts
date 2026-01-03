import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { type Request, Response, NextFunction } from "express";
import { storage } from "./storage.js";
import { config } from "./config.js";
import { type User } from "@shared/schema";
import crypto from "crypto";

const SALT_ROUNDS = 10;

// Cache the JWT secret in memory to avoid DB hits on every request
let cachedJwtSecret: string | null = null;

/**
 * Get the JWT secret.
 * Priority:
 * 1. In-memory cache
 * 2. Environment variable (if not default)
 * 3. Database system config
 * 4. Generate new secret and store in DB
 */
async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) {
    return cachedJwtSecret;
  }

  // If env var is set and NOT the default, use it (override)
  if (
    config.auth.jwtSecret &&
    config.auth.jwtSecret !== "questarr-default-secret-change-me"
  ) {
    cachedJwtSecret = config.auth.jwtSecret;
    return cachedJwtSecret;
  }

  // Check DB
  const dbSecret = await storage.getSystemConfig("jwt_secret");
  if (dbSecret) {
    cachedJwtSecret = dbSecret;
    return cachedJwtSecret;
  }

  // Generate new secret
  const newSecret = crypto.randomBytes(64).toString("hex");
  await storage.setSystemConfig("jwt_secret", newSecret);
  cachedJwtSecret = newSecret;
  
  // Use console.info or console.warn instead of console.log to satisfy linter
  console.warn("Generated and stored new secure JWT secret");
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = user;
    next();
  } catch {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}
