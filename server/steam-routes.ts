import { Router, type Request, type Response, type NextFunction } from "express";
import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import { syncUserSteamWishlist } from "./cron.js";
import { authenticateToken } from "./auth.js";
import { type User } from "@shared/schema";
import { config } from "./config.js";
import { logger } from "./logger.js";
import "express-session";

declare module "express-session" {
  interface SessionData {
    steam_auth_user_id?: string;
  }
}

interface SteamProfile {
  id: string;
  displayName: string;
  _json: {
    steamid: string;
    personaname: string;
    profileurl: string;
    avatar: string;
    avatarmedium: string;
    avatarfull: string;
    personastate: number;
    communityvisibilitystate: number;
    profilestate: number;
    lastlogoff: number;
    commentpermission: number;
  };
}

const router = Router();

// Passport Setup
passport.serializeUser((user: unknown, done: (err: unknown, id?: unknown) => void) => {
  done(null, user);
});

passport.deserializeUser((obj: unknown, done: (err: unknown, user?: unknown) => void) => {
  done(null, obj);
});

// Since we might not have a public domain in dev, we rely on the request host
// But for passport-steam, we need a realm and returnURL.
// Usage: SteamStrategy requires absolute URLs.
// We'll configure this dynamically if possible, or assume localhost/production url

// We need to initialize the strategy. Ideally this should be done once.
// Assuming this module is imported once.

if (!process.env.STEAM_API_KEY) {
  console.warn("STEAM_API_KEY is not set. Steam Auth will fail.");
}

// Helper to get base URL from a trusted source.
// Prefers the APP_URL environment variable. Falls back to request-derived URL
// with the host validated against the configured allowed origins to prevent
// host-header injection attacks.
const getBaseUrl = (req: Request): string => {
  // 1. Trust explicit APP_URL configuration (most secure)
  if (config.server.appUrl) {
    return config.server.appUrl.replace(/\/+$/, "");
  }

  // 2. Derive from the request, but validate the host against allowed origins
  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const forwardedProto =
    typeof forwardedProtoHeader === "string"
      ? forwardedProtoHeader.split(",")[0]?.trim().toLowerCase()
      : Array.isArray(forwardedProtoHeader)
        ? String(forwardedProtoHeader[0]).split(",")[0]?.trim().toLowerCase()
        : undefined;
  const protocol =
    forwardedProto && (forwardedProto === "http" || forwardedProto === "https")
      ? forwardedProto
      : req.protocol;
  const host = req.headers.host;

  const candidateUrl = `${protocol}://${host}`;

  // Validate the derived URL against allowed origins
  const allowedOrigins = config.server.allowedOrigins;
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(candidateUrl)) {
    logger.warn(
      { candidateUrl, allowedOrigins },
      "Steam auth: request host not in allowed origins, using first allowed origin"
    );
    return allowedOrigins[0];
  }

  return candidateUrl;
};

// We will use a dynamic strategy or just assume standard environment.
// For now, let's setup the route to initialize strategy on the fly if needed
// or just standard setup.
// To avoid "Strategy already exists" errors if this file is hot-reloaded:
passport.use(
  new SteamStrategy(
    {
      returnURL: "http://localhost:5000/api/auth/steam/return", // Placeholder, will override in route
      realm: "http://localhost:5000/",
      apiKey: process.env.STEAM_API_KEY || "MISSING_KEY",
    },
    function (
      identifier: string,
      profile: SteamProfile,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      done: (err: any, user?: any) => void
    ) {
      // identifier is like: https://steamcommunity.com/openid/id/76561198000000000
      // profile contains _json with steamid etc.
      process.nextTick(function () {
        // We just pass the profile through, the route handler will deal with linking
        return done(null, profile);
      });
    }
  )
);

