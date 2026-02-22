import { Router, type Request, type Response, type NextFunction } from "express";
import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import { syncUserSteamWishlist } from "./cron.js";
import { authenticateToken } from "./auth.js";
import { type User } from "@shared/schema";

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

// Helper to get base URL
const getBaseUrl = (req: Request) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers.host;
  return `${protocol}://${host}`;
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
      done: (err: unknown, user?: unknown) => void
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

// OpenID Auth
// GET /api/auth/steam
router.get(
  "/api/auth/steam",
  authenticateToken,
  (req: Request, res: Response, next: NextFunction) => {
    // We need to persist the user ID. Since passport-steam redirects, we can't easily pass state
    // unless we use a session or cookie.
    // Helper function to dynamically set Realm/ReturnURL based on request
    const baseUrl = getBaseUrl(req);

    // Trick: we are authenticated via JWT (authenticateToken middleware).
    // We can set a session variable to the userId.
    const user = req.user as User;
    const session = (req as any).session; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (session) {
      session.steam_auth_user_id = user.id;
    } else {
      console.error("Session not available in steam auth route");
      return res.status(500).json({ error: "Session configuration error" });
    }

    // Re-configure strategy to match current host (important for dev/prod switch)
    // Actually typically handled by just having relative URLs or ENV, but library requires full URL.
    const strategy = (passport as any)._strategies["steam"]; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (strategy) {
      strategy._options.realm = baseUrl + "/";
      strategy._options.returnURL = baseUrl + "/api/auth/steam/return";
    }

    passport.authenticate("steam", { session: false })(req, res, next);
  }
);

// GET /api/auth/steam/return
router.get("/api/auth/steam/return", (req: Request, res: Response, next: NextFunction) => {
  const baseUrl = getBaseUrl(req);
  const strategy = (passport as any)._strategies["steam"]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (strategy) {
    strategy._options.realm = baseUrl + "/";
    strategy._options.returnURL = baseUrl + "/api/auth/steam/return";
  }

  passport.authenticate(
    "steam",
    { session: false, failureRedirect: "/settings?error=steam_auth_failed" },
    async (err: unknown, profile: unknown) => {
      if (err || !profile) {
        return res.redirect("/settings?error=steam_auth_failed");
      }

      // Success
      // Get userId from session
      const session = (req as any).session; // eslint-disable-line @typescript-eslint/no-explicit-any
      const userId = session?.steam_auth_user_id;

      if (!userId) {
        return res.redirect("/settings?error=session_expired");
      }

      const steamProfile = profile as SteamProfile;
      const steamId = steamProfile._json.steamid;

      try {
        await storage.updateUserSteamId(userId, steamId);
        // Clear the session variable
        if (session) {
          delete session.steam_auth_user_id;
        }
        res.redirect("/settings?steam_linked=success");
      } catch (e) {
        console.error(e);
        res.redirect("/settings?error=db_error");
      }
    }
  )(req, res, next);
});

export const steamRoutes = router;
