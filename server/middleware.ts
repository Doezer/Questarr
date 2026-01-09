import rateLimit from "express-rate-limit";
import { body, param, query, validationResult } from "express-validator";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage.js";

// Dynamic rate limiter for IGDB API endpoints to prevent blacklisting
// IGDB has a limit of 4 requests per second, we default to 3 to be conservative
// The rate limit can be configured per user in settings
export const igdbRateLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: async (req: Request) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (req as any).user?.id;
      if (!userId) {
        return 3; // Default for unauthenticated requests
      }

      const settings = await storage.getUserSettings(userId);
      return settings?.igdbRateLimitPerSecond ?? 3;
    } catch (error) {
      console.error("Error fetching user rate limit:", error);
      return 3; // Fallback to default on error
    }
  },
  message: "Too many IGDB requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Rate limiter for sensitive endpoints (write operations)
export const sensitiveEndpointLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for authentication/login endpoints (if needed in future)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per 15 minutes
  message: "Too many authentication attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter (lenient, just to prevent abuse)
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware to check for validation errors
export const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      details: errors.array(),
    });
  }
  next();
};

// Sanitization rules for game search queries
export const sanitizeSearchQuery = [
  query("q")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Search query must be between 1 and 200 characters"),
  query("search")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Search query must be at most 200 characters"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
];

// Sanitization rules for game ID parameters
export const sanitizeGameId = [
  param("id")
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid game ID format"),
];

// Sanitization rules for IGDB ID parameters
export const sanitizeIgdbId = [
  param("id").trim().isInt({ min: 1 }).withMessage("Invalid IGDB ID").toInt(),
];

// Sanitization rules for game status updates
export const sanitizeGameStatus = [
  body("status")
    .trim()
    .isIn(["wanted", "owned", "completed", "downloading"])
    .withMessage("Invalid status value"),
];

// Sanitization rules for adding games
export const sanitizeGameData = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be between 1 and 500 characters"),
  body("igdbId").optional().isInt({ min: 1 }).withMessage("Invalid IGDB ID").toInt(),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Summary must be at most 5000 characters"),
  body("coverUrl").optional().trim().isURL().withMessage("Invalid cover URL"),
  body("releaseDate")
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("Invalid date format, use YYYY-MM-DD"),
  body("rating")
    .optional()
    .isFloat({ min: 0, max: 10 })
    .withMessage("Rating must be between 0 and 10")
    .toFloat(),
  body("platforms").optional().isArray().withMessage("Platforms must be an array"),
  body("platforms.*")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Platform name must be at most 100 characters"),
  body("genres").optional().isArray().withMessage("Genres must be an array"),
  body("genres.*")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Genre name must be at most 100 characters"),
  body("publishers").optional().isArray().withMessage("Publishers must be an array"),
  body("publishers.*")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Publisher name must be at most 200 characters"),
  body("developers").optional().isArray().withMessage("Developers must be an array"),
  body("developers.*")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Developer name must be at most 200 characters"),
];

// Sanitization rules for indexer data
export const sanitizeIndexerData = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("url").trim().isURL().withMessage("Invalid URL"),
  body("apiKey")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("API key must be at most 500 characters"),
  body("protocol").optional().trim().isIn(["torznab", "newznab"]).withMessage("Invalid protocol"),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
];

// Sanitization rules for partial indexer updates (PATCH)
export const sanitizeIndexerUpdateData = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("url").optional().trim().isURL().withMessage("Invalid URL"),
  body("apiKey")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("API key must be at most 500 characters"),
  body("protocol").optional().trim().isIn(["torznab", "newznab"]).withMessage("Invalid protocol"),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
  body("priority")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Priority must be a positive integer")
    .toInt(),
  body("categories").optional().isArray().withMessage("Categories must be an array"),
  body("rssEnabled")
    .optional()
    .isBoolean()
    .withMessage("RSS enabled must be a boolean")
    .toBoolean(),
  body("autoSearchEnabled")
    .optional()
    .isBoolean()
    .withMessage("Auto search enabled must be a boolean")
    .toBoolean(),
];