// Manual Steam ID Update
router.put("/api/user/steam-id", authenticateToken, async (req, res) => {
  try {
    const { steamId } = req.body;
    const user = req.user as User;

    if (!steamId) {
      return res.status(400).json({ error: "Steam ID is required" });
    }

    if (!steamService.validateSteamId(steamId)) {
      return res
        .status(400)
        .json({ error: "Invalid Steam ID format (must be 17 digits starting with 7656)" });
    }

    // Check if another user already has this ID? (Optional unique constraint)
    // For now, just update.

    // We update the user directly? storage.updateUser is not generic but we have updateUserPassword.
    // We need to add updateUserSteamId to storage or use direct DB access (not ideal).
    // Wait, I missed adding `updateUserSteamId` to storage interface?
    // I can modify `updateUserPassword` to `updateUser` or add new method.
    // Storage has `updateUserPassword`. I should add `updateUser`.

    // WORKAROUND: For now, I'll access DB directly here or add the method.
    // Adding method is better.
    // I will assume `updateUser` exists or I'll implement it next.
    // Retrying plan: Add `updateUser` to storage.

    // Let's defer this specific line until I fix storage.
    // await storage.updateUser(userId, { steamId64: steamId });
    // Using a placeholder for now:
    await storage.updateUserSteamId(user.id, steamId);

    res.json({ success: true, steamId });
  } catch (error) {
    console.error("Error setting Steam ID:", error);
    res.status(500).json({ error: "Failed to set Steam ID" });
  }
});

// Sync Wishlist
router.post("/api/steam/wishlist/sync", authenticateToken, async (req, res) => {
  try {
    const user = req.user as User;

    const result = await syncUserSteamWishlist(user.id);

    if (!result) {
      return res.status(400).json({ error: "Steam ID not linked" });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json(result);
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ error: "Sync failed" });
  }
});

import crypto from "crypto";

// In-memory store for Steam auth sessions (UUID -> userId)
// Entries expire after 5 minutes
const steamAuthSessions = new Map<string, { userId: string; expiresAt: number }>();

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  steamAuthSessions.forEach((data, sessionId) => {
    if (now > data.expiresAt) {
      steamAuthSessions.delete(sessionId);
    }
  });
}, 60 * 1000);

// OpenID Auth — Two-step flow to avoid exposing JWT in URLs:
// Step 1: POST /api/auth/steam/init (authenticated via JWT header)
//   → Generates a short-lived sessionId mapped to the user ID.
// Step 2: GET /api/auth/steam?sessionId=... (no auth needed)
//   → Reads user ID from session map and starts the OpenID redirect to Steam.

// Step 1: Initialize Steam auth session
router.post("/api/auth/steam/init", authenticateToken, (req: Request, res: Response) => {
  const user = req.user as User;

  const sessionId = crypto.randomUUID();
  // Valid for 5 minutes
  steamAuthSessions.set(sessionId, {
    userId: user.id,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  logger.info({ userId: user.id, sessionId }, "Steam auth session initialized");
  res.json({ success: true, sessionId });
});

// Step 2: Start Steam OpenID redirect
router.get("/api/auth/steam", (req: Request, res: Response, next: NextFunction) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId || !steamAuthSessions.has(sessionId)) {
    logger.warn({ sessionId }, "Steam auth redirect attempted without valid sessionId");
    return res
      .status(401)
      .json({
        error:
          "Steam auth session not initialized or expired. Call POST /api/auth/steam/init first.",
      });
  }

  const baseUrl = getBaseUrl(req);

  // Pass realm and returnURL as per-request options
  // We append the sessionId to the return URL so we can identify the user after Steam redirects back
  passport.authenticate("steam", {
    session: false,
    returnURL: `${baseUrl}/api/auth/steam/return?sessionId=${sessionId}`,
    realm: baseUrl + "/",
  } as any)(req, res, next);
});

// GET /api/auth/steam/return
router.get("/api/auth/steam/return", (req: Request, res: Response, next: NextFunction) => {
  const baseUrl = getBaseUrl(req);
  const sessionId = req.query.sessionId as string;

  passport.authenticate(
    "steam",
    {
      session: false,
      failureRedirect: "/settings?error=steam_auth_failed",
      returnURL: `${baseUrl}/api/auth/steam/return?sessionId=${sessionId}`,
      realm: baseUrl + "/",
    } as any,
    async (err: unknown, profile: unknown) => {
      if (err || !profile) {
        return res.redirect("/settings?error=steam_auth_failed");
      }

      // Get userId from session map
      const sessionData = sessionId ? steamAuthSessions.get(sessionId) : undefined;

      if (!sessionData) {
        return res.redirect("/settings?error=session_expired");
      }

      const userId = sessionData.userId;
      const steamProfile = profile as SteamProfile;
      const steamId = steamProfile._json.steamid;

      try {
        await storage.updateUserSteamId(userId, steamId);
        // Clear the session
        steamAuthSessions.delete(sessionId);

        res.redirect("/settings?steam_linked=success");
      } catch (e) {
        logger.error(e, "Failed to update Steam ID after successful auth");
        res.redirect("/settings?error=db_error");
      }
    }
  )(req, res, next);
});

export const steamRoutes = router;
