import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { type Request, Response, NextFunction } from "express";
import { storage } from "./storage.js";
import { config } from "./config.js";
import { type User } from "@shared/schema";

const SALT_ROUNDS = 10;

export async function hashPassword(password: string) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string) {
  return await bcrypt.compare(password, hash);
}

export function generateToken(user: User) {
  return jwt.sign({ id: user.id, username: user.username }, config.auth.jwtSecret, {
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
    const payload = jwt.verify(token, config.auth.jwtSecret) as { id: string; username: string };
    const user = await storage.getUser(payload.id);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}