// Sanitization rules for downloader data
export const sanitizeDownloaderData = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("type")
    .trim()
    .isIn(["qbittorrent", "transmission", "rtorrent", "deluge", "sabnzbd", "nzbget"])
    .withMessage("Invalid downloader type"),
  body("url")
    .trim()
    .custom((value, { req }) => {
      const type = req.body.type;

      // If it's a valid URL, it's always acceptable
      const isUrl = /^https?:\/\/.+/.test(value);
      if (isUrl) return true;

      // For qbittorrent, rtorrent, and transmission, allow hostname/IP without protocol
      if (type === "qbittorrent" || type === "rtorrent" || type === "transmission") {
        // Accept hostname, IP address, or FQDN
        const hostnameRegex =
          /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        return hostnameRegex.test(value) || ipRegex.test(value);
      }

      // Other downloaders require full URL
      return false;
    })
    .withMessage("Invalid URL or hostname"),
  body("username")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Username must be at most 200 characters"),
  body("password")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Password must be at most 200 characters"),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
  body("downloadPath")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Download path must be at most 500 characters")
    // 🛡️ Sentinel: Add path traversal validation.
    // Disallow '..' in download paths to prevent writing files outside the intended directory.
    .custom((value) => !value.includes(".."))
    .withMessage("Download path cannot contain '..'"),
  body("label")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Label must be at most 100 characters"),
];

// Sanitization rules for partial downloader updates (PATCH)
export const sanitizeDownloaderUpdateData = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Name must be between 1 and 200 characters"),
  body("type")
    .optional()
    .trim()
    .isIn([
      "qbittorrent",
      "transmission",
      "deluge",
      "rtorrent",
      "utorrent",
      "vuze",
      "sabnzbd",
      "nzbget",
    ])
    .withMessage("Invalid downloader type"),
  body("url")
    .optional()
    .trim()
    .custom((value, { req }) => {
      if (!value) return true; // Optional field
      const type = req.body.type;

      // If it's a valid URL, it's always acceptable
      const isUrl = /^https?:\/\/.+/.test(value);
      if (isUrl) return true;

      // For qbittorrent, rtorrent, and transmission, allow hostname/IP without protocol
      if (type === "qbittorrent" || type === "rtorrent" || type === "transmission") {
        // Accept hostname, IP address, or FQDN
        const hostnameRegex =
          /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        return hostnameRegex.test(value) || ipRegex.test(value);
      }

      // Other downloaders require full URL
      return false;
    })
    .withMessage("Invalid URL or hostname"),
  body("username")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Username must be at most 200 characters"),
  body("password")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Password must be at most 200 characters"),
  body("enabled").optional().isBoolean().withMessage("Enabled must be a boolean").toBoolean(),
  body("priority")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Priority must be a positive integer")
    .toInt(),
  body("downloadPath")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Download path must be at most 500 characters")
    // 🛡️ Sentinel: Add path traversal validation.
    // Disallow '..' in download paths to prevent writing files outside the intended directory.
    .custom((value) => !value.includes(".."))
    .withMessage("Download path cannot contain '..'"),
  body("category")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Category must be at most 100 characters"),
  body("label")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Label must be at most 100 characters"),
];

// Sanitization rules for download add requests
export const sanitizeDownloadData = [
  body("url")
    .trim()
    .custom((value) => {
      // Allow standard URLs and localhost/internal URLs
      try {
        const url = new URL(value);
        return ["http:", "https:", "magnet:"].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage("Invalid download URL"),
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be between 1 and 500 characters"),
  body("category")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Category must be at most 100 characters"),
  body("downloadType")
    .optional()
    .trim()
    .isIn(["torrent", "usenet"])
    .withMessage("Invalid download type"),
  body("downloadPath")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Download path must be at most 500 characters")
    // 🛡️ Sentinel: Add path traversal validation.
    // Disallow '..' in download paths to prevent writing files outside the intended directory.
    .custom((value) => !value.includes(".."))
    .withMessage("Download path cannot contain '..'"),
  body("priority")
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage("Priority must be between 0 and 10")
    .toInt(),
  body("gameId")
    .optional()
    .trim()
    .matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .withMessage("Invalid game ID format"),
];

// Sanitization rules for indexer search queries
export const sanitizeIndexerSearchQuery = [
  query("query")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Search query must be between 1 and 200 characters"),
  query("category")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Category must be at most 500 characters"),
  query("cat")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Category alias (cat) must be at most 500 characters"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Offset must be a non-negative integer")
    .toInt(),
];
