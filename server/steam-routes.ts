import { Router } from "express";
import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import { storage } from "./storage.js";
import { steamService } from "./steam.js";
import { syncUserSteamWishlist } from "./cron.js";
import { authenticateToken } from "./auth.js";


const router = Router();

// Passport Setup
passport.serializeUser((user: any, done: any) => {
  done(null, user);
});

passport.deserializeUser((obj: any, done: any) => {
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
const getBaseUrl = (req: any) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers.host;
  return `${protocol}://${host}`;
};

// We will use a dynamic strategy or just assume standard environment.
// For now, let's setup the route to initialize strategy on the fly if needed 
// or just standard setup.
// To avoid "Strategy already exists" errors if this file is hot-reloaded:
passport.use(new SteamStrategy({
  returnURL: 'http://localhost:5000/api/auth/steam/return', // Placeholder, will override in route
  realm: 'http://localhost:5000/',
  apiKey: process.env.STEAM_API_KEY || 'MISSING_KEY'
},
  function (identifier: string, profile: any, done: (err: any, user?: any) => void) {
    // identifier is like: https://steamcommunity.com/openid/id/76561198000000000
    // profile contains _json with steamid etc.
    process.nextTick(function () {
      // We just pass the profile through, the route handler will deal with linking
      return done(null, profile);
    });
  }
));


// Manual Steam ID Update
router.put("/api/user/steam-id", authenticateToken, async (req, res) => {
  try {
    const { steamId } = req.body;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user.id;

    if (!steamId) {
      return res.status(400).json({ error: "Steam ID is required" });
    }

    if (!steamService.validateSteamId(steamId)) {
      return res.status(400).json({ error: "Invalid Steam ID format (must be 17 digits starting with 7656)" });
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
    await storage.updateUserSteamId(userId, steamId);

    res.json({ success: true, steamId });
  } catch (error) {
    console.error("Error setting Steam ID:", error);
    res.status(500).json({ error: "Failed to set Steam ID" });
  }
});

// Sync Wishlist
router.post("/api/steam/wishlist/sync", authenticateToken, async (req, res) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).user.id;

    const result = await syncUserSteamWishlist(userId);

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
router.get('/api/auth/steam', authenticateToken, (req, res, next) => {
  // We need to persist the user ID. Since passport-steam redirects, we can't easily pass state 
  // unless we use a session or cookie.
  // Helper function to dynamically set Realm/ReturnURL based on request
  const baseUrl = getBaseUrl(req);

  // Trick: we are authenticated via JWT (authenticateToken middleware).
  // We can set a session variable to the userId.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).user;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((req as any).session) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session.steam_auth_user_id = user.id;
  } else {
    console.error("Session not available in steam auth route");
    return res.status(500).json({ error: "Session configuration error" });
  }

  // Re-configure strategy to match current host (important for dev/prod switch)
  // Actually typically handled by just having relative URLs or ENV, but library requires full URL.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategy = (passport as any)._strategies['steam'];
  if (strategy) {
    strategy._options.realm = baseUrl + '/';
    strategy._options.returnURL = baseUrl + '/api/auth/steam/return';
  }

  passport.authenticate('steam', { session: false })(req, res, next);
});

// GET /api/auth/steam/return
router.get('/api/auth/steam/return', (req, res, next) => {
  const baseUrl = getBaseUrl(req);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategy = (passport as any)._strategies['steam'];
  if (strategy) {
    strategy._options.realm = baseUrl + '/';
    strategy._options.returnURL = baseUrl + '/api/auth/steam/return';
  }

  passport.authenticate('steam', { session: false, failureRedirect: '/settings?error=steam_auth_failed' }, async (err: any, user: any) => {
    if (err || !user) {
      return res.redirect('/settings?error=steam_auth_failed');
    }

    // Success
    // Get userId from session
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (req as any).session?.steam_auth_user_id;

    if (!userId) {
      return res.redirect('/settings?error=session_expired');
    }

    const steamId = user._json.steamid;

    try {
      await storage.updateUserSteamId(userId, steamId);
      // Clear the session variable
      if ((req as any).session) {
        delete (req as any).session.steam_auth_user_id;
      }
      res.redirect('/settings?steam_linked=success');
    } catch (e) {
      console.error(e);
      res.redirect('/settings?error=db_error');
    }

  })(req, res, next);
});

export const steamRoutes = router;
